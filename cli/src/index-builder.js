import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { logger } from './logger.js'

export class IndexBuilder {
  constructor(directory) {
    this.directory = directory
    this.archivePath = join(directory, 'archive')
    this.indexPath = join(directory, 'index')
    this.livePath = join(this.indexPath, 'live')
    this.webappsPath = join(this.indexPath, 'webapps')
  }

  async initialize() {
    // Create index directories
    await fs.mkdir(this.livePath, { recursive: true })
    await fs.mkdir(this.webappsPath, { recursive: true })
  }

  async getAllLiveApps() {
    // 1. Read archive directory
    const entries = await fs.readdir(this.archivePath, { withFileTypes: true })
    const folders = entries.filter(e => e.isDirectory())
    
    const liveApps = []
    
    for (const folder of folders) {
      const name = folder.name
      const domainPath = join(this.archivePath, name)
      
      try {
        // 2. Get all block directories
        const blockDirs = await fs.readdir(domainPath, { withFileTypes: true })
        const blockNumbers = blockDirs
          .filter(e => e.isDirectory())
          .map(e => parseInt(e.name))
          .filter(n => !isNaN(n))
        
        if (blockNumbers.length === 0) continue
        
        // 3. Get latest block
        const latestBlock = Math.max(...blockNumbers)
        const blockPath = join(domainPath, latestBlock.toString())
        
        // 4. Check for report.json
        const reportPath = join(blockPath, 'report.json')
        try {
          await fs.access(reportPath)
          
          // 5. Check metadata for empty contenthash (EXCLUDE if empty)
          const metadataPath = join(blockPath, 'metadata.json')
          const metadataContent = await fs.readFile(metadataPath, 'utf8')
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

  async validateWebmanifest(reportPath) {
    try {
      // 1. Read report.json
      const reportContent = await fs.readFile(reportPath, 'utf8')
      const report = JSON.parse(reportContent)
      
      // 2. Check if webmanifest field exists and is non-empty
      if (!report.webmanifest) return false
      
      // 3. Load manifest.json from same directory
      const manifestPath = join(dirname(reportPath), report.webmanifest)
      const manifestContent = await fs.readFile(manifestPath, 'utf8')
      const manifest = JSON.parse(manifestContent)
      
      // 4. Validate required fields
      const hasName = typeof manifest.name === 'string' && manifest.name.trim().length > 0
      const hasDescription = typeof manifest.description === 'string' && manifest.description.trim().length > 0
      const hasIcons = Array.isArray(manifest.icons) && manifest.icons.length > 0
      
      return hasName && hasDescription && hasIcons
      
    } catch (error) {
      logger.debug(`Webmanifest validation failed for ${reportPath}: ${error.message}`)
      return false
    }
  }

  async getWebapps(liveApps) {
    const webapps = []
    
    for (const app of liveApps) {
      const isValid = await this.validateWebmanifest(app.reportPath)
      if (isValid) {
        webapps.push(app)
      }
    }
    
    return webapps
  }

  async cleanIndex(indexPath) {
    try {
      const entries = await fs.readdir(indexPath, { withFileTypes: true })
      
      for (const entry of entries) {
        // Skip stats.json
        if (entry.name === 'stats.json') continue
        
        const entryPath = join(indexPath, entry.name)
        // Remove symlinks only (safety check)
        const stats = await fs.lstat(entryPath)
        if (stats.isSymbolicLink()) {
          await fs.unlink(entryPath)
        }
      }
    } catch (error) {
      // Directory might not exist yet, that's ok
      logger.debug(`Could not clean index ${indexPath}: ${error.message}`)
    }
  }

  async saveIndexStats(indexPath, count, indexName) {
    const statsPath = join(indexPath, 'stats.json')
    const stats = {
      count,
      lastUpdated: new Date().toISOString(),
      indexName
    }
    await fs.writeFile(statsPath, JSON.stringify(stats, null, 2))
  }

  async buildLiveIndex(liveApps) {
    logger.info(`Building live index...`)
    
    // Clean existing symlinks
    await this.cleanIndex(this.livePath)
    
    // Create symlinks
    for (const app of liveApps) {
      const symlinkPath = join(this.livePath, app.name)
      const targetPath = join('..', '..', 'archive', app.name, app.blockNumber.toString())
      
      try {
        await fs.symlink(targetPath, symlinkPath)
      } catch (error) {
        logger.warn(`Failed to create symlink for ${app.name}: ${error.message}`)
      }
    }
    
    // Save stats
    await this.saveIndexStats(this.livePath, liveApps.length, 'live')
    
    logger.success(`Live index created: ${liveApps.length} apps`)
  }

  async buildWebappsIndex(webapps) {
    logger.info(`Building webapps index...`)
    
    // Clean existing symlinks
    await this.cleanIndex(this.webappsPath)
    
    // Create symlinks
    for (const app of webapps) {
      const symlinkPath = join(this.webappsPath, app.name)
      const targetPath = join('..', '..', 'archive', app.name, app.blockNumber.toString())
      
      try {
        await fs.symlink(targetPath, symlinkPath)
      } catch (error) {
        logger.warn(`Failed to create symlink for ${app.name}: ${error.message}`)
      }
    }
    
    // Save stats
    await this.saveIndexStats(this.webappsPath, webapps.length, 'webapps')
    
    logger.success(`Webapps index created: ${webapps.length} apps`)
  }

  async buildAllIndexes() {
    const startTime = Date.now()
    
    // 1. Get all live apps
    logger.info('Scanning archive for live apps...')
    const liveApps = await this.getAllLiveApps()
    logger.info(`Found ${liveApps.length} live apps`)
    
    // 2. Filter for webapps
    logger.info('Filtering for webapps with valid manifests...')
    const webapps = await this.getWebapps(liveApps)
    logger.info(`Found ${webapps.length} webapps`)
    
    // 3. Build indexes
    await this.buildLiveIndex(liveApps)
    await this.buildWebappsIndex(webapps)
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    logger.info(`Index build completed in ${elapsed}s`)
    
    return {
      liveCount: liveApps.length,
      webappsCount: webapps.length,
      elapsedSeconds: elapsed
    }
  }
}
