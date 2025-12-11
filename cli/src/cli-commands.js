import { create as createKubo } from 'kubo-rpc-client'
import { promises as fs } from 'fs'
import { ScanManager } from './scan-manager.js'
import { AnalyzeManager } from './analyze-manager.js'
import { IndexBuilder } from './index-builder.js'
import { calculateRankScore } from './rank-calculator.js'
import { logger } from './logger.js'
import { FilesystemStorage, MFSStorage } from './storage-interface.js'
import { MFS_ROOT_PATH, DEFAULT_DATA_POINTER_FILE } from './constants.js'

// Helper to create storage based on options
function createStorage(options, kubo = null) {
    if (options.useMfs) {
        if (!kubo) {
            kubo = createKubo({ url: options.ipfs })
        }
        const dataPointerPath = options.dataPointer || DEFAULT_DATA_POINTER_FILE
        return new MFSStorage(kubo, `/${MFS_ROOT_PATH}`, dataPointerPath)
    } else {
        if (!options.directory) {
            throw new Error('--directory (-d) option is required when --use-mfs=false')
        }
        return new FilesystemStorage(options.directory)
    }
}

// Helper to save data pointer (MFS root CID)
// NOTE: This is now automatically called during storage.flush() for MFS storage
// Kept here for potential manual/debugging use cases
async function saveDataPointer(storage, options) {
    const rootCid = await storage.getRootCID()
    if (rootCid) {
        const dataPointerPath = options.dataPointer || DEFAULT_DATA_POINTER_FILE
        await fs.writeFile(dataPointerPath, rootCid)
        logger.info(`Data pointer updated: ${rootCid}`)
        logger.info(`  View at: /ipfs/${rootCid}`)
    }
}

// Helper to read previous CID from data pointer file
async function readPreviousCID(options) {
    try {
        const dataPointerPath = options.dataPointer || DEFAULT_DATA_POINTER_FILE
        const cid = await fs.readFile(dataPointerPath, 'utf-8')
        return cid.trim()
    } catch (error) {
        return null
    }
}

// Helper to rollback MFS to previous state
async function rollbackToState(storage, previousCid) {
    if (!(storage instanceof MFSStorage)) {
        return // Rollback only works with MFS
    }
    
    try {
        logger.info(`Rolling back to previous state: ${previousCid}`)
        
        // Clear current MFS state and restore from previous CID
        await storage.kubo.files.rm(storage.rootPath, { recursive: true })
        await storage.kubo.files.cp(`/ipfs/${previousCid}`, storage.rootPath)
        
        // Flush will automatically update the data pointer to the rolled-back state
        await storage.flush()
        
        logger.success('Rollback completed')
    } catch (error) {
        logger.error(`Rollback failed: ${error.message}`)
        throw error
    }
}

// Scan command
export async function scanCommand(options) {
    try {
        const storage = createStorage(options)
        const storageType = options.useMfs ? 'MFS' : 'filesystem'
        logger.info(`Starting contenthash scan using ${storageType} storage`)
        
        const scanManager = new ScanManager(storage)
        await scanManager.initialize()
        
        // Get the last scanned block number
        const lastScanHeight = await scanManager.getLastScanHeight()
        logger.info(`Last scan height: ${lastScanHeight}`)
        
        // Start scanning from the last scanned block - 1
        const fromBlock = lastScanHeight - 1
        logger.info(`Scanning from block: ${fromBlock}`)
        
        // Perform the scan
        const result = await scanManager.scanContenthashChanges(fromBlock)
        
        logger.success(`Scan completed successfully!`)
        logger.info(`Total changes processed: ${result.totalChanges}`)
        logger.info(`Final block height: ${result.lastBlockNumber}`)
        
    } catch (error) {
        logger.error('Scan failed')
        logger.error(`Error: ${error.message}`)
        process.exit(1)
    }
}

// Analyze command
export async function analyzeCommand(ensName, options) {
    try {
        // Validate dry-run flag
        if (options.dryRun) {
            const validTypes = ['governance', 'networking', 'distribution', 'all']
            if (!validTypes.includes(options.dryRun)) {
                logger.error(`--dry-run must be one of: ${validTypes.join(', ')}`)
                process.exit(1)
            }
            
            if (!ensName) {
                logger.error('--dry-run can only be used when analyzing a specific ENS name')
                process.exit(1)
            }
        }

        const kubo = createKubo({ url: options.ipfs })
        const storage = createStorage(options, kubo)
        const storageType = options.useMfs ? 'MFS' : 'filesystem'
        logger.info(`Starting analysis using ${storageType} storage`)
        
        const analyzeManager = new AnalyzeManager(storage, kubo, options.force, options.cache, options.rpc)
        await analyzeManager.initialize()
        
        if (ensName) {
            logger.info(`Analyzing only ENS name: ${ensName}`)
            if (options.dryRun) {
                await analyzeManager.dryRunAnalysis(ensName, options.dryRun)
            } else {
                await analyzeManager.analyzeSpecificName(ensName)
            }
        } else if (options.backwards) {
            logger.info('Analyzing backwards from oldest block number...')
            await analyzeManager.analyzeBackwards()
        } else {
            logger.info('Analyzing forwards from latest block number...')
            await analyzeManager.analyzeForwards()
        }
        
        logger.success('Analysis completed successfully!')
        
    } catch (error) {
        logger.error('Analysis failed')
        logger.error(`Error: ${error.message}`)
        
        // If there's a cause, show it for debugging
        if (error.cause) {
            logger.debug(`Technical details: ${error.cause.message}`)
        }
        logger.debug(error)
        
        process.exit(1)
    }
}

// Build indexes command
export async function buildIdxsCommand(options) {
    let previousCid = null
    let storage = null
    
    try {
        storage = createStorage(options)
        const storageType = options.useMfs ? 'MFS' : 'filesystem'
        logger.info(`Building indexes using ${storageType} storage`)
        
        // Save current state CID before starting (for rollback)
        if (options.useMfs) {
            previousCid = await readPreviousCID(options)
            if (previousCid) {
                logger.debug(`Previous state CID: ${previousCid}`)
            }
        }
        
        const indexBuilder = new IndexBuilder(storage)
        await indexBuilder.initialize()
        
        const stats = await indexBuilder.buildAllIndexes()
        
        if (stats.scoredApps === 0) {
            logger.warn('No apps could be scored. No indexes created.')
            return
        }
        
        logger.success('Indexes built successfully!')
        logger.info(`Total apps in archive: ${stats.totalApps}`)
        logger.info(`Apps successfully scored: ${stats.scoredApps}`)
        logger.info(`Categories indexed: ${Object.keys(stats.categories).length}`)
        
        // Show per-category stats
        for (const [category, catStats] of Object.entries(stats.categories)) {
            logger.info(`  ${category}: ${catStats.totalRanges} ranges`)
        }
        
        logger.info(`Completed in ${stats.elapsedSeconds}s`)
        
    } catch (error) {
        logger.error('Failed to build indexes')
        logger.error(`Error: ${error.message}`)
        
        // Attempt rollback if we have a previous state
        if (previousCid && storage) {
            try {
                await rollbackToState(storage, previousCid)
            } catch (rollbackError) {
                logger.error(`Note: Rollback also failed: ${rollbackError.message}`)
            }
        }
        
        process.exit(1)
    }
}

// Rank command
export async function rankCommand(ensName, options) {
    try {
        if (!ensName) {
            logger.error('ENS name is required')
            process.exit(1)
        }

        const storage = createStorage(options)
        const archivePath = `/archive/${ensName}`
        
        // Check if archive directory exists
        if (!(await storage.exists(archivePath))) {
            logger.error(`No reports found for ${ensName}`)
            logger.error(`Please run: dapprank analyze ${ensName}`)
            process.exit(1)
        }
        
        // Get all block number directories
        let blockDirs
        try {
            blockDirs = await storage.listDirectory(archivePath)
        } catch (error) {
            logger.error(`Failed to read archive directory: ${error.message}`)
            process.exit(1)
        }
        
        // Filter to only numeric directory names and sort to find latest
        const blockNumbers = blockDirs
            .filter(entry => entry.type === 'directory') // directories only
            .map(entry => parseInt(entry.name))
            .filter(num => !isNaN(num))
            .sort((a, b) => b - a) // Sort descending to get latest first
        
        if (blockNumbers.length === 0) {
            logger.error(`No valid block directories found for ${ensName}`)
            process.exit(1)
        }
        
        const latestBlockNumber = blockNumbers[0]
        logger.debug(`Found latest block number: ${latestBlockNumber}`)
        
        // Construct path to the latest report
        const reportDir = `/archive/${ensName}/${latestBlockNumber}`
        const reportPath = `${reportDir}/report.json`
        
        // Check if report exists
        if (!(await storage.exists(reportPath))) {
            logger.error(`Report file not found at: ${reportPath}`)
            process.exit(1)
        }
        
        // Load the report
        let report
        try {
            const reportContent = await storage.readFileString(reportPath)
            report = JSON.parse(reportContent)
        } catch (error) {
            logger.error(`Failed to load report for ${ensName}: ${error.message}`)
            process.exit(1)
        }
        
        // Calculate rank score
        let rankScore
        try {
            // Pass storage and report directory (where assets/ subfolder is located)
            rankScore = await calculateRankScore(report, storage, reportDir)
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
