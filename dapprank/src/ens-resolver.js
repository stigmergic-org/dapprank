import { createPublicClient, namehash, encodeFunctionData, decodeAbiParameters } from 'viem'
import { UNIVERSAL_RESOLVER_ADDRESS } from './constants.js'
import { base32 } from "multiformats/bases/base32"
import { CID } from "multiformats/cid"
import { logger } from './logger.js'

// Resolve ENS name using Universal Resolver contract
export async function resolveENSName(client, ensName, blockNumber) {
    try {
        logger.debug(`Resolving ${ensName} using Universal Resolver...`)
        
        // DNS encode the ENS name (required for Universal Resolver)
        const dnsEncodedName = dnsEncodeName(ensName)
        
        // Encode the function call for contenthash(node)
        const contenthashAbi = {
            name: 'contenthash',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'bytes' }]
        }
        
        // Encode call to contenthash(namehash(ensName))
        const calldata = encodeFunctionData({
            abi: [contenthashAbi],
            functionName: 'contenthash',
            args: [namehash(ensName)]
        })
        
        // Call Universal Resolver's resolve function
        // This does everything in one call: finds the resolver and calls the contenthash function
        const [resolveResult, resolverAddress] = await client.readContract({
            address: UNIVERSAL_RESOLVER_ADDRESS,
            abi: [{
                name: 'resolve',
                type: 'function',
                stateMutability: 'view',
                inputs: [
                    { name: 'name', type: 'bytes' },
                    { name: 'data', type: 'bytes' }
                ],
                outputs: [
                    { name: '', type: 'bytes' },
                    { name: '', type: 'address' }
                ]
            }],
            functionName: 'resolve',
            args: [dnsEncodedName, calldata],
            blockNumber
        }).catch((error) => {
            logger.error(`Error calling Universal Resolver for ${ensName}:`, error.message)
            return [null, null]
        })
        
        if (resolveResult && resolveResult !== '0x') {
            logger.debug(`Successfully resolved ${ensName} with Universal Resolver. Resolver: ${resolverAddress}`)
            
            // Try to decode the result which is ABI-encoded bytes
            try {
                // The result is ABI-encoded, so decode it to get the actual bytes value
                const decoded = decodeAbiParameters(
                    [{ name: 'contenthash', type: 'bytes' }],
                    resolveResult
                )
                
                if (decoded && decoded[0]) {
                    return processContentHash(decoded[0])
                }
            } catch (decodeError) {
                logger.error(`Error decoding result from Universal Resolver:`, decodeError.message)
                // If decoding fails, try direct processing as fallback
                return processContentHash(resolveResult)
            }
        }
        
        logger.debug(`Could not resolve ${ensName} using Universal Resolver`)
        return ''
    } catch (error) {
        logger.error(`Error in Universal Resolver for ${ensName}:`, error)
        logger.debug('Full error:', error.stack)
        return ''
    }
}

// Function to DNS encode an ENS name as per ENSIP-10
function dnsEncodeName(name) {
    if (!name) return '0x00'
    
    // Remove trailing period if present
    if (name.endsWith('.')) {
        name = name.substring(0, name.length - 1)
    }
    
    // Split the name by periods to get the labels
    const labels = name.split('.')
    
    // Encode each label with its length
    const result = []
    for (const label of labels) {
        // Each label is prefixed with its length as a single byte
        if (label.length > 0) {
            // Add length byte
            result.push(label.length)
            // Add label bytes
            for (let i = 0; i < label.length; i++) {
                result.push(label.charCodeAt(i))
            }
        }
    }
    
    // Add root label (zero length)
    result.push(0)
    
    // Convert to hex string with 0x prefix
    return '0x' + Buffer.from(result).toString('hex')
}

// Helper function to process contentHash
function processContentHash(contentHash) {
    // If the content hash is already in a CID format (starts with 'b' for base32), return it
    if (typeof contentHash === 'string' && contentHash.startsWith('b')) {
        return contentHash
    }
    
    // Remove 0x prefix if present for further processing
    const hexData = contentHash.startsWith('0x') ? contentHash.slice(2) : contentHash
    
    // Check if the contenthash starts with the IPFS protocol prefix
    if (contentHash.startsWith('0xe5010172')) {
        logger.warn('IPNS contenthash not supported')
        return ''
    } else if (contentHash.startsWith('0xe3010170')) {
        // Standard IPFS contenthash processing
        // Remove 0x and the protocol prefix (e3010170)
        const ipfsHex = contentHash.slice(10)
        // Convert hex to bytes
        const bytes = new Uint8Array(ipfsHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
        
        try {
            // Convert to CIDv1
            const cidv1 = CID.decode(bytes).toV1()
            // Return as base32 string
            return cidv1.toString(base32)
        } catch (error) {
            logger.error('Error decoding IPFS CID:', error.message)
        }
    } 
    
    // Look for common IPFS protocol markers
    const ipfsMarkers = [
        { marker: 'e3010170', desc: 'IPFS with E3 prefix' },
        { marker: '0170', desc: 'IPFS without E3 prefix' },
        { marker: '1220', desc: 'IPFS v0 hash prefix' },
        { marker: '12200000000000000000000000000000', desc: 'IPFS v0 with padding' }
    ]
    
    // Try each marker
    for (const { marker, desc } of ipfsMarkers) {
        const index = hexData.indexOf(marker)
        if (index >= 0) {
            try {
                // Extract potential CID starting from the marker position
                const possibleCidHex = hexData.slice(index)
                
                // Convert hex to bytes
                const bytes = new Uint8Array(possibleCidHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
                
                // Try to decode as CID
                const cid = CID.decode(bytes)
                const cidv1 = cid.toV1()
                const cidString = cidv1.toString(base32)
                return cidString
            } catch (error) {
                // Continue to try other formats
            }
        }
    }
    
    // Try to decode the entire content as a CID as a last resort
    try {
        const allBytes = new Uint8Array(hexData.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
        const cid = CID.decode(allBytes)
        const cidv1 = cid.toV1()
        const cidString = cidv1.toString(base32)
        return cidString
    } catch (fullCidError) {
        // Failed to decode
    }
    
    logger.error('Could not parse content hash in any format')
    return ''
}
