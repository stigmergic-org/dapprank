import { createPublicClient, http, getAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { resolveEnsOwner } from '@simplepg/common'

/**
 * Creates a viem client with the specified RPC URL
 * @param {string} rpcUrl - The RPC URL to use
 * @returns {Object} - The viem client
 */
function createClient(rpcUrl) {
  return createPublicClient({ 
    chain: mainnet, 
    transport: http(rpcUrl) 
  })
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
    const address = getAddress(addr)
    const client = createClient(rpcUrl)
    const code = await client.getBytecode({ address })
    
    if (!code || code === '0x') {
      return { type: 'EOA', detail: 'No code at rest' }
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
    } catch {}

    // Check if it's an OpenZeppelin Governor
    try {
      await client.readContract({ 
        address, 
        abi: GOVERNOR_ABI, 
        functionName: 'quorum', 
        args: [0n] 
      })
      return { type: 'DAO_Governor' }
    } catch {}

    // Check if it's a Moloch/Baal DAO
    try {
      await client.readContract({ 
        address, 
        abi: BAAL_ABI, 
        functionName: 'sharesToken' 
      })
      return { type: 'DAO_MolochBaal' }
    } catch {}

    // Check if it's a generic single-owner contract
    try {
      const owner = await client.readContract({ 
        address, 
        abi: OWNER_ABI, 
        functionName: 'owner' 
      })
      return { type: 'ContractWallet_SingleOwner', owner }
    } catch {}

    // Fallback for unknown contracts
    return { type: 'Contract_Unknown' }
  } catch (error) {
    console.error(`Error classifying address ${addr}:`, error.message)
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
  try {
    console.log(`Analyzing owner for ENS name: ${ensName}`)
    
    // Create viem client for ENS resolution
    const client = createClient(rpcUrl)
    
    // Resolve the current owner using @simplepg/common with proper parameters
    const ownerAddress = await resolveEnsOwner(client, ensName, 1) // 1 = mainnet chainId
    
    if (!ownerAddress) {
      return {
        type: 'No_Owner_Found',
        ownerAddress: '',
        config: []
      }
    }

    // Classify the owner address
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

    console.log(`Owner analysis complete for ${ensName}:`, result)
    return result
    
  } catch (error) {
    console.error(`Error analyzing owner for ${ensName}:`, error.message)
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
      console.error(`Error in batch analysis for ${ensName}:`, error.message)
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
