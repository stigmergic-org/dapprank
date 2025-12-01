import { create as createKubo } from 'kubo-rpc-client'
import { promises as fs } from 'fs'
import { ScanManager } from './scan-manager.js'
import { AnalyzeManager } from './analyze-manager.js'
import { logger } from './logger.js'

// Scan command
export async function scanCommand(options) {
    try {
        if (!options.directory) {
            logger.error('--directory (-d) option is required');
            process.exit(1);
        }

        logger.info(`Starting contenthash scan to directory: ${options.directory}`);
        
        const scanManager = new ScanManager(options.directory);
        await scanManager.initialize();
        
        // Get the last scanned block number
        const lastScanHeight = await scanManager.getLastScanHeight();
        logger.info(`Last scan height: ${lastScanHeight}`);
        
        // Start scanning from the last scanned block - 1
        const fromBlock = lastScanHeight - 1;
        logger.info(`Scanning from block: ${fromBlock}`);
        
        // Perform the scan
        const result = await scanManager.scanContenthashChanges(fromBlock);
        
        logger.success(`Scan completed successfully!`);
        logger.info(`Total changes processed: ${result.totalChanges}`);
        logger.info(`Final block height: ${result.lastBlockNumber}`);
        
    } catch (error) {
        logger.error('Scan failed');
        logger.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Analyze command
export async function analyzeCommand(ensName, options) {
    try {
        if (!options.directory) {
            logger.error('--directory (-d) option is required');
            process.exit(1);
        }

        // Validate dry-run flag
        if (options.dryRun) {
            const validTypes = ['governance', 'networking', 'distribution', 'all'];
            if (!validTypes.includes(options.dryRun)) {
                logger.error(`--dry-run must be one of: ${validTypes.join(', ')}`);
                process.exit(1);
            }
            
            if (!ensName) {
                logger.error('--dry-run can only be used when analyzing a specific ENS name');
                process.exit(1);
            }
        }

        logger.info(`Starting analysis of scanned results in directory: ${options.directory}`);
        
        const kubo = createKubo({ url: options.ipfs });
        const analyzeManager = new AnalyzeManager(options.directory, kubo, options.force, options.cache, options.rpc);
        await analyzeManager.initialize();
        
        if (ensName) {
            logger.info(`Analyzing only ENS name: ${ensName}`);
            if (options.dryRun) {
                await analyzeManager.dryRunAnalysis(ensName, options.dryRun);
            } else {
                await analyzeManager.analyzeSpecificName(ensName);
            }
        } else if (options.backwards) {
            logger.info('Analyzing backwards from oldest block number...');
            await analyzeManager.analyzeBackwards();
        } else {
            logger.info('Analyzing forwards from latest block number...');
            await analyzeManager.analyzeForwards();
        }
        
        logger.success('Analysis completed successfully!');
        
    } catch (error) {
        logger.error('Analysis failed');
        logger.error(`Error: ${error.message}`);
        
        // If there's a cause, show it for debugging
        if (error.cause) {
            logger.debug(`Technical details: ${error.cause.message}`);
        }
        logger.debug(error);
        
        process.exit(1);
    }
}