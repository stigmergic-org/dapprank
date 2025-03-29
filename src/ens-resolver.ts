import { createPublicClient, custom } from 'viem';
import { mainnet } from 'viem/chains';
import { namehash } from 'viem/ens';
import { CID } from 'multiformats/cid';
import { base32 } from 'multiformats/bases/base32';

// Add TypeScript declaration for window.ethereum
declare global {
    interface Window {
        ethereum?: {
            request?: (args: any) => Promise<any>;
        };
    }
}

// Function to get the current contentHash from ENS
export async function getCurrentContentHash(ensName: string): Promise<string | null> {
    try {
        // Create a viem client using window.ethereum if available, otherwise use a public RPC
        if (!window.ethereum) {
            console.error('No Ethereum provider found');
            return null;
        }
        const transport = custom(window.ethereum);

        const client = createPublicClient({
            chain: mainnet,
            transport: transport,
        });

        // Get the resolver address for the ENS name
        const resolverAddress = await client.getEnsResolver({
            name: ensName,
        });

        if (!resolverAddress) {
            console.log('No resolver address found for', ensName);
            return null;
        }

        // Get the contentHash from the resolver
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
        
        if (!contentHash || contentHash === '0x') return null;
        
        // Check if the contenthash starts with the IPFS protocol prefix
        if (contentHash.startsWith('0xe5010172')) {
            console.log('IPNS contenthash not supported');
            return null;
        } else if (!contentHash.startsWith('0xe3010170')) {
            console.log('Contenthash does not start with IPFS prefix');
            return null;
        }
        
        // Decode the contenthash - it's a hex string starting with 0xe3010170 (IPFS)
        // Remove 0x and the protocol prefix (e3010170)
        const ipfsHex = contentHash.slice(10);
        // Convert hex to bytes
        const bytes = new Uint8Array(ipfsHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        
        // Convert to CIDv1
        const cidv1 = CID.decode(bytes).toV1();
        // Return as base32 string
        return cidv1.toString(base32);
    } catch (error) {
        console.error(`Error resolving ENS name ${ensName}:`, error);
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