import { createPublicClient, custom, http, fallback, PublicClient, encodeFunctionData } from 'viem';
import { mainnet } from 'viem/chains';
import { namehash } from 'viem/ens';
import { CID } from 'multiformats/cid';
import { base32 } from 'multiformats/bases/base32';
import { getTenderlyApiKey, logEnvironmentInfo } from './environment';

// Add TypeScript declaration for window.ethereum
declare global {
    interface Window {
        ethereum?: {
            request: (args: any) => Promise<any>;
        };
    }
}

// Get Tenderly RPC URL with API key
const getTenderlyRpcUrl = (): string | null => {
    const apiKey = getTenderlyApiKey();
    if (!apiKey) {
        return null;
    }
    return `https://mainnet.gateway.tenderly.co/${apiKey}`;
};

// Global client instance
let ethereumClient: PublicClient | null = null;

/**
 * Creates an Ethereum client with fallback transport functionality
 * Note: There are some TypeScript typing issues with viem and its account handling,
 * but the implementation works correctly at runtime.
 */
// @ts-ignore - Ignoring type issues with viem's transport typing
export function createEthereumClient(): PublicClient | null {
    try {
        // Log environment info when creating client (helpful for debugging)
        logEnvironmentInfo();
        
        // Check if browser wallet is available
        const hasWallet = typeof window !== 'undefined' && window.ethereum && window.ethereum.request;
        
        // Get Tenderly RPC URL
        const tenderlyRpcUrl = getTenderlyRpcUrl();
        
        // Determine which client to create based on available providers
        if (hasWallet && tenderlyRpcUrl) {
            // Both wallet and Tenderly available, use fallback
            // @ts-ignore - Ignoring type issues with viem's transport typing
            return createPublicClient({
                chain: mainnet,
                transport: fallback([
                    custom(window.ethereum),
                    http(tenderlyRpcUrl),
                ])
            });
        } else if (hasWallet) {
            // Only wallet available
            // @ts-ignore - Ignoring type issues with viem's transport typing
            return createPublicClient({
                chain: mainnet,
                transport: custom(window.ethereum)
            });
        } else if (tenderlyRpcUrl) {
            // Only Tenderly available
            // Fix TypeScript error by not including account property
            return createPublicClient({
                chain: mainnet,
                transport: http(tenderlyRpcUrl)
            });
        } else {
            // No providers available
            console.error('No Ethereum providers available. Need either a browser wallet or Tenderly API key.');
            return null;
        }
    } catch (error) {
        console.error('Error creating Ethereum client:', error);
        return null;
    }
}

/**
 * Get the global Ethereum client, creating it if it doesn't exist yet
 */
export function getEthereumClient(): PublicClient | null {
    if (!ethereumClient) {
        ethereumClient = createEthereumClient();
    }
    return ethereumClient;
}

/**
 * DNS encode an ENS name as per ENSIP-10
 * Browser-compatible implementation (no Buffer)
 */
function dnsEncodeName(name: string): `0x${string}` {
    if (!name) return '0x00' as `0x${string}`;
    
    // Remove trailing period if present
    if (name.endsWith('.')) {
        name = name.substring(0, name.length - 1);
    }
    
    // Split the name by periods to get the labels
    const labels = name.split('.');
    
    // Encode each label with its length
    const result: number[] = [];
    for (const label of labels) {
        // Each label is prefixed with its length as a single byte
        if (label.length > 0) {
            // Add length byte
            result.push(label.length);
            // Add label bytes
            for (let i = 0; i < label.length; i++) {
                result.push(label.charCodeAt(i));
            }
        }
    }
    
    // Add root label (zero length)
    result.push(0);
    
    // Convert to Uint8Array
    const bytes = new Uint8Array(result);
    
    // Convert to hex string with 0x prefix
    const hexString = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return `0x${hexString}`;
}

// Function to get the current contentHash from ENS
export async function getCurrentContentHash(ensName: string): Promise<string | null> {
    try {
        // Get global Ethereum client
        const client = getEthereumClient();
        
        // If no client available, exit early
        if (!client) {
            return null;
        }

        // Get the resolver address for the ENS name
        const resolverAddress = await client.getEnsResolver({
            name: ensName,
        });

        if (!resolverAddress) {
            console.log('No resolver address found for', ensName);
            return null;
        }

        // First try to get the contentHash directly using contenthash method
        try {
            const contentHash = await client.readContract({
                address: resolverAddress,
                abi: [{
                    name: 'contenthash',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: 'node', type: 'bytes32' }],
                    outputs: [{ name: '', type: 'bytes' }]
                }],
                functionName: 'contenthash',
                args: [namehash(ensName)],
            });
            
            if (contentHash && contentHash !== '0x') {
                // Process and return content hash
                return processContentHash(contentHash);
            }
            // If contentHash is null or empty, we'll fall through to try ENSIP-10 resolve method
        } catch (error) {
            // Fall through to try ENSIP-10 resolver
        }
        
        // Check if resolver supports ENSIP-10
        const supportsENSIP10 = await client.readContract({
            address: resolverAddress,
            abi: [{
                name: 'supportsInterface',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'interfaceID', type: 'bytes4' }],
                outputs: [{ name: '', type: 'bool' }]
            }],
            functionName: 'supportsInterface',
            args: ['0x9061b923'], // ENSIP-10 interface ID
        }).catch(error => {
            return false;
        });
        
        if (supportsENSIP10) {
            
            // Use encodeFunctionData to properly encode the contenthash function call
            const node = namehash(ensName);
            const contenthashAbi = {
                name: 'contenthash',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'node', type: 'bytes32' }],
                outputs: [{ name: '', type: 'bytes' }]
            };
            
            // Encode the function call for contenthash(node)
            const calldata = encodeFunctionData({
                abi: [contenthashAbi],
                functionName: 'contenthash',
                args: [node]
            });
            
            // DNS encode the name
            const dnsEncodedName = dnsEncodeName(ensName);
            
            // Call the resolve method
            const resolveResult = await client.readContract({
                address: resolverAddress,
                abi: [{
                    name: 'resolve',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [
                        { name: 'name', type: 'bytes' },
                        { name: 'data', type: 'bytes' }
                    ],
                    outputs: [{ name: '', type: 'bytes' }]
                }],
                functionName: 'resolve',
                args: [dnsEncodedName, calldata],
            }).catch((error): null => {
                console.log(`Error calling ENSIP-10 resolve method: ${error.message}`);
                return null;
            });
            
            if (resolveResult && resolveResult !== '0x') {
                // The result might be an ABI-encoded value that needs to be decoded
                // For contenthash, the return type is bytes
                
                // Check if the result is a direct contenthash or needs processing
                if (resolveResult.startsWith('0x0000000000000000000000000000000000000000000000000000000000000020')) {
                    // This is likely an ABI-encoded bytes value, with offset at position 32
                    
                    // Skip the first 64 chars (0x + 32 bytes for the offset)
                    // Then read the length from the next 32 bytes
                    const lengthHex = resolveResult.slice(2 + 64, 2 + 64 + 64);
                    const length = parseInt(lengthHex, 16);
                    
                    // Extract the actual bytes content
                    const contentBytes = resolveResult.slice(2 + 64 + 64, 2 + 64 + 64 + (length * 2));
                    
                    // Process the extracted content
                    return processContentHash('0x' + contentBytes);
                }
                
                // If it's not in the expected ABI format, try processing directly
                return processContentHash(resolveResult);
            }
        }
        
        console.log('Could not resolve ENS name using either method');
        return null;
    } catch (error) {
        console.error(`Error resolving ENS name ${ensName}:`, error);
        return null;
    }
}

/**
 * Process a raw contentHash and return the decoded IPFS CID
 */
function processContentHash(contentHash: string): string | null {
    try {
        // Check if the contentHash starts with the IPFS protocol prefix
        if (contentHash.startsWith('0xe5010172')) {
            console.log('IPNS contenthash not supported');
            return null;
        } else if (contentHash.startsWith('0xe3010170')) {
            // Standard IPFS contenthash processing
            // Remove 0x and the protocol prefix (e3010170)
            const ipfsHex = contentHash.slice(10);
            // Convert hex to bytes
            const bytes = new Uint8Array(ipfsHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            // Convert to CIDv1
            const cidv1 = CID.decode(bytes).toV1();
            // Return as base32 string
            return cidv1.toString(base32);
        }
        
        // Handle other formats - try common IPFS protocol markers
        const hexData = contentHash.startsWith('0x') ? contentHash.slice(2) : contentHash;
        const ipfsMarkers = [
            { marker: 'e3010170', desc: 'IPFS with E3 prefix' },
            { marker: '0170', desc: 'IPFS without E3 prefix' },
            { marker: '1220', desc: 'IPFS v0 hash prefix' }
        ];
        
        // Try each marker
        for (const { marker } of ipfsMarkers) {
            const index = hexData.indexOf(marker);
            if (index >= 0) {
                try {
                    // Extract potential CID starting from the marker position
                    const possibleCidHex = hexData.slice(index);
                    
                    // Convert hex to bytes
                    const bytes = new Uint8Array(possibleCidHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                    
                    // Try to decode as CID
                    const cid = CID.decode(bytes);
                    const cidv1 = cid.toV1();
                    return cidv1.toString(base32);
                } catch (error) {
                    // Continue to try other formats
                }
            }
        }
        
        // Try to decode the entire content as a CID as a last resort
        try {
            const allBytes = new Uint8Array(hexData.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const cid = CID.decode(allBytes);
            const cidv1 = cid.toV1();
            return cidv1.toString(base32);
        } catch (fullCidError) {
            // Failed to decode
        }
        
        console.log('Could not parse content hash in any format');
        return null;
    } catch (error) {
        console.error('Error processing content hash:', error);
        return null;
    }
}

// Function to check if the contentHash is out of date
export async function isContentHashOutdated(ensName: string, reportContentHash: string): Promise<boolean> {
    try {
        const currentContentHash = await getCurrentContentHash(ensName);
        
        // If we couldn't get the current contentHash, we can't determine if it's outdated
        if (!currentContentHash) {
            return false;
        }
        
        // Compare the current contentHash with the one in the report
        return currentContentHash !== reportContentHash;
    } catch (error) {
        console.error(`Error checking if contentHash is outdated for ${ensName}:`, error);
        return false;
    }
} 