#!/usr/bin/env node
// Load environment variables from .env file
import * as dotenv from 'dotenv'
dotenv.config()

import { create as createKubo } from 'kubo-rpc-client'
import { createPublicClient, http, namehash, encodeFunctionData, decodeAbiParameters } from 'viem'
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

// Address of the Universal Resolver contract on mainnet
const UNIVERSAL_RESOLVER_ADDRESS = '0x64969fb44091A7E5fA1213D30D7A7e8488edf693'

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

// Create a stable hash for the system prompt to make sure it's consistent across runs
// Store this at the top level so it's calculated once
const SYSTEM_PROMPT_TEMPLATE = `
Analyze the provided JavaScript code and answer the following questions thouroughly.

1. What top level javascript libraries are being used?
    - name: explicity name or descriptive title of the library
    - motivation: say why you concluded the code uses this library (formatted as markdown)
2. What calls are there to networking libraries, and what url is being passed?
    - method: look only for fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket, WebSocketStream, EventSource, RTCPeerConnection
    - urls: best guess at what url is being passed to the function call (if multiple, return all), don't list urls that are not part of the codebase at all, don't include api keys
    - library: best guess if this call originates from one of the libraries from (1), or otherwise
    - type: one of:
        - rpc: urls that are ethereum rpc endpoints
        - bundler: urls that are 4337 account abstraction bundler endpoints
        - auxiliary: any other urls that likely are used to make network requests
        - self: urls that are relative to the current domain, e.g. /path/to/resource
    - motivation: say why you concluded the given url, the library being used, and/or how data is passed to the call (formatted as markdown), make sure to exclude api keys and other sensitive information
3. What dappspec fallback is supported? These are query parameters that can be used to specify backup url endpoints for common services.
    - type: one of:
        - rpc: provided through '?ds-rpc-<CHAIN_ID>=url'
        - bundler: provided through '?ds-bundler-<CHAIN_ID>=url'
        - dservice-self: provided through '?dservice=url'
        - dservice-external: provided through '?ds-<ens-name>=url'
    - motivation: say why you concluded that the script supports parsing and using these query parameters (formatted as markdown)


Return ONLY valid JSON that conforms to this OpenAPI 3.0 schema:

{
  "openapi": "3.0.0",
  "info": {
    "title": "JavaScript Analysis Schema",
    "version": "1.0.0"
  },
  "components": {
    "schemas": {
      "AnalysisResult": {
        "type": "object",
        "required": ["libraries", "networking"],
        "properties": {
          "libraries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "motivation"],
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Name or descriptive title of the library"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why this library was identified"
                }
              }
            }
          },
          "networking": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["method", "urls", "type", "motivation"],
              "properties": {
                "method": {
                  "type": "string",
                  "description": "Method of network API call"
                },
                "urls": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "URLs being accessed by the API call"
                },
                "library": {
                  "type": "string",
                  "description": "Library that makes the network call"
                },
                "type": {
                  "type": "string",
                  "enum": ["rpc", "bundler", "auxiliary", "self"],
                  "description": "Classification of the URL"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why these URLs were identified"
                }
              }
            }
          },
          "fallbacks": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type", "motivation"],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": ["rpc", "bundler", "dservice-self", "dservice-external"],
                  "description": "Type of dappspec fallback supported"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why this fallback is identified as supported"
                }
              }
            }
          }
        }
      }
    }
  }
}

Your response should be a JSON object that conforms to the AnalysisResult schema. If no API calls of a certain type are found, return an empty array for that type.
`;

// Calculate a hash of the prompt template to use as part of the cache key
const PROMPT_HASH = crypto.createHash('sha256').update(SYSTEM_PROMPT_TEMPLATE).digest('hex').slice(0, 8);
console.log(`Using prompt template with hash: ${PROMPT_HASH}`);

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

// Resolve ENS name using Universal Resolver contract
async function resolveENSName(client, ensName, blockNumber) {
    try {
        console.log(`Resolving ${ensName} using Universal Resolver...`)
        
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
            console.log(`Error calling Universal Resolver for ${ensName}:`, error.message)
            return [null, null]
        })
        
        if (resolveResult && resolveResult !== '0x') {
            console.log(`Successfully resolved ${ensName} with Universal Resolver. Resolver: ${resolverAddress}`)
            
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
                console.log(`Error decoding result from Universal Resolver:`, decodeError.message)
                // If decoding fails, try direct processing as fallback
                return processContentHash(resolveResult)
            }
        }
        
        console.log(`Could not resolve ${ensName} using Universal Resolver`)
        return ''
    } catch (error) {
        console.log(`Error in Universal Resolver for ${ensName}:`, error)
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

    // Check and save dappspec.json if it exists
    try {
        const dappspecFile = await getDappspecJson(kubo, report.contentHash)
        if (dappspecFile) {
            const dappspecPath = join(archiveDir, 'dappspec.json')
            await fs.writeFile(dappspecPath, JSON.stringify(dappspecFile, null, 2))
            console.log(`Dappspec saved to ${dappspecPath}`)
        }
    } catch (error) {
        console.log(`No dappspec.json found: ${error.message}`)
    }

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

/**
 * Fetch and parse the .well-known/dappspec.json file if it exists in the IPFS content
 * @param {Object} kubo - IPFS Kubo client instance
 * @param {string} rootCID - The CID of the IPFS content
 * @returns {Object|null} The parsed dappspec.json content or null if not found
 */
async function getDappspecJson(kubo, rootCID) {
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
        urls: [],
        ethereum: [],
        fallbacks: []
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
        
        // Create a hash of the script content combined with the prompt hash
        // This ensures the cache is invalidated if either the script or the prompt changes
        const scriptHash = crypto.createHash('sha256').update(scriptText).digest('hex');
        const combinedHash = `${scriptHash}_${PROMPT_HASH}`;
        
        // Check if we already have an analysis for this script content and prompt
        if (scriptAnalysisCache.has(combinedHash)) {
            console.log(`Using cached analysis for ${filePath}`);
            const cachedResult = scriptAnalysisCache.get(combinedHash);
            
            // Initialize the returning result object
            const cachedAnalysis = {
                libraries: cachedResult.libraries || [],
                networking: cachedResult.networking || [],
                urls: cachedResult.urls || [],
                fallbacks: cachedResult.fallbacks || [],
                ethereum: result.ethereum // Use current ethereum detection result
            };
            return cachedAnalysis;
        }
        
        // Load API key from environment variable
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            throw new Error('GOOGLE_API_KEY environment variable not set');
        }
        
        // Initialize the Google Generative AI client
        const ai = new GoogleGenAI({ apiKey });
        
        // Use the system prompt template defined at the top level
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE;
        
        // Define the response schema structure
        const responseSchema = {
            type: "object",
            required: ["libraries", "networking", "urls"],
            properties: {
                libraries: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["name", "motivation"],
                        properties: {
                            name: { type: "string" },
                            motivation: { type: "string" }
                        }
                    }
                },
                networking: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["method", "urls", "type", "motivation"],
                        properties: {
                            method: { type: "string" },
                            urls: { 
                                type: "array",
                                items: { type: "string" }
                            },
                            library: { type: "string" },
                            type: { 
                                type: "string",
                                enum: ["rpc", "bundler", "auxiliary", "self"]
                            },
                            motivation: { type: "string" }
                        }
                    }
                },
                fallbacks: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["type", "motivation"],
                        properties: {
                            type: { 
                                type: "string",
                                enum: ["rpc", "bundler", "dservice-self", "dservice-external"]
                            },
                            motivation: { type: "string" }
                        }
                    }
                }
            }
        };

        // Query the Gemini model with structured output
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
            },
            response_mime_type: "application/json",
            response_schema: responseSchema
        });
        
        console.log(`Received response from Gemini for ${filePath}`);
        
        try {
            // In the Gemini 1.x API, the response is accessed through the text property
            // In the Gemini 2.x API with structured output, we access it through parsed
            let parsedAnalysis;
            
            try {
                // First try to access it as a structured response
                parsedAnalysis = response.candidates?.[0].content?.parts?.[0]?.functionCall?.args;
                
                // If that doesn't work, try direct access to text
                if (!parsedAnalysis) {
                    // For Gemini 1.x
                    if (typeof response.text === 'function') {
                        const responseText = response.text();
                        console.log(`Using text() method for ${filePath}`);
                        
                        // Check for markdown code blocks
                        const markdownMatch = responseText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
                        if (markdownMatch) {
                            console.log(`Found markdown JSON block in text() for ${filePath}`);
                            parsedAnalysis = JSON.parse(markdownMatch[1]);
                        } else {
                            parsedAnalysis = JSON.parse(responseText);
                        }
                    } 
                    // For Gemini 2.x text access
                    else if (response.text) {
                        console.log(`Using text property for ${filePath}`);
                        
                        // Check for markdown code blocks
                        const markdownMatch = response.text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
                        if (markdownMatch) {
                            console.log(`Found markdown JSON block in text property for ${filePath}`);
                            parsedAnalysis = JSON.parse(markdownMatch[1]);
                        } else {
                            parsedAnalysis = JSON.parse(response.text);
                        }
                    }
                    // Direct parts access - combine all parts
                    else if (response.parts && response.parts.length > 0) {
                        console.log(`Using parts access for ${filePath}`);
                        // Combine all text parts to handle fragmented responses
                        const textContent = response.parts.map(part => part.text || '').join('');
                        
                        // Check for markdown code blocks
                        const markdownMatch = textContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
                        if (markdownMatch) {
                            console.log(`Found markdown JSON block in parts for ${filePath}`);
                            parsedAnalysis = JSON.parse(markdownMatch[1]);
                        } else {
                            parsedAnalysis = JSON.parse(textContent);
                        }
                    }
                    else {
                        throw new Error('Could not access response content');
                    }
                }
            } catch (accessError) {
                console.error(`Error accessing response content: ${accessError.message}`);
                // Last attempt - try to stringify the entire response and extract JSON
                const responseStr = JSON.stringify(response);
                console.log(`Fallback: Stringifying entire response for ${filePath}`);
                
                // Extract candidates text parts and join them if available
                try {
                    if (response.candidates && response.candidates[0] && 
                        response.candidates[0].content && response.candidates[0].content.parts) {
                        
                        const parts = response.candidates[0].content.parts;
                        // Combine all text parts
                        const combinedText = parts.map(part => part.text || '').join('');
                        console.log(`Extracted combined text from candidates for ${filePath}`);
                        
                        // Check for markdown code blocks
                        const markdownMatch = combinedText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
                        if (markdownMatch) {
                            console.log(`Found markdown JSON block in combined candidates for ${filePath}`);
                            parsedAnalysis = JSON.parse(markdownMatch[1]);
                            return; // Skip remaining fallbacks if successful
                        } else {
                            // Try parsing as direct JSON
                            parsedAnalysis = JSON.parse(combinedText);
                            return; // Skip remaining fallbacks if successful
                        }
                    }
                } catch (candidateError) {
                    console.log(`Error parsing combined candidates: ${candidateError.message}`);
                    // Continue to next fallback
                }
                
                // Check if response contains a markdown code block in stringified form
                const markdownMatch = responseStr.match(/"text":"```json\s*(\{[\s\S]*?\})\s*```"/);
                if (markdownMatch) {
                    try {
                        // Extract the JSON content from within the markdown code block
                        console.log(`Found markdown JSON block in stringified response for ${filePath}`);
                        const jsonContent = markdownMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
                        parsedAnalysis = JSON.parse(jsonContent);
                    } catch (markdownParseError) {
                        console.error(`Error parsing markdown JSON: ${markdownParseError.message}`);
                        // Fall through to next attempt
                    }
                }
                
                // If we still don't have a valid result, try even more aggressive pattern matching
                if (!parsedAnalysis) {
                    console.log(`Attempting more aggressive JSON extraction for ${filePath}`);
                    // Extract any JSON-like structure from the response string
                    try {
                        // Look for any JSON object pattern in the response
                        const jsonPattern = /\{(?:[^{}]|"(?:\\"|[^"])*"|\{(?:[^{}]|"(?:\\"|[^"])*")*\})*\}/g;
                        const matches = responseStr.match(jsonPattern);
                        
                        if (matches && matches.length > 0) {
                            // Try each match until we find a valid one
                            for (const match of matches) {
                                try {
                                    // Clean up escaped characters
                                    const cleanedMatch = match
                                        .replace(/\\"/g, '"')
                                        .replace(/\\n/g, '\n')
                                        .replace(/\\\\/g, '\\');
                                    
                                    const potentialJson = JSON.parse(cleanedMatch);
                                    
                                    // Check if it has the expected structure
                                    if (potentialJson && 
                                        (potentialJson.libraries !== undefined || 
                                         potentialJson.networking !== undefined || 
                                         potentialJson.urls !== undefined)) {
                                        
                                        console.log(`Found valid JSON structure in aggressive extraction for ${filePath}`);
                                        parsedAnalysis = potentialJson;
                                        break;
                                    }
                                } catch (matchParseError) {
                                    // Continue trying other matches
                                }
                            }
                        }
                        
                        if (!parsedAnalysis) {
                            // If all else fails, try the original regex approach
                            const jsonMatch = responseStr.match(/"text":"([^"]*)"/) || responseStr.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                const jsonContent = jsonMatch[1] ? jsonMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : jsonMatch[0];
                                parsedAnalysis = JSON.parse(jsonContent);
                            } else {
                                throw new Error('No JSON content found in response');
                            }
                        }
                    } catch (finalError) {
                        throw new Error(`Failed to extract JSON from response: ${finalError.message}`);
                    }
                }
            }
            
            if (!parsedAnalysis) {
                throw new Error('No valid analysis data extracted from response');
            }
            
            // Process the results 
            if (parsedAnalysis.networking && parsedAnalysis.networking.length > 0) {
                result.networking = parsedAnalysis.networking;
            }
            
            if (parsedAnalysis.libraries && parsedAnalysis.libraries.length > 0) {
                result.libraries = parsedAnalysis.libraries;
            }

            if (parsedAnalysis.urls && parsedAnalysis.urls.length > 0) {
                result.urls = parsedAnalysis.urls;
            }
            
            if (parsedAnalysis.fallbacks && parsedAnalysis.fallbacks.length > 0) {
                result.fallbacks = parsedAnalysis.fallbacks;
            }
            
            // Store in cache for future use - use combined hash with all data
            scriptAnalysisCache.set(combinedHash, {
                libraries: result.libraries,
                networking: result.networking,
                urls: result.urls,
                fallbacks: result.fallbacks
            });
            
            console.log(`Successfully analyzed ${filePath}`);
        } catch (jsonError) {
            console.error(`Error parsing JSON response for ${filePath}:`, jsonError);
            // Safely log response by converting to string first
            const safeResponseStr = typeof response === 'object' ? 
                JSON.stringify(response, null, 2).substring(0, 500) + '...' : 
                String(response).substring(0, 500) + '...';
            console.error("Response:", safeResponseStr);
            throw new Error(`Failed to parse AI analysis response for ${filePath}: ${jsonError.message}`);
        }
    } catch (aiError) {
        console.error(`Error in script analysis for ${filePath}:`, aiError);
        throw aiError; // Re-throw the error to fail the entire process
    }
    
    // Return the final result after successful analysis
    return result;
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
            urls: [],
            ethereum: [], // Field to store unique files that access window.ethereum
            fallbacks: [] // New field to store dappspec fallback support
        };
        
        let faviconInfo = null;
        let indexHtmlContent = null;

        // Process all files
        for (const file of files) {
            report.totalSize += file.size;

            if (file.path.includes('.well-known/source.git')) continue
            if (file.path === '.well-known/dappspec.json') continue
            
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
                            // Add urls findings to the report
                            addToReportIfNotEmpty(report.urls, scriptAnalysis.urls, inlineScriptPath);
                            // Add dappspec fallback findings to the report
                            addToReportIfNotEmpty(report.fallbacks, scriptAnalysis.fallbacks, inlineScriptPath);
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
                    // Add urls findings to the report
                    addToReportIfNotEmpty(report.urls, scriptAnalysis.urls, file.path);
                    // Add dappspec fallback findings to the report
                    addToReportIfNotEmpty(report.fallbacks, scriptAnalysis.fallbacks, file.path);
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