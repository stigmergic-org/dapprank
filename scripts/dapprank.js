#!/usr/bin/env node
// Load environment variables from .env file
import * as dotenv from 'dotenv'
dotenv.config()

import { create as createKubo } from 'kubo-rpc-client'
import { createPublicClient, http, namehash, encodeFunctionData } from 'viem'
import { mainnet } from 'viem/chains'
import { program } from 'commander'
import { promises as fs } from 'fs'
import { join } from 'path'
import { base32 } from "multiformats/bases/base32"
import { CID } from "multiformats/cid"
import crypto from 'crypto'
import { WASMagic } from "wasmagic"
import * as cheerio from 'cheerio'
import { GoogleGenAI } from "@google/genai"

// Cache for script analysis to avoid repeated AI calls for identical content
const scriptAnalysisCache = new Map();
const CACHE_FILE_PATH = join(process.cwd(), 'script-analysis-cache.json');

// Load cache from disk if it exists
async function loadScriptAnalysisCache() {
    try {
        const cacheExists = await fs.access(CACHE_FILE_PATH).then(() => true).catch(() => false);
        if (cacheExists) {
            const cacheData = JSON.parse(await fs.readFile(CACHE_FILE_PATH, 'utf-8'));
            Object.entries(cacheData).forEach(([key, value]) => {
                scriptAnalysisCache.set(key, value);
            });
            console.log(`Loaded script analysis cache with ${scriptAnalysisCache.size} entries`);
        }
    } catch (error) {
        console.error('Failed to load script analysis cache:', error.message);
    }
}

// Save cache to disk
async function saveScriptAnalysisCache() {
    try {
        const cacheData = Object.fromEntries(scriptAnalysisCache.entries());
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));
        console.log(`Saved script analysis cache with ${scriptAnalysisCache.size} entries`);
    } catch (error) {
        console.error('Failed to save script analysis cache:', error.message);
    }
}

const WEB3_APIs = [
    { url: 'http://localhost:8545', service: 'ethereum', risk: 'none' },
    { url: 'http://127.0.0.1:8545', service: 'ethereum', risk: 'none' },
]
const LINK_NON_FETCHING_REL_VALUES = [
    'alternate',
    'author',
    'help',
    'license',
    'next',
    'prev',
    'nofollow',
    'noopener',
    'noreferrer',
    'bookmark',
    'tag',
    'external',
    'no-follow',
    'canonical'
];

// Network API patterns to detect in JavaScript AST
const NETWORK_APIS = {
    FETCH: ['fetch'],
    XHR: ['XMLHttpRequest'],
    WEBSOCKET: ['WebSocket', 'WebSocketStream'],
    WEBRTC: ['RTCPeerConnection', 'RTCDataChannel'],
    WEB3: ['window.ethereum', 'ethereum']
}

const ANALYSIS_VERSION = 2

program
    .name('dapprank')
    .description('Analyze ENS sites for external dependencies and Web3 APIs')
    .option('-i, --ipfs <url>', 'IPFS API URL', 'http://localhost:5001')
    .option('-r, --rpc <url>', 'Ethereum RPC URL', 'http://localhost:8545')

// Add command
program
    .command('add')
    .description('Add a new report for an ENS domain')
    .argument('<ens-name>', 'ENS name to analyze')
    .option('-f, --force', 'Force analysis even if a report exists for this CID', false)
    .option('-n, --no-save', 'Skip saving the report to disk and print to console instead', true)
    .action(async (ensName, options) => {
        try {
            // Validate that this is an ENS name
            if (!ensName.endsWith('.eth')) {
                console.error('Error: Not a valid ENS name. Must end with .eth');
                process.exit(1);
            }

            const parentOptions = program.optsWithGlobals();
            const kubo = createKubo({ url: parentOptions.ipfs });
            const client = createPublicClient({
                chain: mainnet,
                transport: http(parentOptions.rpc)
            });
            
            // Get current block number
            const blockNumber = await client.getBlockNumber();
            
            // Resolve ENS name to CID
            console.log(`Resolving ENS name: ${ensName}...`);
            const rootCID = await resolveENSName(client, ensName, blockNumber);
            
            if (!rootCID) {
                console.error('Could not resolve ENS name');
                process.exit(1);
            }
            
            // Check if a report for this CID already exists (skip this check if force option is enabled)
            if (!options.force && await reportExistsForCID(ensName, rootCID)) {
                console.log(`Report for CID ${rootCID} already exists. Skipping...`);
                return;
            }
            
            // Generate report
            console.log(`Analyzing ${rootCID}...`);
            const { report, faviconInfo } = await generateReport(kubo, rootCID, blockNumber);
            
            if (!options.save) {
                // Print report to console
                console.log(JSON.stringify(report, null, 2));
                console.log(`Analysis complete for ${ensName} (report not saved)`);
            } else {
                // Save report to disk
                await saveReport(report, ensName, blockNumber, kubo, faviconInfo);
                console.log(`Analysis complete for ${ensName}`);
            }
            
            // Save the cache after analysis
            await saveScriptAnalysisCache();
        } catch (error) {
            console.error(`Fatal error analyzing ${ensName}:`, error);
            // Make sure to save the cache even on error
            try {
                await saveScriptAnalysisCache();
            } catch (cacheError) {
                console.error('Error saving cache:', cacheError);
            }
            process.exit(1);
        }
    });

// Update command
program
    .command('update')
    .description('Update all existing reports')
    .option('--halt-on-error', 'Stop processing all domains after the first error', false)
    .action(async (options) => {
        try {
            const parentOptions = program.optsWithGlobals();
            const kubo = createKubo({ url: parentOptions.ipfs });
            const client = createPublicClient({
                chain: mainnet,
                transport: http(parentOptions.rpc)
            });
            
            // Get current block number once and use for all domains
            const blockNumber = await client.getBlockNumber();
            console.log(`Using block number: ${blockNumber}`);
            
            // Get all domain directories
            const indexDir = join(process.cwd(), 'public/dapps/index');
            
            const domainDirs = await fs.readdir(indexDir);
            
            console.log(`Found ${domainDirs.length} domains to check for updates`);
            
            // Track failed domains
            const failedDomains = [];
            
            // Process each domain
            for (const domain of domainDirs) {
                try {
                    // Skip non-directories
                    const stats = await fs.stat(join(indexDir, domain));
                    if (!stats.isDirectory()) continue;
                    
                    // Skip non-ENS domains
                    if (!domain.endsWith('.eth')) {
                        console.log(`Skipping non-ENS domain: ${domain}`);
                        continue;
                    }
                    
                    console.log(`\nProcessing domain: ${domain}`);
                    
                    // Resolve ENS name to CID
                    const rootCID = await resolveENSName(client, domain, blockNumber);
                    
                    if (!rootCID) {
                        console.log(`Could not resolve ENS name: ${domain}. Skipping...`);
                        continue;
                    }
                    
                    // Check if a report for this CID already exists
                    if (await reportExistsForCID(domain, rootCID)) {
                        console.log(`Report for CID ${rootCID} already exists. Skipping...`);
                        continue;
                    }
                    
                    // Generate and save report
                    console.log(`Analyzing ${rootCID}...`);
                    const { report, faviconInfo } = await generateReport(kubo, rootCID, blockNumber);
                    await saveReport(report, domain, blockNumber, kubo, faviconInfo);
                } catch (error) {
                    console.error(`Error processing domain ${domain}:`, error);
                    failedDomains.push({ domain, error: error.message });
                    
                    if (options.haltOnError) {
                        console.error(`Halting due to error. By default, the script will continue processing other domains.`);
                        // Make sure to save cache before exiting
                        await saveScriptAnalysisCache();
                        process.exit(1);
                    }
                }
            }
            
            // Save the cache after all processing is complete
            await saveScriptAnalysisCache();
            
            // Report on any failures
            if (failedDomains.length > 0) {
                console.error(`\nThe following domains failed to process:`);
                failedDomains.forEach(({ domain, error }) => {
                    console.error(`  - ${domain}: ${error}`);
                });
                process.exit(1);
            }
            
            console.log('\nUpdate completed successfully!');
        } catch (error) {
            console.error(`Fatal error during update:`, error);
            // Make sure to save the cache even on error
            try {
                await saveScriptAnalysisCache();
            } catch (cacheError) {
                console.error('Error saving cache:', cacheError);
            }
            process.exit(1);
        }
    });

// Test command
program
    .command('test')
    .description('Test analysis for a CID without saving')
    .argument('<cid>', 'CID to analyze')
    .action(async (cid, options) => {
        try {
            const parentOptions = program.optsWithGlobals();
            const kubo = createKubo({ url: parentOptions.ipfs });
            
            console.log(`Analyzing ${cid}...`);
            const { report } = await generateReport(kubo, cid);
            
            // Print report to console
            console.log(JSON.stringify(report, null, 2));

            // Save the cache after analysis
            await saveScriptAnalysisCache();
        } catch (error) {
            console.error(`Fatal error analyzing CID ${cid}:`, error);
            // Make sure to save the cache even on error
            try {
                await saveScriptAnalysisCache();
            } catch (cacheError) {
                console.error('Error saving cache:', cacheError);
            }
            process.exit(1);
        }
    });

// Load the cache before parsing commands
await loadScriptAnalysisCache();

program.parseAsync();

// Helper function to check if a report for a CID already exists
async function reportExistsForCID(ensName, cid) {
    try {
        const archiveDir = join(process.cwd(), 'public/dapps/archive', ensName);
        
        // Check if the archive directory exists
        try {
            await fs.access(archiveDir);
        } catch (error) {
            // Directory doesn't exist, so no reports exist
            return false;
        }
        
        // Get all block number directories
        const blockDirs = await fs.readdir(archiveDir);
        
        // If no directories, return false
        if (blockDirs.length === 0) {
            return false;
        }
        
        // Find the directory with the highest block number (latest report)
        const latestBlockDir = blockDirs
            .filter(dir => !isNaN(Number(dir))) // Filter out non-numeric directories
            .sort((a, b) => Number(b) - Number(a))[0]; // Sort in descending order and take first
        
        if (!latestBlockDir) {
            return false; // No valid block directories found
        }
        
        // Check only the report in the latest block directory
        const reportPath = join(archiveDir, latestBlockDir, 'report.json');
        
        try {
            const reportContent = await fs.readFile(reportPath, 'utf-8');
            const reportData = JSON.parse(reportContent);
            
            // Check if both the CID and version match
            // If the CID matches but version is outdated, return false so a new report will be created
            return reportData.contentHash === cid && reportData.version === ANALYSIS_VERSION;
        } catch (readError) {
            console.log(`Error reading latest report file ${reportPath}:`, readError.message);
            return false;
        }
    } catch (error) {
        console.log(`Warning: Error checking if report exists: ${error.message}`);
        // If directory doesn't exist or other error, report doesn't exist
        return false;
    }
}

async function resolveENSName(client, ensName, blockNumber) {
    try {
        const resolverAddress = await client.getEnsResolver({
            name: ensName,
            blockNumber
        })

        if (!resolverAddress) {
            console.log('No resolver address found for', ensName)
            return ''
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
                blockNumber
            })
            
            if (contentHash && contentHash !== '0x') {
                return processContentHash(contentHash)
            }
            // If contentHash is null or empty, we'll fall through to try ENSIP-10 resolve method
        } catch (error) {
            console.log(`Error resolving contenthash directly, trying ENSIP-10 resolver`)
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
            blockNumber
        }).catch(error => {
            console.log(`Error checking ENSIP-10 support: ${error.message}`)
            return false
        })
        
        if (supportsENSIP10) {
            console.log('Resolver supports ENSIP-10, using resolve method')
            
            // Use encodeFunctionData to properly encode the contenthash function call
            const node = namehash(ensName)
            const contenthashAbi = {
                name: 'contenthash',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'node', type: 'bytes32' }],
                outputs: [{ name: '', type: 'bytes' }]
            }
            
            // Encode the function call for contenthash(node)
            const calldata = encodeFunctionData({
                abi: [contenthashAbi],
                functionName: 'contenthash',
                args: [node]
            })
            
            // DNS encode the name
            const dnsEncodedName = dnsEncodeName(ensName)
            
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
                blockNumber
            }).catch(error => {
                console.log(`Error calling ENSIP-10 resolve method: ${error.message}`)
                return null
            })
            
            if (resolveResult && resolveResult !== '0x') {
                // The result might be an ABI-encoded value that needs to be decoded
                // For contenthash, the return type is bytes
                
                // Check if the result is a direct contenthash or needs processing
                if (resolveResult.startsWith('0x0000000000000000000000000000000000000000000000000000000000000020')) {
                    // This is likely an ABI-encoded bytes value, with offset at position 32
                    
                    // Skip the first 64 chars (0x + 32 bytes for the offset)
                    // Then read the length from the next 32 bytes
                    const lengthHex = resolveResult.slice(2 + 64, 2 + 64 + 64)
                    const length = parseInt(lengthHex, 16)
                    
                    // Extract the actual bytes content
                    const contentBytes = resolveResult.slice(2 + 64 + 64, 2 + 64 + 64 + (length * 2))
                    
                    // Process the extracted content
                    return processContentHash('0x' + contentBytes)
                }
                
                // If it's not in the expected ABI format, try processing directly
                return processContentHash(resolveResult)
            }
        }
        
        console.log('Could not resolve ENS name using either method')
        return ''
    } catch (error) {
        console.log(`Error resolving ENS name ${ensName}:`, error)
        // Log the full error stack for debugging
        console.log('Full error:', error.stack)
        return ''
    }
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

async function saveReport(report, ensName, blockNumber, kubo, faviconInfo) {
    // Create directory paths
    const archiveDir = join(process.cwd(), 'public/dapps/archive', ensName, blockNumber.toString())
    const indexDir = join(process.cwd(), 'public/dapps/index', ensName)
    const rootArchiveDir = join(process.cwd(), 'public/dapps/archive', ensName)
    
    // Create directories
    await fs.mkdir(archiveDir, { recursive: true })
    await fs.mkdir(indexDir, { recursive: true })
    
    // Save the report to archive
    const reportPath = join(archiveDir, 'report.json')
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    console.log(`Report saved to ${reportPath}`)

    // Create metadata.json in the root archive directory if it doesn't exist
    const archiveMetadataPath = join(rootArchiveDir, 'metadata.json')
    try {
        await fs.access(archiveMetadataPath)
    } catch (error) {
        await fs.writeFile(archiveMetadataPath, JSON.stringify({ category: "" }, null, 2))
        console.log(`Created metadata file at ${archiveMetadataPath}`)
    }

    // Clean up the index directory - remove all files except metadata.json
    try {
        const files = await fs.readdir(indexDir)
        for (const file of files) {
            if (file !== 'metadata.json') {
                const filePath = join(indexDir, file)
                await fs.unlink(filePath)
                console.log(`Removed old file: ${filePath}`)
            }
        }
    } catch (error) {
        console.log(`Warning: Error cleaning index directory: ${error.message}`)
    }

    // Create metadata.json in the index directory if it doesn't exist
    const indexMetadataPath = join(indexDir, 'metadata.json')
    try {
        await fs.access(indexMetadataPath)
    } catch (error) {
        // Create symlink to root archive directory metadata file
        const relativeMetadataPath = join('../../archive', ensName, 'metadata.json')
        await fs.symlink(relativeMetadataPath, indexMetadataPath)
        console.log(`Created metadata symlink at ${indexMetadataPath}`)
    }

    // Create symlink to latest report
    const symlinkPath = join(indexDir, 'report.json')
    const relativeReportPath = join('../../archive', ensName, blockNumber.toString(), 'report.json')
    await fs.symlink(relativeReportPath, symlinkPath)
    console.log(`Symlink created at ${symlinkPath}`)

    // Try to save favicon to archive directory only if favicon exists
    if (report.favicon && faviconInfo) {
        try {
            // Save favicon to archive directory
            const archiveFaviconPath = join(archiveDir, report.favicon)

            if (faviconInfo.isDataUrl) {
                // Handle data URL favicon
                console.log('Saving data URL favicon to', archiveFaviconPath)
                
                // Extract the base64 data
                const dataUrlMatch = /data:([^;]+);([^,]+),(.+)/.exec(faviconInfo.dataUrl)
                if (dataUrlMatch && dataUrlMatch[2] === 'base64') {
                    const base64Data = dataUrlMatch[3]
                    const binaryData = Buffer.from(base64Data, 'base64')
                    await fs.writeFile(archiveFaviconPath, binaryData)
                }
            } else {
                // Handle regular favicon file from IPFS
                const faviconData = []
                for await (const chunk of kubo.cat(faviconInfo.cid)) {
                    faviconData.push(chunk)
                }

                console.log('Saving favicon to', archiveFaviconPath)
                await fs.writeFile(archiveFaviconPath, Buffer.concat(faviconData))
            }
            
            // No longer creating favicon symlink in index directory
            console.log('Favicon saved successfully to archive directory')
        } catch (error) {
            console.log('Error saving favicon', error)
        }
    } else {
        console.log('No favicon found, skipping favicon save')
    }
}

async function getFilesFromCID(kubo, cid, result = [], pathCarry = '') {
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
async function getFileContent(kubo, cid) {
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

// Analyze HTML content with Cheerio
async function analyzeHTML(kubo, cid, filePath) {
    console.log(`Analyzing HTML file: ${filePath}`);
    const fileContent = await getFileContent(kubo, cid);
    if (!fileContent) return {};
    
    const $ = cheerio.load(fileContent);
    
    // Extract metadata
    const metadata = {
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
    };
    
    // Analyze external resources
    const externalMedia = [];
    const externalScripts = [];
    
    // Check for external images, videos, audio, iframes
    $('img, video, audio, iframe, source, object, embed, track').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src && src.startsWith('http')) {
            externalMedia.push({
                type: elem.tagName.toLowerCase(),
                url: src
            });
        }
    });
    
    // Check for external scripts and links
    $('script, link').each((i, elem) => {
        const $elem = $(elem);
        const src = $elem.attr('src') || $elem.attr('href');
        
        if (!src || !src.startsWith('http')) return;
        
        if (elem.tagName.toLowerCase() === 'link') {
            const rel = $elem.attr('rel');
            if (rel && LINK_NON_FETCHING_REL_VALUES.includes(rel.toLowerCase())) {
                return;
            }
        }
        
        externalScripts.push({
            type: elem.tagName.toLowerCase(),
            url: src
        });
    });
    
    // Extract JavaScript from script tags for AST analysis
    const scriptContents = [];
    $('script').each((i, elem) => {
        console.log(`Loading inline script ${i}`)
        const $elem = $(elem);
        const scriptType = $elem.attr('type');
        
        // Skip non-JS scripts (like application/json, text/template, etc.)
        if (scriptType && 
            !['text/javascript', 'application/javascript', ''].includes(scriptType) && 
            !scriptType.includes('javascript')) {
            return;
        }
        
        const content = $elem.html();
        if (content && content.trim()) {
            scriptContents.push(content);
        }
    });
    
    return {
        metadata,
        distributionPurity: {
            externalMedia,
            externalScripts
        },
        scriptContents
    };
}

// Analyze JavaScript file
async function loadJavaScriptFile(kubo, cid, filePath) {
    console.log(`Loading JavaScript file: ${filePath}`);
    const content = await getFileContent(kubo, cid);
    return content
}

/**
 * Detect window.ethereum occurrences in JavaScript code
 * @param {string} scriptText - The JavaScript content to analyze
 * @returns {number} Number of occurrences found, 0 if none
 */
function detectWindowEthereum(scriptText) {
    if (!scriptText || scriptText.trim().length < 20) {
        return 0;
    }
    
    const windowEthereumPattern = /window\.ethereum/g;
    const matches = scriptText.match(windowEthereumPattern);
    
    return matches ? matches.length : 0;
}

/**
 * Analyzes a single JavaScript file or inline script
 * @param {string} filePath - Path or identifier for the script
 * @param {string} scriptText - The JavaScript content to analyze
 * @returns {Object} Analysis results with networkingPurity and ethereum data
 * @throws {Error} If AI analysis fails
 */
async function analyzeIndividualScript(filePath, scriptText) {
    console.log(`Analyzing script: ${filePath}`);
    
    // Initialize empty results
    const result = {
        libraries: [],
        networking: [],
        ethereum: []
    };
    
    try {
        // Skip if script content is too small
        if (!scriptText || scriptText.trim().length < 20) {
            console.log(`Script content too small for ${filePath}, skipping analysis`);
            return result
        }
        
        // Check for window.ethereum occurrences
        const count = detectWindowEthereum(scriptText);
        if (count > 0) {
            result.ethereum.push({ count });
            // console.log(`Found ${count} occurrences of window.ethereum in ${filePath}`);
        }
        
        // Create a hash of the script content to use as a cache key
        const hash = crypto.createHash('sha256').update(scriptText).digest('hex');
        
        // Check if we already have an analysis for this script content
        if (scriptAnalysisCache.has(hash)) {
            console.log(`Using cached analysis for ${filePath}`);
            const cachedResult = scriptAnalysisCache.get(hash);
            return {
                libraries: cachedResult.libraries || [],
                networking: cachedResult.networking || [],
                ethereum: result.ethereum // Use current ethereum detection result
            };
        }
        
        // Load API key from environment variable
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            throw new Error('GOOGLE_API_KEY environment variable not set');
        }
        
        // Initialize the Google Generative AI client
        const ai = new GoogleGenAI({ apiKey });
        
        // Format the structured output we want from Gemini - focus on network calls only
        const systemPrompt = `
        Analyze the provided JavaScript code and answer the following questions thouroughly.

        1. What top level javascript libraries are being used?
            - name: explicity name or descriptive title of the library
            - motivation: say why you concluded the code uses this library (formatted as markdown)
        2. What calls are there to networking libraries, and what url is being passed?
            - type: look only for fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket, WebSocketStream, EventSource, RTCPeerConnection
            - urls: best guess at what url is being passed to the function call (if multiple, return all)
            - library: best guess if this call originates from one of the libraries from (1), or otherwise
            - motivation: say why you concluded the given url, the library being used, and/or how data is passed to the call (formatted as markdown)

        
        Return ONLY valid JSON with this structure:
        {
          "libraries": [
            {
              "name": "...",
              "motivation": "..."
            }
          ],
          "networking": [
            {
              "type": "...",
              "urls": ["..."],
              "motivation": "..."
            }
          ]
        }
        
        If no API calls of a certain type are found, return an empty array for that type.
        `;
        
        // Query the Gemini model
        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro-exp-03-25",
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: systemPrompt },
                        { text: `File: ${filePath}\n\nCode:\n\`\`\`javascript\n${scriptText}\n\`\`\`` }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
            }
        });
        // console.log(response.text)
        const responseText = response.text
        
        // Parse the JSON response
        try {
            // Extract the JSON part (in case there's any text around it)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error(`No valid JSON found in response for ${filePath}`);
            }
            
            const jsonStr = jsonMatch[0];
            const analysis = JSON.parse(jsonStr);
            
            // Process the results 
            if (analysis.networking && analysis.networking.length > 0) {
                result.networking = analysis.networking
            }
            
            if (analysis.libraries && analysis.libraries.length > 0) {
                result.libraries = analysis.libraries
            }
            
            // Store in cache for future use
            scriptAnalysisCache.set(hash, {
                libraries: result.libraries,
                networking: result.networking
            });
            
            console.log(`Successfully analyzed ${filePath}`);
            
        } catch (jsonError) {
            console.error(`Error parsing JSON response for ${filePath}:`, jsonError);
            console.error("Response was:", responseText.substring(0, 200) + "...");
            throw new Error(`Failed to parse AI analysis response for ${filePath}: ${jsonError.message}`);
        }
        
    } catch (aiError) {
        console.error(`Error in script analysis for ${filePath}:`, aiError);
        throw aiError; // Re-throw the error to fail the entire process
    }
}

async function detectMimeType(kubo, cid) {
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

async function generateReport(kubo, rootCID, blockNumber = null) {
    try {
        // First, detect the MIME type of the root
        const rootMimeType = await detectMimeType(kubo, rootCID);
        console.log(`Root MIME type: ${rootMimeType}`);
        
        // Get all files in the IPFS directory
        const files = await getFilesFromCID(kubo, rootCID);
        console.log(`Found ${files.length} files to analyze`);
        
        // Initialize the report structure
        const report = {
            version: ANALYSIS_VERSION,
            contentHash: rootCID,
            timestamp: Math.floor(Date.now() / 1000),
            blockNumber: blockNumber ? Number(blockNumber) : null,
            rootMimeType: rootMimeType,
            totalSize: 0,
            favicon: '',
            title: '',
            distributionPurity: {
                externalScripts: [],
                externalMedia: [],
            },
            networkingPurity: [],
            libraryUsage: [],
            ethereum: [] // New field to store unique files that access window.ethereum
        };
        
        let faviconInfo = null;
        let indexHtmlContent = null;

        // Process all files
        for (const file of files) {
            report.totalSize += file.size;

            if (file.path.includes('.well-known/source.git')) continue
            
            const fileMimeType = await detectMimeType(kubo, file.cid);
            
            if (fileMimeType.includes('html')) {
                const { metadata, distributionPurity, scriptContents } = await analyzeHTML(kubo, file.cid, file.path);
                
                // If this is index.html, extract title and favicon
                if (file.path.toLowerCase() === 'index.html' || 
                    (file.path === '' && fileMimeType.includes('html'))) {
                    report.title = metadata?.title || '';
                    indexHtmlContent = await getFileContent(kubo, file.cid);

                    // Extract favicon if we have index.html content
                    if (indexHtmlContent) {
                        faviconInfo = getFaviconPath(indexHtmlContent, files);
                        report.favicon = faviconInfo.path;
                    }
                }

                // Process inline scripts from HTML
                if (scriptContents && scriptContents.length > 0) {
                    console.log(`Found ${scriptContents.length} inline scripts in ${file.path}`);
                    
                    // Process each inline script individually
                    for (let i = 0; i < scriptContents.length; i++) {
                        const scriptText = scriptContents[i];
                        if (scriptText && scriptText.trim().length >= 20) {
                            const inlineScriptPath = `${file.path}#inline-script-${i+1}`;
                            console.log(`Analyzing inline script #${i+1} from ${file.path} (${scriptText.length} bytes)`);
                            
                            // Analyze this individual inline script
                            const scriptAnalysis = await analyzeIndividualScript(inlineScriptPath, scriptText);
                            
                            // Add networking purity findings to the report
                            addToReportIfNotEmpty(report.networkingPurity, scriptAnalysis.networking, inlineScriptPath);
                            // Add libraries findings to the report
                            addToReportIfNotEmpty(report.libraryUsage, scriptAnalysis.libraries, inlineScriptPath);
                            // Add Ethereum findings to the report
                            addToReportIfNotEmpty(report.ethereum, scriptAnalysis.ethereum, inlineScriptPath);
                        }
                    }
                }
                
                addToReportIfNotEmpty(report.distributionPurity.externalScripts, distributionPurity?.externalScripts, file.path);
                addToReportIfNotEmpty(report.distributionPurity.externalMedia, distributionPurity?.externalMedia, file.path);
            } 
            else if (fileMimeType.includes('javascript')) {
                // Load and analyze JavaScript file
                const content = await loadJavaScriptFile(kubo, file.cid, file.path);
                if (content && content.trim().length >= 20) {
                    console.log(`Analyzing JavaScript file: ${file.path} (${content.length} bytes)`);
                    
                    // Analyze this individual JS file
                    const scriptAnalysis = await analyzeIndividualScript(file.path, content);
                    
                    // Add networking findings to the report
                    addToReportIfNotEmpty(report.networkingPurity, scriptAnalysis.networking, file.path);
                    // Add libraries findings to the report
                    addToReportIfNotEmpty(report.libraryUsage, scriptAnalysis.libraries, file.path);
                    // Add Ethereum findings to the report
                    addToReportIfNotEmpty(report.ethereum, scriptAnalysis.ethereum, file.path);
                }
            }
        }

        console.log(`Analysis complete. Total size: ${(report.totalSize / 1024 / 1024).toFixed(2)} MB`);
        return { report, faviconInfo };
    } catch (error) {
        console.error(`Error generating report: ${error.message}`);
        console.error(error);
        throw error;
    }
}

// Extract favicon information from HTML
function getFaviconPath(htmlContent, files) {
    const $ = cheerio.load(htmlContent);
    const favicons = [];
    
    // Look for favicon link tags
    $('link[rel="icon"], link[rel="shortcut icon"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (!href) return;
        
        // Check if this is a data URL
        if (href.startsWith('data:')) {
            // Extract mime type and data
            const dataUrlMatch = /data:([^;]+);([^,]+),(.+)/.exec(href);
            if (dataUrlMatch) {
                const mimeType = dataUrlMatch[1];
                const encoding = dataUrlMatch[2];
                
                // Determine file extension from mime type
                const ext = mimeType.split('/')[1] || 'ico';
                const fileName = `favicon.${ext}`;
                
                return {
                    path: fileName,
                    dataUrl: href,
                    priority: getFaviconPriority(ext),
                    isDataUrl: true
                };
            }
            return;
        }
        
        // Normalize path to match files array (remove leading ./)
        const normalizedPath = href.replace(/^\.?\//, '');
        const faviconFile = files.find(file => file.path === normalizedPath);
        
        if (faviconFile) {
            // Get file extension
            const ext = normalizedPath.split('.').pop().toLowerCase();
            // Only use filename without path
            const fileName = normalizedPath.split('/').pop();
            
            favicons.push({
                path: fileName,
                cid: faviconFile.cid,
                priority: getFaviconPriority(ext),
                isDataUrl: false
            });
        }
    });
    
    // Sort favicons by priority and return the highest priority one
    if (favicons.length > 0) {
        favicons.sort((a, b) => b.priority - a.priority);
        return favicons[0];
    }
    
    // Fallback to looking for favicon.ico file directly
    const faviconFile = files.find(file => file.path === 'favicon.ico');
    return faviconFile ? {
        path: 'favicon.ico',
        cid: faviconFile.cid,
        isDataUrl: false
    } : {
        path: '',
        cid: null,
        isDataUrl: false
    };
}

function getFaviconPriority(ext) {
    const priority = {
        'ico': 100,
        'png': 90,
        'jpg': 80,
        'jpeg': 80,
        'gif': 70,
        'svg': 60,
        'webp': 50
    };
    return priority[ext] || 0;
}

function addToReportIfNotEmpty(report, analysis, filePath) {
    if (analysis && analysis.length > 0) {
        report.push({ file: filePath, occurences: analysis });
    }
}