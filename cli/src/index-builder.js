import { logger } from './logger.js'
import { calculateRankScore, CATEGORY_WEIGHTS } from './rank-calculator.js'

const BUCKET_SIZE = 25

const CATEGORIES = ['total', 'distribution', 'networking', 'governance', 'manifest']

const CATEGORY_SHORT_NAMES = {
  'total': 'total',
  'distribution': 'dist',
  'networking': 'net',
  'governance': 'gov',
  'manifest': 'mani'
}

export class IndexBuilder {
  constructor(storage) {
    this.storage = storage
    this.bucketSize = BUCKET_SIZE
    this.categories = CATEGORIES
  }

  async initialize() {
    // Create index directories
    await this.storage.ensureDirectory('/index/live')
    await this.storage.ensureDirectory('/index/score')
  }

  async getAllLiveApps() {
    // 1. Read archive directory
    const entries = await this.storage.listDirectory('/archive')
    const folders = entries.filter(e => e.type === 1) // directories only
    
    const liveApps = []
    
    for (const folder of folders) {
      const name = folder.name
      const domainPath = `/archive/${name}`
      
      try {
        // 2. Get all block directories
        const blockDirs = await this.storage.listDirectory(domainPath)
        const blockNumbers = blockDirs
          .filter(e => e.type === 1) // directories only
          .map(e => parseInt(e.name))
          .filter(n => !isNaN(n))
        
        if (blockNumbers.length === 0) continue
        
        // 3. Get latest block
        const latestBlock = Math.max(...blockNumbers)
        
        // 4. Check for report.json
        const reportPath = `/archive/${name}/${latestBlock}/report.json`
        try {
          await this.storage.getStats(reportPath)
          
          // 5. Check metadata for empty contenthash (EXCLUDE if empty)
          const metadataPath = `/archive/${name}/${latestBlock}/metadata.json`
          const metadataContent = await this.storage.readFileString(metadataPath)
          const metadata = JSON.parse(metadataContent)
          
          // Skip if contenthash is empty, null, or "0x"
          if (!metadata.contenthash || metadata.contenthash === '0x') {
            logger.debug(`Skipping ${name} - empty contenthash`)
            continue
          }
          
          liveApps.push({ name, blockNumber: latestBlock, reportPath })
        } catch (error) {
          // report.json doesn't exist, skip silently
          continue
        }
      } catch (error) {
        logger.warn(`Could not process domain ${name}:`, error.message)
        continue
      }
    }
    
    return liveApps.sort((a, b) => a.name.localeCompare(b.name))
  }

  async getAllAppsWithScores() {
    // 1. Get all live apps (apps with report.json and non-empty contenthash)
    const liveApps = await this.getAllLiveApps()
    
    logger.info(`Calculating rank scores for ${liveApps.length} apps...`)
    
    // 2. Calculate scores for each app
    const appsWithScores = []
    
    for (const app of liveApps) {
      try {
        // reportDir is the directory containing the report, needed for manifest files
        const reportDir = `/archive/${app.name}/${app.blockNumber}`
        const reportContent = await this.storage.readFileString(app.reportPath)
        const report = JSON.parse(reportContent)
        
        // Calculate rank score (requires report + reportDir for manifest files)
        const rankScore = await calculateRankScore(report, reportDir)
        
        appsWithScores.push({
          name: app.name,
          blockNumber: app.blockNumber,
          reportPath: app.reportPath,
          rankScore: rankScore, // Full rank score object
          scores: {
            total: rankScore.overallScore,
            dist: rankScore.categories.distribution.score,
            net: rankScore.categories.networking.score,
            gov: rankScore.categories.governance.score,
            mani: rankScore.categories.manifest.score
          }
        })
      } catch (error) {
        // Skip apps that fail scoring (missing required fields, etc.)
        logger.debug(`Skipping ${app.name}: ${error.message}`)
      }
    }
    
    logger.info(`Successfully scored ${appsWithScores.length} apps`)
    
    return appsWithScores
  }

  async cleanIndex(indexPath) {
    try {
      const entries = await this.storage.listDirectory(indexPath)
      
      for (const entry of entries) {
        // Skip stats.json
        if (entry.name === 'stats.json') continue
        
        const entryPath = `${indexPath}/${entry.name}`
        
        // Remove entire directory tree (including all files and subdirectories)
        await this.storage.removeFile(entryPath, true)
      }
    } catch (error) {
      // Directory might not exist yet, that's ok
      logger.debug(`Could not clean index ${indexPath}: ${error.message}`)
    }
  }

  async buildLiveIndex(apps) {
    logger.info('Building live index...')
    
    // Clean existing directories
    await this.cleanIndex('/index/live')
    
    // Sort by ENS name for consistent ordering
    const sortedApps = [...apps].sort((a, b) => a.name.localeCompare(b.name))
    
    // Calculate score stats for live index
    const scores = sortedApps.map(app => app.scores.total)
    const scoreStats = {
      min: Math.min(...scores),
      max: Math.max(...scores),
      avg: scores.reduce((a, b) => a + b, 0) / scores.length
    }
    
    // Create directory for each app with report.json and score.json
    for (const app of sortedApps) {
      const appDirPath = `/index/live/${app.name}`
      
      // Copy report from archive (replaces symlink)
      const sourcePath = `/archive/${app.name}/${app.blockNumber}/report.json`
      const destPath = `${appDirPath}/report.json`
      
      try {
        await this.storage.copyFile(sourcePath, destPath)
      } catch (error) {
        logger.warn(`Failed to copy report for ${app.name}: ${error.message}`)
        continue
      }
      
      // Create score.json file (without maxScore - it's in stats.json)
      const scoreFilePath = `${appDirPath}/score.json`
      const scoreData = {
        rankVersion: app.rankScore.rankVersion,
        overallScore: app.rankScore.overallScore,
        categories: {
          distribution: app.rankScore.categories.distribution.score,
          networking: app.rankScore.categories.networking.score,
          governance: app.rankScore.categories.governance.score,
          manifest: app.rankScore.categories.manifest.score
        }
      }
      
      try {
        await this.storage.writeFile(scoreFilePath, JSON.stringify(scoreData, null, 2))
      } catch (error) {
        logger.warn(`Failed to create score.json for ${app.name}: ${error.message}`)
      }
    }
    
    // Save stats with total count, score stats, and maxScores
    const maxScores = {
      total: 100,
      distribution: CATEGORY_WEIGHTS.distribution,
      networking: CATEGORY_WEIGHTS.networking,
      governance: CATEGORY_WEIGHTS.governance,
      manifest: CATEGORY_WEIGHTS.manifest
    }
    
    await this.storage.writeFile(
      '/index/live/stats.json',
      JSON.stringify({
        count: sortedApps.length,
        lastUpdated: new Date().toISOString(),
        scoreStats: scoreStats,
        maxScores: maxScores
      }, null, 2)
    )
    
    await this.storage.flush()
    logger.success(`Live index created: ${sortedApps.length} apps`)
  }

  async buildScoreIndex(category, apps) {
    const categoryName = category // 'total', 'distribution', etc.
    const categoryPath = `/index/score/${categoryName}`
    const scoreKey = CATEGORY_SHORT_NAMES[category]
    
    // Create category directory
    await this.storage.ensureDirectory(categoryPath)
    
    // Sort apps by score (descending), then by name (ascending) for tiebreaking
    const sortedApps = [...apps].sort((a, b) => {
      const scoreDiff = b.scores[scoreKey] - a.scores[scoreKey]
      if (scoreDiff !== 0) return scoreDiff
      return a.name.localeCompare(b.name) // Tiebreaker
    })
    
    // Calculate how many range directories we need
    const totalRanges = Math.ceil(sortedApps.length / this.bucketSize)
    
    // Create all range directories (even if partially empty)
    for (let i = 0; i < totalRanges; i++) {
      const rangeStart = i * this.bucketSize + 1
      const rangeEnd = rangeStart + this.bucketSize - 1
      const rangeLabel = `${rangeStart}-${rangeEnd}` // Always show full range
      const rangePath = `${categoryPath}/${rangeLabel}`
      
      // Create range directory and clean it
      await this.storage.ensureDirectory(rangePath)
      await this.cleanIndex(rangePath)
      
      // Get apps for this range
      const rangeApps = sortedApps.slice(i * this.bucketSize, (i + 1) * this.bucketSize)
      
      // Copy files into {ensName}/ directories (replaces directory symlinks)
      for (const app of rangeApps) {
        const appPath = `${rangePath}/${app.name}`
        await this.storage.ensureDirectory(appPath)
        
        try {
          // Copy report.json
          await this.storage.copyFile(
            `/index/live/${app.name}/report.json`,
            `${appPath}/report.json`
          )
          
          // Copy score.json
          await this.storage.copyFile(
            `/index/live/${app.name}/score.json`,
            `${appPath}/score.json`
          )
        } catch (error) {
          logger.warn(`Failed to copy files for ${app.name}: ${error.message}`)
        }
      }
      
      // Save range-level stats with total count
      await this.storage.writeFile(
        `${rangePath}/stats.json`,
        JSON.stringify({
          count: rangeApps.length,
          category: categoryName,
          lastUpdated: new Date().toISOString()
        }, null, 2)
      )
    }
    
    // Save category-level stats with total count
    await this.storage.writeFile(
      `${categoryPath}/stats.json`,
      JSON.stringify({
        count: sortedApps.length,
        category: categoryName,
        lastUpdated: new Date().toISOString()
      }, null, 2)
    )
    
    await this.storage.flush()
    logger.success(`${categoryName}: ${totalRanges} ranges created`)
    
    return { totalRanges, totalApps: sortedApps.length }
  }

  async buildAllIndexes() {
    const startTime = Date.now()
    
    // 1. Get all live apps
    logger.info('Scanning archive for live apps...')
    const liveApps = await this.getAllLiveApps()
    logger.info(`Found ${liveApps.length} live apps`)
    
    // 2. Calculate scores for all apps
    const appsWithScores = await this.getAllAppsWithScores()
    
    // 3. Check if we have any scoreable apps
    if (appsWithScores.length === 0) {
      logger.warn('No apps could be scored. Not creating any indexes.')
      return {
        totalApps: liveApps.length,
        scoredApps: 0,
        categories: {},
        elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(2)
      }
    }
    
    // 4. Build live index
    await this.buildLiveIndex(appsWithScores)
    
    // 5. Build score indexes for each category
    const categoryStats = {}
    
    for (const category of this.categories) {
      logger.info(`Building ${category} score index...`)
      const stats = await this.buildScoreIndex(category, appsWithScores)
      categoryStats[category] = stats
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    logger.info(`Index build completed in ${elapsed}s`)
    
    return {
      totalApps: liveApps.length,
      scoredApps: appsWithScores.length,
      categories: categoryStats,
      elapsedSeconds: elapsed
    }
  }
}
