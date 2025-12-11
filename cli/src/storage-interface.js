import { promises as fs } from 'fs'
import { join, dirname, relative } from 'path'
import all from 'it-all'
import { concat, toString } from 'uint8arrays'
import { logger } from './logger.js'

/**
 * Abstract storage interface
 * Provides a unified API for both filesystem and IPFS MFS storage
 */
export class StorageInterface {
  async ensureDirectory(path) {
    throw new Error('ensureDirectory must be implemented')
  }

  async writeFile(path, content) {
    throw new Error('writeFile must be implemented')
  }

  async copyFile(sourcePath, destPath) {
    throw new Error('copyFile must be implemented')
  }

  async readFile(path) {
    throw new Error('readFile must be implemented')
  }

  async readFileString(path) {
    throw new Error('readFileString must be implemented')
  }

  async listDirectory(path) {
    throw new Error('listDirectory must be implemented')
  }

  async getStats(path) {
    throw new Error('getStats must be implemented')
  }

  async removeFile(path, recursive = false) {
    throw new Error('removeFile must be implemented')
  }

  async flush() {
    throw new Error('flush must be implemented')
  }

  async getRootCID() {
    throw new Error('getRootCID must be implemented')
  }

  async exists(path) {
    throw new Error('exists must be implemented')
  }
}

/**
 * Filesystem implementation using symlinks
 */
export class FilesystemStorage extends StorageInterface {
  constructor(basePath) {
    super()
    this.basePath = basePath
  }

  async ensureDirectory(path) {
    const fullPath = join(this.basePath, path)
    await fs.mkdir(fullPath, { recursive: true })
  }

  async writeFile(path, content) {
    const fullPath = join(this.basePath, path)
    await fs.mkdir(dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
  }

  async copyFile(source, dest) {
    const sourcePath = join(this.basePath, source)
    const destPath = join(this.basePath, dest)
    await fs.mkdir(dirname(destPath), { recursive: true })

    // Create relative symlink (maintains current behavior)
    const relPath = relative(dirname(destPath), sourcePath)
    
    // Remove existing symlink/file if it exists
    try {
      await fs.unlink(destPath)
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    await fs.symlink(relPath, destPath)
  }

  async readFile(path) {
    const fullPath = join(this.basePath, path)
    return await fs.readFile(fullPath)
  }

  async readFileString(path) {
    const content = await this.readFile(path)
    return content.toString('utf-8')
  }

  async listDirectory(path) {
    const fullPath = join(this.basePath, path)
    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: 0
    }))
  }

  async getStats(path) {
    const fullPath = join(this.basePath, path)
    const stats = await fs.stat(fullPath)
    return {
      size: stats.size,
      type: stats.isDirectory() ? 'directory' : 'file',
      cid: null // Filesystem doesn't have CIDs
    }
  }

  async removeFile(path, recursive = false) {
    const fullPath = join(this.basePath, path)
    if (recursive) {
      await fs.rm(fullPath, { recursive: true, force: true })
    } else {
      await fs.unlink(fullPath)
    }
  }

  async flush() {
    // No-op for filesystem
  }

  async getRootCID() {
    return null // Filesystem doesn't have CIDs
  }

  async exists(path) {
    const fullPath = join(this.basePath, path)
    try {
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }
}

/**
 * IPFS MFS implementation
 */
export class MFSStorage extends StorageInterface {
  constructor(kubo, rootPath = '/dapprank-data', dataPointerPath) {
    super()
    this.kubo = kubo
    this.rootPath = rootPath
    this.dataPointerPath = dataPointerPath
    
    if (!this.dataPointerPath) {
      throw new Error('dataPointerPath is required for MFSStorage')
    }
  }

  _getFullPath(path) {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${this.rootPath}${normalizedPath}`
  }

  async ensureDirectory(path) {
    const fullPath = this._getFullPath(path)
    try {
      await this.kubo.files.mkdir(fullPath, {
        parents: true,
        cidVersion: 1,
        hash: 'sha2-256'
      })
    } catch (error) {
      // Ignore if directory already exists
      if (!error.message.includes('already exists')) {
        throw error
      }
    }
  }

  async writeFile(path, content) {
    const fullPath = this._getFullPath(path)
    await this.kubo.files.write(fullPath, content, {
      create: true,
      parents: true,
      truncate: true,
      cidVersion: 1,
      hash: 'sha2-256'
    })
  }

  async copyFile(source, dest) {
    const sourcePath = this._getFullPath(source)
    const destPath = this._getFullPath(dest)
    
    try {
      await this.kubo.files.cp(sourcePath, destPath, { parents: true })
    } catch (error) {
      if (error.message.includes('does not exist')) {
        throw new Error(`Source file not found: ${source}`)
      }
      throw error
    }
  }

  async readFile(path) {
    const fullPath = this._getFullPath(path)
    try {
      const chunks = await all(this.kubo.files.read(fullPath))
      return concat(chunks)
    } catch (error) {
      if (error.message.includes('does not exist')) {
        throw new Error(`File not found: ${path}`)
      }
      throw error
    }
  }

  async readFileString(path) {
    const content = await this.readFile(path)
    return toString(content)
  }

  async listDirectory(path) {
    const fullPath = this._getFullPath(path)
    try {
      return await all(this.kubo.files.ls(fullPath))
    } catch (error) {
      if (error.message.includes('does not exist')) {
        throw new Error(`Directory not found: ${path}`)
      }
      throw error
    }
  }

  async getStats(path) {
    const fullPath = this._getFullPath(path)
    try {
      const stat = await this.kubo.files.stat(fullPath)
      return {
        cid: stat.cid.toString(),
        size: stat.size,
        cumulativeSize: stat.cumulativeSize,
        type: stat.type === 'directory' ? 'directory' : 'file',
        blocks: stat.blocks
      }
    } catch (error) {
      if (error.message.includes('does not exist')) {
        throw new Error(`Path not found: ${path}`)
      }
      throw error
    }
  }

  async removeFile(path, recursive = false) {
    const fullPath = this._getFullPath(path)
    try {
      await this.kubo.files.rm(fullPath, { recursive })
    } catch (error) {
      if (error.message.includes('does not exist')) {
        // Ignore if file doesn't exist
        return
      }
      throw error
    }
  }

  async flush() {
    // Flush MFS changes to ensure persistence
    await this.kubo.files.flush(this.rootPath)
    
    // Get root CID and save to data pointer file
    try {
      const rootCid = await this.getRootCID()
      if (rootCid) {
        await fs.writeFile(this.dataPointerPath, rootCid)
        logger.info(`Data pointer updated: ${rootCid}`)
        logger.info(`  View at: /ipfs/${rootCid}`)
      }
    } catch (error) {
      // Log warning but don't fail the flush - MFS data is already persisted
      logger.warn(`Failed to update data pointer file at ${this.dataPointerPath}: ${error.message}`)
    }
  }

  async getRootCID() {
    try {
      const stat = await this.kubo.files.stat(this.rootPath)
      return stat.cid.toString()
    } catch (error) {
      logger.warn(`Failed to get root CID for path ${this.rootPath}: ${error.message}`)
      return null
    }
  }

  async exists(path) {
    try {
      await this.getStats(path)
      return true
    } catch {
      return false
    }
  }
}
