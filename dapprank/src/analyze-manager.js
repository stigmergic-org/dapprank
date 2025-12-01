import { promises as fs } from 'fs'
import { join } from 'path'
import { analyzeHTML, getWebmanifest, getFavicon } from './html-analyzer.js'
import { detectWindowEthereum, analyzeScript } from './script-analyzer.js'
import { ensContenthashToCID, detectMimeType, getFilesFromCID, getFileContent } from './ipfs-utils.js'
import { decodeContenthash } from './ens-utils.js'
import { analyzeOwner } from './analyze-owner.js'
import { Report } from './report.js'
import { CacheManager } from './cache-manager.js'


export class AnalyzeManager {
  #cacheManager
  
  constructor(directory, kubo, forceWrite = false, cachePath = null, rpcUrl = null) {
    this.directory = directory
    this.archivePath = join(directory, 'archive')
    this.statePath = join(directory, 'state.json')
    this.kubo = kubo
    this.forceWrite = forceWrite
    this.rpcUrl = rpcUrl
    this.#cacheManager = new CacheManager(cachePath)
  }

  async initialize() {
    // Create folder structure if it doesn't exist
    await fs.mkdir(this.directory, { recursive: true })
    await fs.mkdir(this.archivePath, { recursive: true })
    
    // Initialize analysis state if it doesn't exist
    try {
      await fs.access(this.statePath)
    } catch {
      // File doesn't exist, create with initial state
      await this.saveAnalysisState({ oldestAnalyzed: null, latestAnalyzed: null })
    }
  }

  async getAnalysisState() {
    try {
      const data = await fs.readFile(this.statePath, 'utf8')
      const state = JSON.parse(data)
      
      // Handle legacy state.json format that only has blockNumber or scannedUntil
      if (state.scannedUntil && !state.latestAnalyzed) {
        return { 
          scannedUntil: state.scannedUntil,  // Use new field name for scan command
          oldestAnalyzed: null, 
          latestAnalyzed: state.scannedUntil 
        }
      }
      
      return state
    } catch (error) {
      console.warn('Could not read analysis state, starting fresh:', error.message)
      return { oldestAnalyzed: null, latestAnalyzed: null }
    }
  }

  async saveAnalysisState(state) {
    try {
      // Read existing state to preserve scannedUntil field
      const existingData = await fs.readFile(this.statePath, 'utf8')
      const existingState = JSON.parse(existingData)
      
      // Merge new state with existing state, preserving scannedUntil
      const data = { 
        ...existingState,  // Preserve existing fields like scannedUntil
        ...state           // Override with new analysis state
      }
      
      await fs.writeFile(this.statePath, JSON.stringify(data, null, 2))
    } catch (error) {
      // If we can't read existing state, just save the new state
      const data = { ...state }
      await fs.writeFile(this.statePath, JSON.stringify(data, null, 2))
    }
  }

  async listArchiveFolders() {
    try {
      const entries = await fs.readdir(this.archivePath, { withFileTypes: true })
      const folders = entries.filter(entry => entry.isDirectory())
      
      const nameBlockPairs = []
      
      for (const folder of folders) {
        const name = folder.name
        const domainPath = join(this.archivePath, name)
        
        try {
          const blockDirs = await fs.readdir(domainPath, { withFileTypes: true })
          const blockNumbers = blockDirs
            .filter(entry => entry.isDirectory())
            .map(entry => parseInt(entry.name))
            .filter(num => !isNaN(num))
          
          if (blockNumbers.length > 0) {
            const latestNumber = Math.max(...blockNumbers)
            nameBlockPairs.push({ name, latestNumber })
          }
        } catch (error) {
          console.warn(`Could not read domain ${name}:`, error.message)
        }
      }
      
      // Sort by block number (ascending)
      return nameBlockPairs.sort((a, b) => a.latestNumber - b.latestNumber)
    } catch (error) {
      console.error('Error listing archive folders:', error)
      return []
    }
  }

  async analyzeForwards() {
    const state = await this.getAnalysisState()
    
    if (!state.latestAnalyzed) {
      throw new Error('No latest block number analyzed. Cannot analyze forwards without previous analysis.')
    }
    
    console.log(`Starting forward analysis from block ${state.latestAnalyzed}`)
    
    const nameBlockPairs = await this.listArchiveFolders()
    const toAnalyze = nameBlockPairs.filter(item => item.latestNumber > state.latestAnalyzed)
    
    if (toAnalyze.length === 0) {
      console.log('No new blocks to analyze')
      return
    }
    
    console.log(`Found ${toAnalyze.length} domains with new blocks to analyze`)
    
    let newLatestAnalyzed = state.latestAnalyzed
    let successCount = 0
    let failureCount = 0
    
    for (const { name, latestNumber } of toAnalyze) {
      try {
        await this.analyzeDomain(name, latestNumber)
        newLatestAnalyzed = Math.max(newLatestAnalyzed, latestNumber)
        successCount++
      } catch (error) {
        console.error(`Error analyzing ${name} at block ${latestNumber}:`, error.message)
        failureCount++
      }
    }
    
    // Update state only if we successfully analyzed all names at the new height
    if (newLatestAnalyzed > state.latestAnalyzed) {
      await this.saveAnalysisState({
        ...state,
        latestAnalyzed: newLatestAnalyzed
      })
      console.log(`Updated latest analyzed block to ${newLatestAnalyzed}`)
    }
    
    // Summary
    console.log(`\nForward analysis completed: ${successCount} succeeded, ${failureCount} failed`)
  }

  async analyzeBackwards() {
    const state = await this.getAnalysisState()
    
    // Determine starting point for backwards analysis
    let startBlock
    if (state.oldestAnalyzed) {
      startBlock = state.oldestAnalyzed
      console.log(`Starting backwards analysis from oldest analyzed block ${startBlock}`)
    } else if (state.scannedUntil) {
      startBlock = state.scannedUntil
      console.log(`Starting backwards analysis from scanned until block ${startBlock}`)
    } else {
      console.error('No reference point for backwards analysis, please run dapprank scan first')
    }
    
    // Now analyze blocks that are older than our starting point
    const nameBlockPairs = await this.listArchiveFolders()
    const toAnalyze = nameBlockPairs.filter(item => item.latestNumber <= startBlock)
    
    if (toAnalyze.length === 0) {
      console.log('No older blocks to analyze')
      return
    }
    
    console.log(`Found ${toAnalyze.length} domains with older blocks to analyze`)
    
    // Sort by block number descending for backwards analysis (newest to oldest)
    toAnalyze.sort((a, b) => b.latestNumber - a.latestNumber)
    
    let newOldestAnalyzed = startBlock
    let successCount = 0
    let failureCount = 0
    
    for (const { name, latestNumber } of toAnalyze) {
      console.log(`Analyzing ${name} at block ${latestNumber}`)
      try {
        await this.analyzeDomain(name, latestNumber)
        successCount++
      } catch (error) {
        console.error(`Error analyzing ${name} at block ${latestNumber}:`, error.message)
        failureCount++
      }
      newOldestAnalyzed = Math.min(newOldestAnalyzed, latestNumber)
      
      // Update state only if we successfully analyzed all names at the new height
      if (newOldestAnalyzed < startBlock) {
        await this.saveAnalysisState({
          ...state,
          oldestAnalyzed: newOldestAnalyzed
        })
        console.log(`Updated oldest analyzed block to ${newOldestAnalyzed}`)
      }
    }
    
    // Summary
    console.log(`\nBackwards analysis completed: ${successCount} succeeded, ${failureCount} failed`)
  }

  async analyzeSpecificName(targetName, analysisType = null) {
    console.log(`Analyzing specific ENS name: ${targetName}`)
    
    // Check if the target name exists in the archive
    const targetPath = join(this.archivePath, targetName)
    try {
      await fs.access(targetPath)
    } catch (error) {
      throw new Error(`ENS name ${targetName} not found in archive folder`)
    }
    
    // Get all block numbers for this specific name
    const blockDirs = await fs.readdir(targetPath, { withFileTypes: true })
    const blockNumbers = blockDirs
      .filter(entry => entry.isDirectory())
      .map(entry => parseInt(entry.name))
      .filter(num => !isNaN(num))
      .sort((a, b) => b - a) // Sort descending to get largest first
    
    if (blockNumbers.length === 0) {
      console.log(`No block data found for ${targetName}`)
      return
    }
    
    const largestBlock = blockNumbers[0]
    console.log(`Found largest block ${largestBlock} for ${targetName}`)
    
    // Only analyze the largest block number
    try {
      await this.analyzeDomain(targetName, largestBlock, analysisType)
      console.log(`Completed analysis for ${targetName}`)
    } catch (error) {
      // Format the error nicely and throw a cleaner version
      const cleanError = new Error(`Failed to analyze ${targetName} at block ${largestBlock}: ${error.message}`)
      cleanError.cause = error // Preserve the original error for debugging
      throw cleanError
    }
    
  }

  async dryRunAnalysis(targetName, analysisType) {
    console.log(`Dry run analysis for ${targetName} (${analysisType})`)
    
    // Check if the target name exists in the archive
    const targetPath = join(this.archivePath, targetName)
    try {
      await fs.access(targetPath)
    } catch (error) {
      throw new Error(`ENS name ${targetName} not found in archive folder`)
    }
    
    // Get all block numbers for this specific name
    const blockDirs = await fs.readdir(targetPath, { withFileTypes: true })
    const blockNumbers = blockDirs
      .filter(entry => entry.isDirectory())
      .map(entry => parseInt(entry.name))
      .filter(num => !isNaN(num))
      .sort((a, b) => b - a) // Sort descending to get largest first
    
    if (blockNumbers.length === 0) {
      console.log(`No block data found for ${targetName}`)
      return
    }
    
    const largestBlock = blockNumbers[0]
    console.log(`Found largest block ${largestBlock} for ${targetName}`)
    
    // Create a temporary report for dry run (in-memory only)
    const report = new Report(this.archivePath, targetName, largestBlock)
    
    // Determine which steps to run based on analysis type
    let stepsToRun
    if (analysisType === 'distribution') {
      stepsToRun = [...DISTRIBUTION_STEPS, ...CLEANUP_STEPS]
    } else if (analysisType === 'governance') {
      stepsToRun = [...GOVERNANCE_STEPS, ...CLEANUP_STEPS]
    } else if (analysisType === 'networking') {
      stepsToRun = [...NETWORKING_STEPS, ...CLEANUP_STEPS]
    } else if (analysisType === 'all') {
      stepsToRun = ANALYSIS_STEPS
    } else {
      throw new Error(`Unknown analysis type: ${analysisType}`)
    }
    
    const analysisUtils = { kubo: this.kubo, cache: this.#cacheManager, rpcUrl: this.rpcUrl }
    
    try {
      // Run the analysis steps
      for (const step of stepsToRun) {
        await step(report, analysisUtils)
      }
      
      // Output results to stdout as JSON
      console.log('\n--- DRY RUN RESULTS ---')
      console.log(JSON.stringify(report.content, null, 2))
      console.log('--- END RESULTS ---\n')
      
    } catch (error) {
      // Format the error nicely and throw a cleaner version
      const cleanError = new Error(`Failed to dry run analyze ${targetName} at block ${largestBlock}: ${error.message}`)
      cleanError.cause = error // Preserve the original error for debugging
      throw cleanError
    }
  }

  async analyzeDomain(name, blockNumber) {
    console.log(`Analyzing ${name} at block ${blockNumber}`)
    
    // Create a new Report instance for this name and block
    const report = new Report(this.archivePath, name, blockNumber)
    
    // Check if report already exists (skip if force is enabled)
    if (!this.forceWrite && await report.exists()) {
      console.log(`Report already exists for ${name} at block ${blockNumber}, skipping`)
      return
    }
    
    // Always run all steps for regular analysis
    const analysisUtils = { kubo: this.kubo, cache: this.#cacheManager, rpcUrl: this.rpcUrl }
    for (const step of ANALYSIS_STEPS) {
      await step(report, analysisUtils)
    }
    
    // Write the report to filesystem with force flag
    await report.write(this.forceWrite)
    console.log(`Analysis complete for ${name} at block ${blockNumber}`)
  }
}

// Distribution analysis steps (steps 1-7): contenthash, files, webmanifest, favicon
const DISTRIBUTION_STEPS = [
  // Decode the contenthash
  async (report, _) => {
    const metadata = await report.readMetadata()
    const { contenthash } = metadata
    report.set('decodedContenthash', await decodeContenthash(contenthash))
  },
  // Convert the contenthash to a CID
  async (report, { kubo }) => {
    report.set('analyzedCid', await ensContenthashToCID(kubo, report.content.decodedContenthash))
  },
  // Detect the root mime type
  async (report, { kubo }) => {
    report.set('rootMimeType', await detectMimeType(kubo, report.content.analyzedCid))
  },
  // Get the files from the root CID
  async (report, { kubo }) => {
    const files = await getFilesFromCID(kubo, report.content.analyzedCid)
    report.set('files', files.map(file => ({ path: file.path, size: file.size, cid: file.cid })))
  },
  // Calculate the total size of the files
  async (report, _) => {
    report.set('totalSize', report.content.files.reduce((acc, file) => acc + file.size, 0))
  },
  // Analyze the HTML files
  async (report, { kubo }) => {
    const updatedFiles = report.content.files.map(async file => {
      if (file.path.endsWith('.html')) {
        const analysis = await analyzeHTML(kubo, file.cid, file.path)
        return { ...file, ...analysis }
      }
      return file
    })
    report.set('files', await Promise.all(updatedFiles))
  },
  // Get the webmanifest, save it and the icons and screenshots
  async (report, { kubo }) => {
    const webmanifest = await getWebmanifest(kubo, report.content.files)
    if (webmanifest.data) {
      report.putFile('manifest.json', webmanifest.data)
      for (const icon of webmanifest.icons) {
        report.putFile(icon.path, icon.data)
      }
      for (const screenshot of webmanifest.screenshots) {
        report.putFile(screenshot.path, screenshot.data)
      }
    }
  },
  // Get the favicon, save it
  async (report, { kubo }) => {
    const favicon = await getFavicon(kubo, report.content.files)
    if (favicon.data) {
      report.set('favicon', favicon.path)
      report.putFile(favicon.path, favicon.data)
    }
  }
]

// Governance analysis steps (step 10): ENS owner analysis
const GOVERNANCE_STEPS = [
  // analyze the ENS owner
  async (report, { rpcUrl }) => {
    const name = report.name
    const ownerAnalysis = await analyzeOwner(name, rpcUrl)
    report.set('ownerAnalysis', ownerAnalysis)
  }
]

// Networking analysis steps (steps 8-9): Web3 detection and script analysis
const NETWORKING_STEPS = [
  // Detect if the dapp uses window.ethereum
  async (report, { kubo }) => {
    for (const file of report.content.files) {
      let usesWindowEthereum = 0
      if (file.path.endsWith('.js')) {
        const scriptText = await getFileContent(kubo, file.cid)
        usesWindowEthereum = detectWindowEthereum(scriptText)
      } else if (file.inlineScripts?.length > 0) {
        for (const script of file.inlineScripts) {
          usesWindowEthereum += detectWindowEthereum(script)
        }
      }
      if (usesWindowEthereum > 0) {
        file.usesWindowEthereum = usesWindowEthereum
      }
    }
  },
  // analyze scripts per file
  async (report, { kubo, cache }) => {
    for (const file of report.content.files) {
      const { libraries, networking, fallbacks } = await analyzeScript(kubo, cache, file)
      if (libraries?.length > 0) file.libraries = libraries
      if (networking?.length > 0) file.networking = networking
      if (fallbacks?.length > 0) file.fallbacks = fallbacks
    }
  }
]

// Cleanup steps (step 11): filter out files without additional analysis
const CLEANUP_STEPS = [
  // filter out files without additional analysis
  async (report, _) => {
    const newFiles = report.content.files.filter(file => {
      // Include if index.html and has metadata
      if (file.path === 'index.html' && file.metadata) {
        return true;
      }
      
      // Include if distribution purity external* arrays have values
      if (file.distributionPurity) {
        const hasExternalMedia = file.distributionPurity.externalMedia && file.distributionPurity.externalMedia.length > 0;
        const hasExternalScripts = file.distributionPurity.externalScripts && file.distributionPurity.externalScripts.length > 0;
        if (hasExternalMedia || hasExternalScripts) {
          return true;
        }
      }
      
      // Include if networking, fallbacks, or libraries arrays have values
      const hasNetworking = file.networking && file.networking.length > 0;
      const hasFallbacks = file.fallbacks && file.fallbacks.length > 0;
      const hasLibraries = file.libraries && file.libraries.length > 0;
      if (hasNetworking || hasFallbacks || hasLibraries) {
        return true;
      }
      
      return false;
    });
    report.set('files', newFiles);
  }
]

// All analysis steps (original behavior)
const ANALYSIS_STEPS = [
  ...DISTRIBUTION_STEPS,
  ...NETWORKING_STEPS,
  ...GOVERNANCE_STEPS,
  ...CLEANUP_STEPS
]