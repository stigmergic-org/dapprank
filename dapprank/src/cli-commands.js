import { create as createKubo } from 'kubo-rpc-client'
import { promises as fs } from 'fs'
import { ScanManager } from './scan-manager.js'
import { AnalyzeManager } from './analyze-manager.js'

// Scan command
export async function scanCommand(options) {
    try {
        if (!options.directory) {
            console.error('Error: --directory (-d) option is required');
            process.exit(1);
        }

        console.log(`Starting contenthash scan to directory: ${options.directory}`);
        
        const scanManager = new ScanManager(options.directory);
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
        console.error('\n❌ Scan failed');
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Analyze command
export async function analyzeCommand(ensName, options) {
    try {
        if (!options.directory) {
            console.error('Error: --directory (-d) option is required');
            process.exit(1);
        }

        // Validate dry-run flag
        if (options.dryRun) {
            const validTypes = ['governance', 'networking', 'distribution', 'all'];
            if (!validTypes.includes(options.dryRun)) {
                console.error(`Error: --dry-run must be one of: ${validTypes.join(', ')}`);
                process.exit(1);
            }
            
            if (!ensName) {
                console.error('Error: --dry-run can only be used when analyzing a specific ENS name');
                process.exit(1);
            }
        }

        console.log(`Starting analysis of scanned results in directory: ${options.directory}`);
        
        const kubo = createKubo({ url: options.ipfs });
        const analyzeManager = new AnalyzeManager(options.directory, kubo, options.force, options.cache, options.rpc);
        await analyzeManager.initialize();
        
        if (ensName) {
            console.log(`Analyzing only ENS name: ${ensName}`);
            if (options.dryRun) {
                await analyzeManager.dryRunAnalysis(ensName, options.dryRun);
            } else {
                await analyzeManager.analyzeSpecificName(ensName);
            }
        } else if (options.backwards) {
            console.log('Analyzing backwards from oldest block number...');
            await analyzeManager.analyzeBackwards();
        } else {
            console.log('Analyzing forwards from latest block number...');
            await analyzeManager.analyzeForwards();
        }
        
        console.log('\nAnalysis completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Analysis failed');
        console.error(`Error: ${error.message}`);
        
        // If there's a cause, show it for debugging
        if (error.cause) {
            console.error(`\nTechnical details: ${error.cause.message}`);
        }
        console.error(error)
        
        process.exit(1);
    }
}