import { createPublicClient, http, getAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { resolveEnsOwner } from '@simplepg/common'
import { logger } from './logger.js'

/**
 * Creates a viem client with the specified RPC URL
 * @param {string} rpcUrl - The RPC URL to use
 * @returns {Object} - The viem client
 */
function createClient(rpcUrl) {
   return createPublicClient({
     chain: mainnet,
     transport: http(rpcUrl, {
       timeout: 30_000, // 30 second timeout
       retryCount: 3,
       retryDelay: 1000, // 1 second between retries
     })
   })
}

/**
 * Tests if the RPC endpoint is reachable
 * @param {string} rpcUrl - The RPC URL to test
 * @returns {Promise<boolean>} - True if reachable, false otherwise
 */
async function testRpcConnectivity(rpcUrl) {
  try {
    logger.debug(`Testing RPC connectivity to: ${rpcUrl}`)
    const startTime = Date.now()
    const client = createClient(rpcUrl)
    const blockNumber = await client.getBlockNumber()
    const elapsed = Date.now() - startTime
    logger.debug(`RPC connection successful (${elapsed}ms), current block: ${blockNumber}`)
    return true
  } catch (error) {
    logger.error(`RPC connectivity test failed for ${rpcUrl}`)
    logger.debug(`RPC error type: ${error.name}`)
    logger.debug(`RPC error message: ${error.message}`)
    if (error.cause) {
      logger.debug(`RPC error cause: ${error.cause.message || error.cause}`)
    }
    if (error.code) {
      logger.debug(`RPC error code: ${error.code}`)
    }
    return false
  }
}

// ABI for Gnosis Safe
const SAFE_ABI = [
  {
    name: 'getOwners',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }]
  },
  {
    name: 'getThreshold',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  }
]

// ABI for OpenZeppelin Governor
const GOVERNOR_ABI = [
  {
    name: 'quorum',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'uint256' }]
  }
]

// ABI for Moloch/Baal DAO
const BAAL_ABI = [
  {
    name: 'sharesToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  }
]

// Generic owner ABI for single-owner contracts
const OWNER_ABI = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  }
]

/**
 * Classifies an Ethereum address as EOA, contract, or specific contract type
 * @param {string} addr - The address to classify
 * @param {string} rpcUrl - The RPC URL to use
 * @returns {Promise<Object>} - Classification result
 */
export async function classifyAddress(addr, rpcUrl) {
  try {
    logger.debug(`Classifying address: ${addr}`)
    const address = getAddress(addr)
    const client = createClient(rpcUrl)
    logger.debug(`Fetching bytecode for address: ${address}`)
    const code = await client.getBytecode({ address })
    
    if (!code || code === '0x') {
      return { type: 'EOA', detail: 'No code at rest' }
    }

    // Check for EIP-7702 delegated EOA
    // EIP-7702 format: 0xef01 (magic, 2 bytes) + 0x00 (version, 1 byte) + 20-byte address
    if (code.startsWith('0xef01')) {
      // Extract delegated address starting after the header (0xef0100)
      // Skip '0x' (2 chars) + 'ef01' (4 chars) + '00' (2 chars) = 8 chars total
      const addressPart = code.slice(8) // Skip '0xef0100'
      
      if (addressPart.length === 40) {
        // We have exactly 20 bytes (40 hex chars) - the expected address length
        try {
          const delegatedAddress = getAddress('0x' + addressPart)
          return { 
            type: 'EIP7702', 
            detail: 'Delegated EOA',
            delegatedTo: delegatedAddress
          }
        } catch (error) {
          // If address is invalid, still mark as EIP-7702 but note the issue
          return { 
            type: 'EIP7702', 
            detail: 'Delegated EOA (invalid address checksum)',
            delegatedTo: '0x' + addressPart
          }
        }
      } else if (addressPart.length > 0) {
        // Unexpected length - still try to extract what we can
        const paddedAddress = addressPart.padStart(40, '0')
        return { 
          type: 'EIP7702', 
          detail: `Delegated EOA (unexpected length: ${addressPart.length / 2} bytes)`,
          delegatedTo: '0x' + paddedAddress
        }
      }
      // If no address data found
      return { 
        type: 'EIP7702', 
        detail: 'Delegated EOA (no address data)',
        delegatedTo: ''
      }
    }

    // Check if it's a Gnosis Safe
    try {
      const [owners, threshold] = await Promise.all([
        client.readContract({ 
          address, 
          abi: SAFE_ABI, 
          functionName: 'getOwners' 
        }),
        client.readContract({ 
          address, 
          abi: SAFE_ABI, 
          functionName: 'getThreshold' 
        })
      ])
      
      if (Array.isArray(owners) && typeof threshold === 'bigint') {
        return { 
          type: 'Safe', 
          owners: owners.map(String), 
          threshold: Number(threshold),
          totalOwners: owners.length
        }
      }
    } catch (error) {
      logger.debug(`Not a Safe contract at ${address}: ${error.message}`)
    }

    // Check if it's an OpenZeppelin Governor
    try {
      await client.readContract({ 
        address, 
        abi: GOVERNOR_ABI, 
        functionName: 'quorum', 
        args: [0n] 
      })
      return { type: 'DAO_Governor' }
    } catch (error) {
      logger.debug(`Not a Governor contract at ${address}: ${error.message}`)
    }

    // Check if it's a Moloch/Baal DAO
    try {
      await client.readContract({ 
        address, 
        abi: BAAL_ABI, 
        functionName: 'sharesToken' 
      })
      return { type: 'DAO_MolochBaal' }
    } catch (error) {
      logger.debug(`Not a Moloch/Baal DAO at ${address}: ${error.message}`)
    }

    // Check if it's a generic single-owner contract
    try {
      const owner = await client.readContract({ 
        address, 
        abi: OWNER_ABI, 
        functionName: 'owner' 
      })
      return { type: 'ContractWallet_SingleOwner', owner }
    } catch (error) {
      logger.debug(`Not a single-owner contract at ${address}: ${error.message}`)
    }

    // Fallback for unknown contracts
    return { type: 'Contract_Unknown' }
  } catch (error) {
    logger.error(`Error classifying address ${addr}: ${error.message}`)
    return { type: 'Error', error: error.message }
  }
}

/**
 * Analyzes the owner of an ENS name, including contract classification
 * @param {string} ensName - The ENS name to analyze
 * @param {string} rpcUrl - The RPC URL to use
 * @returns {Promise<Object>} - Complete owner analysis matching report.js schema
 */
export async function analyzeOwner(ensName, rpcUrl) {
  logger.debug(`Analyzing owner for ENS name: ${ensName}`)
  logger.debug(`Using RPC endpoint: ${rpcUrl}`)

  // Test RPC connectivity first
  const isRpcReachable = await testRpcConnectivity(rpcUrl)
  if (!isRpcReachable) {
    const error = new Error(`RPC endpoint is not reachable or timed out`)
    error.details = {
      endpoint: rpcUrl,
      ensName: ensName,
      suggestion: 'Try using a different RPC endpoint with --rpc <url> or check your network connection'
    }
    throw error
  }

  try {
    // Create viem client for ENS resolution
    logger.debug(`Creating viem client for ENS resolution`)
    const client = createClient(rpcUrl)

    // Resolve the current owner using @simplepg/common with proper parameters
    logger.debug(`Resolving ENS owner for: ${ensName}`)
    const ownerAddress = await resolveEnsOwner(client, ensName, 1) // 1 = mainnet chainId

    if (!ownerAddress) {
      logger.debug(`No owner found for ${ensName}`)
      return {
        type: 'No_Owner_Found',
        ownerAddress: '',
        config: []
      }
    }

    logger.debug(`Owner address resolved: ${ownerAddress}`)

    // Classify the owner address
    logger.debug(`Classifying owner address: ${ownerAddress}`)
    const classification = await classifyAddress(ownerAddress, rpcUrl)

    // Transform classification to match report.js schema
    let type = classification.type
    let config = []

    // Build config array based on classification details
    if (classification.type === 'Safe') {
      config = [
        { key: 'totalOwners', value: classification.totalOwners },
        { key: 'threshold', value: classification.threshold },
        { key: 'owners', value: classification.owners }
      ]
    } else if (classification.type === 'ContractWallet_SingleOwner') {
      config = [
        { key: 'owner', value: classification.owner }
      ]
    } else if (classification.type === 'EIP7702') {
      config = [
        { key: 'delegatedTo', value: classification.delegatedTo }
      ]
    } else if (classification.type === 'Error') {
      config = [
        { key: 'error', value: classification.error }
      ]
    }

    const result = {
      type,
      ownerAddress,
      config
    }

    logger.debug(`Owner analysis complete for ${ensName}:`, result)
    return result

  } catch (error) {
    logger.error(`Error analyzing owner for ${ensName}`)
    logger.debug(`Error type: ${error.name || 'Unknown'}`)
    logger.debug(`Error message: ${error.message}`)
    if (error.cause) {
      logger.debug(`Error cause: ${typeof error.cause === 'object' ? error.cause.message : error.cause}`)
    }
    if (error.stack && logger.currentLevel >= logger.levels.debug) {
      logger.debug(`Stack trace:\n${error.stack}`)
    }
    
    return {
      type: 'Error',
      ownerAddress: '',
      config: [
        { key: 'error', value: error.message }
      ]
    }
  }
}

/**
 * Batch analyzes multiple ENS names
 * @param {string[]} ensNames - Array of ENS names to analyze
 * @param {string} rpcUrl - The RPC URL to use
 * @returns {Promise<Object[]>} - Array of owner analysis results matching report.js schema
 */
export async function analyzeOwners(ensNames, rpcUrl) {
  const results = []
  
  for (const ensName of ensNames) {
    try {
      const result = await analyzeOwner(ensName, rpcUrl)
      results.push(result)
    } catch (error) {
      logger.error(`Error in batch analysis for ${ensName}: ${error.message}`)
      results.push({
        type: 'Error',
        ownerAddress: '',
        config: [
          { key: 'error', value: error.message }
        ]
      })
    }
  }
  
  return results
}
