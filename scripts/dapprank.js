#!/usr/bin/env node
import { create as createKubo } from 'kubo-rpc-client'
import { createPublicClient, http, namehash } from 'viem'
import { mainnet } from 'viem/chains'
import { program } from 'commander'
import { promises as fs } from 'fs'
import { join } from 'path'
import { base32 } from "multiformats/bases/base32"
import { CID } from "multiformats/cid"
import { glob } from 'glob'

const WEB3_APIs = [
    { url: 'http://localhost:5001', service: 'ipfs', risk: 'none' },
    { url: 'http://127.0.0.1:5001', service: 'ipfs', risk: 'none' },
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
const ANALYSIS_VERSION = 1

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
    .action(async (ensName, options) => {
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
        
        // Check if a report for this CID already exists
        if (await reportExistsForCID(ensName, rootCID)) {
            console.log(`Report for CID ${rootCID} already exists. Skipping...`);
            return;
        }
        
        // Generate and save report
        console.log(`Analyzing ${rootCID}...`);
        const { report, faviconInfo } = await generateReport(kubo, rootCID, blockNumber);
        await saveReport(report, ensName, blockNumber, kubo, faviconInfo);
        console.log(`Analysis complete for ${ensName}`);
    });

// Update command
program
    .command('update')
    .description('Update all existing reports')
    .action(async (options) => {
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
        try {
            const domainDirs = await fs.readdir(indexDir);
            
            console.log(`Found ${domainDirs.length} domains to check for updates`);
            
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
                }
            }
            
            console.log('\nUpdate completed!');
        } catch (error) {
            console.error(`Error accessing index directory: ${error.message}`);
            process.exit(1);
        }
    });

// Test command
program
    .command('test')
    .description('Test analysis for a CID without saving')
    .argument('<cid>', 'CID to analyze')
    .action(async (cid, options) => {
        const parentOptions = program.optsWithGlobals();
        const kubo = createKubo({ url: parentOptions.ipfs });
        
        console.log(`Analyzing ${cid}...`);
        const { report } = await generateReport(kubo, cid);
        
        // Print report to console
        console.log(JSON.stringify(report, null, 2));
    });

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
            
            // Check if the CID matches
            return reportData.contentHash === cid;
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
        
        if (!contentHash || contentHash === '0x') return ''
        
        // Check if the contenthash starts with the IPFS protocol prefix
        if (contentHash.startsWith('0xe5010172')) {
            console.log('IPNS contenthash not supported')
            return ''
        } else if (!contentHash.startsWith('0xe3010170')) {
            console.log('Contenthash does not start with IPFS prefix')
            return ''
        }
        
        // Decode the contenthash - it's a hex string starting with 0xe3010170 (IPFS)
        // Remove 0x and the protocol prefix (e3010170)
        const ipfsHex = contentHash.slice(10)
        // Convert hex to bytes
        const bytes = new Uint8Array(ipfsHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
        
        // Convert to CIDv1
        const cidv1 = CID.decode(bytes).toV1()
        // Return as base32 string
        return cidv1.toString(base32)
    } catch (error) {
        console.log(`Error resolving ENS name ${ensName}:`, error)
        // Log the full error stack for debugging
        console.log('Full error:', error.stack)
        return ''
    }
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

async function analyzeFile(kubo, cid, filePath) {
    console.log('analyzing', filePath)
    const fileType = filePath.split('.').pop();
    if (!['html', 'htm', 'js', 'svg'].some(ext => fileType === ext)) {
        // console.log(`Skipping non-target file type: ${filePath}`);
        return {};
    }

    const fileContentChunks = [];
    for await (const chunk of kubo.cat(cid)) {
        fileContentChunks.push(chunk);
    }
    const fileContent = Buffer.concat(fileContentChunks).toString();
    let scriptContent = []
    if (filePath.endsWith('js')) {
        scriptContent.push(fileContent)
    } else {
        const scriptTagRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptTagRegex.exec(fileContent)) !== null) {
            scriptContent.push(match[1]);
        }
    }

    // Analyze the file content for external resources loaded as the file is loaded
    const analysis = {
        distributionPurity: analyzeDistributionPurity(fileContent),
        networkingPurity: analyzeNetworkingPurity(scriptContent)
    }
    return analysis;
}

function analyzeNetworkingPurity(scriptContents) {
    const analysis = {
        http: [],
        websocket: [],
        webrtc: [],
        web3: []
    };
    const webrtcRegex = /\b(RTCPeerConnection|RTCDataChannel)\b/gi;
    const websocketRegex = /(wss:\/\/|ws:\/\/)[^\s'"]+/gi;
    const httpResourceRegex = /(?<!href.{0,20})(?<=["'`])(https|http):\/\/[^\s"'`]+/gi;
    const ethereumRegex = /window\.ethereum\b/;
    let match;

    scriptContents.forEach(content => {
        // http apis
        while ((match = httpResourceRegex.exec(content)) !== null) {
            // ignore w3.org svg
            const url = match[0];
            const { service, risk } = WEB3_APIs.find(api => url.includes(api.url)) || {};
            if (service) {
                analysis.web3.push({ service, url, risk });
            } else if (!url.includes('w3.org') && !url.includes('svg')) {
                analysis.http.push(url);
            }
        }
        
        // Find WebSocket calls
        while ((match = websocketRegex.exec(content)) !== null) {
            analysis.websocket.push( match[0] );
        }

        // // Find WebRTC calls
        while ((match = webrtcRegex.exec(content)) !== null) {
            analysis.webrtc.push(match[0]);
        }

        // // find Ethereum usage
        if (ethereumRegex.test(content)) {
            analysis.web3.push({ service: 'ethereum', url: 'window.ethereum', risk: 'none' });
        }
    })
    return analysis;
}

function analyzeDistributionPurity(fileContent) {
    const analysis = {
        externalMedia: [],
        externalScripts: []
    };
    const tagRegex = /<(img|video|iframe|audio|source|object|embed|track|link|script)\s+[^>]*?\b(src|href)=["']([^"']*)["'][^>]*>/gi;
    let match;
    while ((match = tagRegex.exec(fileContent)) !== null) {
        let [fullMatch, type, attr, url] = match;
        if (url.startsWith('http')) {
            if (type === 'link') {
                const relRegex = /\brel=["']([^"']*)["']/i;
                const match = relRegex.exec(fullMatch);
                const rel = match ? match[1] : null
                if (rel && LINK_NON_FETCHING_REL_VALUES.includes(rel.toLowerCase())) {
                    continue
                }
            }
            if (type === 'iframe' || type === 'script' || attr === 'href') {
                analysis.externalScripts.push({ type, url });
            } else {
                analysis.externalMedia.push({ type, url });
            }
        }
    }
    return analysis;
}

async function generateReport(kubo, rootCID, blockNumber = null) {
    try {
        const files = await getFilesFromCID(kubo, rootCID);

        const report = {
            version: ANALYSIS_VERSION,
            contentHash: rootCID,
            timestamp: Math.floor(Date.now() / 1000),
            blockNumber: blockNumber ? Number(blockNumber) : null,
            totalSize: 0,
            favicon: '',
            title: '',
            distributionPurity: {
                externalScripts: [],
                externalMedia: [],
            },
            networkingPurity: {
                http: [],
                websocket: [],
                webrtc: [],
            },
            web3: []
        };
        let faviconInfo = null;

        console.log(`Analyzing ${files.length} files`);
        for (const file of files) {
            // Extract title from index.html
            if (file.path.toLowerCase() === 'index.html' || (file.path === '' && file.type === 'file')) {
                const content = [];
                for await (const chunk of kubo.cat(file.cid)) {
                    content.push(chunk);
                }
                const htmlContent = Buffer.concat(content).toString();
                const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
                report.title = titleMatch ? titleMatch[1].trim() : '';

                faviconInfo = getFaviconPath(htmlContent, files);
                report.favicon = faviconInfo.path;
            }

            const analysis = await analyzeFile(kubo, file.cid, file.path);
            report.totalSize += file.size;
            addToReportIfNotEmpty(report.distributionPurity.externalScripts, analysis.distributionPurity?.externalScripts, file.path);
            addToReportIfNotEmpty(report.distributionPurity.externalMedia, analysis.distributionPurity?.externalMedia, file.path);
            addToReportIfNotEmpty(report.networkingPurity.http, analysis.networkingPurity?.http, file.path);
            addToReportIfNotEmpty(report.networkingPurity.websocket, analysis.networkingPurity?.websocket, file.path);
            addToReportIfNotEmpty(report.networkingPurity.webrtc, analysis.networkingPurity?.webrtc, file.path);
            addToReportIfNotEmpty(report.web3, analysis.networkingPurity?.web3, file.path);
        }

        console.log(`Total size: ${(report.totalSize / 1024 / 1024).toFixed(2)} MB`);
        return { report, faviconInfo };
    } catch (error) {
        console.error(`Error generating report: ${error.message}`);
        console.log(error);
    }
}

function getFaviconPath(htmlContent, files) {
    // Look for all favicon links in head
    const faviconRegex = /<link[^>]*(?:rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["'])[^>]*>/gi;
    const favicons = [];
    let match;
    
    while ((match = faviconRegex.exec(htmlContent)) !== null) {
        const href = match[1] || match[2];
        
        // Check if this is a data URL
        if (href.startsWith('data:')) {
            // Extract mime type and data
            const dataUrlMatch = /data:([^;]+);([^,]+),(.+)/.exec(href);
            if (dataUrlMatch) {
                const mimeType = dataUrlMatch[1];
                const encoding = dataUrlMatch[2];
                const data = dataUrlMatch[3];
                
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
            continue;
        }
        
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
    }

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
        report.push({ file: filePath, offenders: analysis });
    }
}