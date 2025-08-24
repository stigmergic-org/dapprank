import { create as createKubo } from 'kubo-rpc-client'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { promises as fs } from 'fs'
import { join } from 'path'
import { resolveENSName } from './ens-resolver.js'
import { generateReport, saveReport, reportExistsForCID } from './report-generator.js'
import { loadScriptAnalysisCache, saveScriptAnalysisCache } from './cache-manager.js'
import { ScanManager } from './scan-manager.js'
import { AnalyzeManager } from './analyze-manager.js'

// Add command
export async function addCommand(ensName, options, parentOptions) {
    try {
        // Validate that this is an ENS name
        if (!ensName.endsWith('.eth')) {
            console.error('Error: Not a valid ENS name. Must end with .eth');
            process.exit(1);
        }

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
}

// Update command
export async function updateCommand(options, parentOptions) {
    try {
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
}

// Test command
export async function testCommand(cid, options, parentOptions) {
    try {
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
}

// Scan command
export async function scanCommand(options, parentOptions) {
    try {
        if (!options.folder) {
            console.error('Error: --folder (-f) option is required');
            process.exit(1);
        }

        console.log(`Starting contenthash scan to folder: ${options.folder}`);
        
        const scanManager = new ScanManager(options.folder);
        await scanManager.initialize();
        
        // Get the last scanned block number
        const lastScanHeight = await scanManager.getLastScanHeight();
        console.log(`Last scan height: ${lastScanHeight}`);
        
        // Start scanning from the last scanned block - 1
        const fromBlock = lastScanHeight - 1;
        console.log(`Scanning from block: ${fromBlock}`);
        
        // Perform the scan
        const result = await scanManager.scanContenthashChanges(fromBlock);
        
        console.log(`\nScan completed successfully!`);
        console.log(`Total changes processed: ${result.totalChanges}`);
        console.log(`Final block height: ${result.lastBlockNumber}`);
        
    } catch (error) {
        console.error('Fatal error during scan:', error);
        process.exit(1);
    }
}

// Analyze command
export async function analyzeCommand(ensName, options, parentOptions) {
    try {
        if (!options.folder) {
            console.error('Error: --folder (-f) option is required');
            process.exit(1);
        }

        console.log(`Starting analysis of scanned results in folder: ${options.folder}`);
        
        const kubo = createKubo({ url: parentOptions.ipfs });
        const analyzeManager = new AnalyzeManager(options.folder, kubo);
        await analyzeManager.initialize();
        
        if (ensName) {
            console.log(`Analyzing only ENS name: ${ensName}`);
            await analyzeManager.analyzeSpecificName(ensName);
        } else if (options.backwards) {
            console.log('Analyzing backwards from oldest block number...');
            await analyzeManager.analyzeBackwards();
        } else {
            console.log('Analyzing forwards from latest block number...');
            await analyzeManager.analyzeForwards();
        }
        
        console.log('\nAnalysis completed successfully!');
        
    } catch (error) {
        console.error('Fatal error during analysis:', error);
        process.exit(1);
    }
}

// Initialize cache
export async function initializeCache() {
    await loadScriptAnalysisCache();
}
