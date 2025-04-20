import { createPublicClient, custom, http, fallback, PublicClient, encodeFunctionData, decodeAbiParameters } from 'viem';
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
            chainId?: string;
            on?: (event: string, listener: (arg: any) => void) => void;
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

// Cache for mainnet check result
let isOnMainnetCache: boolean | null = null;

// Universal Resolver address on mainnet
const UNIVERSAL_RESOLVER_ADDRESS = '0x64969fb44091A7E5fA1213D30D7A7e8488edf693';

// Check if wallet is connected to mainnet with caching
async function isWalletOnMainnet(): Promise<boolean> {
    // Return cached result if available
    if (isOnMainnetCache !== null) {
        return isOnMainnetCache;
    }
    
    try {
        if (typeof window === 'undefined' || !window.ethereum || !window.ethereum.request) {
            isOnMainnetCache = false;
            return false;
        }
        
        // Get chainId from ethereum provider
        let chainId: string;
        
        // First check if it's already available as a property
        if (window.ethereum.chainId) {
            chainId = window.ethereum.chainId;
        } else {
            // Otherwise make a request
            chainId = await window.ethereum.request({ method: 'eth_chainId' });
        }
        
        // Convert to number and check if it's mainnet (chain ID 1)
        const chainIdNum = parseInt(chainId, 16);
        console.log(`Current wallet chain ID: ${chainIdNum}`);
        
        // Cache the result
        isOnMainnetCache = chainIdNum === 1;
        return isOnMainnetCache;
    } catch (error) {
        console.error('Error checking wallet chain:', error);
        isOnMainnetCache = false;
        return false;
    }
}

// Listen for chain changes and update the cache
function setupChainChangeListener() {
    if (typeof window !== 'undefined' && window.ethereum && window.ethereum.request) {
        window.ethereum.on?.('chainChanged', (chainId: string) => {
            // Update the cache when chain changes
            const chainIdNum = parseInt(chainId, 16);
            console.log(`Chain changed to: ${chainIdNum}`);
            isOnMainnetCache = chainIdNum === 1;
            
            // Clear client to force recreation with new settings
            ethereumClient = null;
        });
    }
}

// Call setup once on module initialization
if (typeof window !== 'undefined') {
    setupChainChangeListener();
}

/**
 * Creates an Ethereum client with fallback transport functionality
 * Note: There are some TypeScript typing issues with viem and its account handling,
 * but the implementation works correctly at runtime.
 */
// @ts-ignore - Ignoring type issues with viem's transport typing
export async function createEthereumClient(): Promise<PublicClient | null> {
    try {
        // Log environment info when creating client (helpful for debugging)
        logEnvironmentInfo();
        
        // Check if browser wallet is available and on mainnet
        const hasWallet = typeof window !== 'undefined' && window.ethereum && window.ethereum.request;
        const isOnMainnet = hasWallet ? await isWalletOnMainnet() : false;
        
        // Get Tenderly RPC URL
        const tenderlyRpcUrl = getTenderlyRpcUrl();
        
        // Determine which client to create based on available providers
        if (hasWallet && isOnMainnet && tenderlyRpcUrl) {
            // Both wallet (on mainnet) and Tenderly available, use fallback
            console.log('Using wallet provider (mainnet) with Tenderly fallback');
            // @ts-ignore - Ignoring type issues with viem's transport typing
            return createPublicClient({
                chain: mainnet,
                transport: fallback([
                    custom(window.ethereum),
                    http(tenderlyRpcUrl),
                ])
            });
        } else if (hasWallet && isOnMainnet) {
            // Only wallet available and on mainnet
            console.log('Using wallet provider (mainnet)');
            // @ts-ignore - Ignoring type issues with viem's transport typing
            return createPublicClient({
                chain: mainnet,
                transport: custom(window.ethereum)
            });
        } else if (tenderlyRpcUrl) {
            // Use Tenderly if wallet is not on mainnet or not available
            console.log('Using Tenderly provider only');
            // @ts-ignore
            return createPublicClient({
                chain: mainnet,
                transport: http(tenderlyRpcUrl)
            });
        } else {
            // No providers available
            console.error('No Ethereum providers available. Need either a browser wallet on mainnet or Tenderly API key.');
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
export async function getEthereumClient(): Promise<PublicClient | null> {
    if (!ethereumClient) {
        ethereumClient = await createEthereumClient();
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

// Function to get the current contentHash from ENS using the Universal Resolver
export async function getCurrentContentHash(ensName: string): Promise<string | null> {
    try {
        // Get global Ethereum client
        const client = await getEthereumClient();
        
        // If no client available, exit early
        if (!client) {
            return null;
        }

        // DNS encode the ENS name
        const dnsEncodedName = dnsEncodeName(ensName);
        
        // Encode the function call for contenthash(node)
        const contenthashAbi = {
            name: 'contenthash',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'bytes' }]
        };
        
        // Encode call to contenthash(namehash(ensName))
        const calldata = encodeFunctionData({
            abi: [contenthashAbi],
            functionName: 'contenthash',
            args: [namehash(ensName)]
        });
        
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
        }).catch((error): [null, null] => {
            console.log(`Error calling Universal Resolver for ${ensName}:`, error.message);
            return [null, null];
        });
        
        if (resolveResult && resolveResult !== '0x') {
            console.log(`Successfully resolved ${ensName} with Universal Resolver. Resolver: ${resolverAddress}`);
            
            // Try to decode the result which is ABI-encoded bytes
            try {
                // The result is ABI-encoded, so decode it to get the actual bytes value
                const decoded = decodeAbiParameters(
                    [{ name: 'contenthash', type: 'bytes' }],
                    resolveResult
                );
                
                if (decoded && decoded[0]) {
                    return processContentHash(decoded[0]);
                }
            } catch (decodeError) {
                console.log(`Error decoding result from Universal Resolver for ${ensName}:`, decodeError.message);
                // If decoding fails, try direct processing as fallback
                return processContentHash(resolveResult);
            }
        }
        
        console.log(`Could not resolve content hash for ${ensName}`);
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