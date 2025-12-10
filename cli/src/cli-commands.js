import { create as createKubo } from 'kubo-rpc-client'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ScanManager } from './scan-manager.js'
import { AnalyzeManager } from './analyze-manager.js'
import { IndexBuilder } from './index-builder.js'
import { calculateRankScore } from './rank-calculator.js'
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

// Build indexes command
export async function buildIdxsCommand(options) {
    try {
        if (!options.directory) {
            logger.error('--directory (-d) option is required');
            process.exit(1);
        }

        logger.info(`Building indexes in directory: ${options.directory}`);
        
        const indexBuilder = new IndexBuilder(options.directory);
        await indexBuilder.initialize();
        
        const stats = await indexBuilder.buildAllIndexes();
        
        logger.success('Indexes built successfully!');
        logger.info(`Live apps: ${stats.liveCount}`);
        logger.info(`Webapps: ${stats.webappsCount}`);
        logger.info(`Completed in ${stats.elapsedSeconds}s`);
        
    } catch (error) {
        logger.error('Failed to build indexes');
        logger.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Rank command
export async function rankCommand(ensName, options) {
    try {
        if (!options.directory) {
            logger.error('--directory (-d) option is required');
            process.exit(1);
        }

        if (!ensName) {
            logger.error('ENS name is required');
            process.exit(1);
        }

        // Look in archive directory and find latest block number
        const archivePath = join(options.directory, 'archive', ensName)
        
        // Check if archive directory exists
        try {
            await fs.access(archivePath)
        } catch (error) {
            logger.error(`No reports found for ${ensName}`)
            logger.error(`Expected archive location: ${archivePath}`)
            logger.error(`Please run: dapprank analyze ${ensName}`)
            process.exit(1)
        }
        
        // Get all block number directories
        let blockDirs
        try {
            blockDirs = await fs.readdir(archivePath, { withFileTypes: true })
        } catch (error) {
            logger.error(`Failed to read archive directory: ${error.message}`)
            process.exit(1)
        }
        
        // Filter to only numeric directory names and sort to find latest
        const blockNumbers = blockDirs
            .filter(entry => entry.isDirectory())
            .map(entry => parseInt(entry.name))
            .filter(num => !isNaN(num))
            .sort((a, b) => b - a) // Sort descending to get latest first
        
        if (blockNumbers.length === 0) {
            logger.error(`No valid block directories found for ${ensName}`)
            logger.error(`Location: ${archivePath}`)
            process.exit(1)
        }
        
        const latestBlockNumber = blockNumbers[0]
        logger.debug(`Found latest block number: ${latestBlockNumber}`)
        
        // Construct path to the latest report
        const reportDir = join(archivePath, latestBlockNumber.toString())
        const reportPath = join(reportDir, 'report.json')
        
        // Check if report exists
        try {
            await fs.access(reportPath)
        } catch (error) {
            logger.error(`Report file not found at: ${reportPath}`)
            process.exit(1)
        }
        
        // Load the report
        let report
        try {
            const reportContent = await fs.readFile(reportPath, 'utf8')
            report = JSON.parse(reportContent)
        } catch (error) {
            logger.error(`Failed to load report for ${ensName}: ${error.message}`)
            process.exit(1)
        }
        
        // Calculate rank score
        let rankScore
        try {
            // Pass the report directory (where assets/ subfolder is located)
            rankScore = await calculateRankScore(report, reportDir)
        } catch (error) {
            logger.error(`Failed to calculate rank: ${error.message}`)
            process.exit(1)
        }
        
        // Output the results
        if (options.json) {
            // JSON output
            console.log(JSON.stringify({
                ensName,
                ...rankScore
            }, null, 2))
        } else {
            // Text output with nice formatting
            const boxWidth = 45
            const hr = '─'.repeat(boxWidth - 2)
            
            console.log(`┌${hr}┐`)
            console.log(`│  Dapp Rank Score: ${ensName}${' '.repeat(Math.max(0, boxWidth - 23 - ensName.length))}│`)
            console.log(`├${hr}┤`)
            console.log(`│  Overall Score:        ${rankScore.overallScore.toString().padStart(3)} / ${rankScore.maxScore}${' '.repeat(boxWidth - 35)}│`)
            console.log(`├${hr}┤`)
            
            const formatCategory = (label, score, maxScore) => {
                const scoreStr = `${score} / ${maxScore}`
                const padding = boxWidth - 6 - label.length - scoreStr.length
                return `│  ${label}:${' '.repeat(Math.max(0, padding))}${scoreStr}${' '.repeat(2)}│`
            }
            
            console.log(formatCategory('Distribution', 
                rankScore.categories.distribution.score, 
                rankScore.categories.distribution.maxScore))
            console.log(formatCategory('Networking', 
                rankScore.categories.networking.score, 
                rankScore.categories.networking.maxScore))
            console.log(formatCategory('Governance', 
                rankScore.categories.governance.score, 
                rankScore.categories.governance.maxScore))
            console.log(formatCategory('Manifest', 
                rankScore.categories.manifest.score, 
                rankScore.categories.manifest.maxScore))
            console.log(`└${hr}┘`)
        }
        
    } catch (error) {
        logger.error('Rank command failed')
        logger.error(`Error: ${error.message}`)
        process.exit(1)
    }
}
