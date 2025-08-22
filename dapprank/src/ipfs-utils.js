import { promises as fs } from 'fs'
import { join } from 'path'
import { WASMagic } from "wasmagic"
import { base32 } from "multiformats/bases/base32"
import { CID } from "multiformats/cid"

// Function to get all files from a CID
export async function getFilesFromCID(kubo, cid, result = [], pathCarry = '') {
    console.log(`Listing files from /${pathCarry}`)
    const entries = []
    for await (const item of kubo.ls(cid)) {
        entries.push(item)
    }

    // Check if this is a sharded file (multiple entries with empty names)
    if (entries.length > 1 && entries.every(item => 
        item.type === 'file' && 
        item.name === '')) {
        // Last entry might be smaller than chunk size
        const totalSize = entries.reduce((sum, item) => sum + item.size, 0)
        // Combine all shards into a single file entry
        result.push({
            name: '',
            path: pathCarry || 'index.html', // Use index.html for root path
            size: totalSize,
            cid: cid, // Use the parent CID
            type: 'file'
        })
        return result
    }

    // Handle regular directory/file listing
    for (const item of entries) {
        const currentPath = pathCarry ? `${pathCarry}/${item.name}` : item.name
        if (item.type === 'dir') {
            await getFilesFromCID(kubo, item.cid, result, currentPath)
        } else if (item.type === 'file' && item.size !== undefined) {
            result.push({ ...item, path: currentPath })
        } else if (item.type === 'file' && pathCarry === '') {
            // Single file at root
            result.push({ ...item, path: 'index.html' })
        }
    }
    return result
}

// Function to extract the content of a file as a string
export async function getFileContent(kubo, cid) {
    try {
        const chunks = [];
        for await (const chunk of kubo.cat(cid)) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf-8');
    } catch (error) {
        console.error(`Error getting file content: ${error.message}`);
        return null;
    }
}

// Function to detect MIME type
export async function detectMimeType(kubo, cid) {
    try {
        const chunks = [];
        for await (const chunk of kubo.cat(cid)) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const magic = await WASMagic.create();
        return magic.detect(buffer)
    } catch (error) {
        if (error.message === 'this dag node is a directory') {
            return 'inode/directory'
        } else {
            return 'application/octet-stream'
        }
    }
}

// Helper function to process contentHash
export function processContentHash(contentHash) {
    // If the content hash is already in a CID format (starts with 'b' for base32), return it
    if (typeof contentHash === 'string' && contentHash.startsWith('b')) {
        return contentHash
    }
    
    // Remove 0x prefix if present for further processing
    const hexData = contentHash.startsWith('0x') ? contentHash.slice(2) : contentHash
    
    // Check if the contenthash starts with the IPFS protocol prefix
    if (contentHash.startsWith('0xe5010172')) {
        console.log('IPNS contenthash not supported')
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
            console.log('Error decoding IPFS CID:', error.message)
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
    
    console.log('Could not parse content hash in any format')
    return ''
}

/**
 * Fetch and parse the .well-known/dappspec.json file if it exists in the IPFS content
 * @param {Object} kubo - IPFS Kubo client instance
 * @param {string} rootCID - The CID of the IPFS content
 * @returns {Object|null} The parsed dappspec.json content or null if not found
 */
export async function getDappspecJson(kubo, rootCID) {
    console.log('Checking for .well-known/dappspec.json...');
    
    try {
        // First check if the .well-known directory exists
        const entries = [];
        try {
            // Try to list the root directory
            for await (const item of kubo.ls(rootCID)) {
                entries.push(item);
            }
        } catch (error) {
            console.log('Error listing root directory:', error.message);
            return null;
        }
        
        // Find .well-known directory
        const wellKnownDir = entries.find(item => 
            item.type === 'dir' && 
            item.name === '.well-known'
        );
        
        if (!wellKnownDir) {
            console.log('No .well-known directory found');
            return null;
        }
        
        // List files in .well-known directory
        const wellKnownEntries = [];
        try {
            for await (const item of kubo.ls(wellKnownDir.cid)) {
                wellKnownEntries.push(item);
            }
        } catch (error) {
            console.log('Error listing .well-known directory:', error.message);
            return null;
        }
        
        // Find dappspec.json file
        const dappspecFile = wellKnownEntries.find(item =>
            item.type === 'file' &&
            item.name === 'dappspec.json'
        );
        
        if (!dappspecFile) {
            console.log('No dappspec.json file found in .well-known directory');
            return null;
        }
        
        // Get file content
        const content = await getFileContent(kubo, dappspecFile.cid);
        if (!content) {
            console.log('Failed to read dappspec.json content');
            return null;
        }
        
        // Parse JSON content
        try {
            const jsonContent = JSON.parse(content);
            console.log('Successfully found and parsed dappspec.json');
            return jsonContent;
        } catch (jsonError) {
            console.log('Error parsing dappspec.json content:', jsonError.message);
            return null;
        }
    } catch (error) {
        console.log('Error checking for dappspec.json:', error.message);
        return null;
    }
}
