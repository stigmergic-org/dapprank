import { promises as fs } from 'fs'
import { join } from 'path'

export class Report {
  #content = {
    version: 3,
    blockNumber: 0,
    decodedContenthash: {
      codec: '',
      value: '',
    },
    analyzedCid: '',
    rootMimeType: '',
    files: [],
    totalSize: 0,
    webmanifest: '',
    favicon: '',
  }
  #files = {}

  constructor(archivePath, name, blockNumber) {
    this.name = name
    this.blockNumber = blockNumber.toString()
    this.archivePath = archivePath
    this.fullPath = join(archivePath, name, this.blockNumber, 'report.json')
    this.metadataPath = join(archivePath, name, this.blockNumber, 'metadata.json')
    this.set('blockNumber', blockNumber)
  }

  async readMetadata() {
    const metadataContent = await fs.readFile(this.metadataPath, 'utf8')
    return JSON.parse(metadataContent)
  }

  /**
   * Put a file in the report
   * @param {string} path - The path of the file
   * @param {Uint8Array} data - The data of the file
   */
  putFile(path, data) {
    this.#files[path] = data
  }

  /**
   * Set a field in the report with type validation
   * @param {string} field - The field name to set
   * @param {any} content - The content to set for the field
   */
  set(field, content) {
    // Check if field exists in the content structure
    if (!(field in this.#content)) {
      throw new Error(`Field '${field}' is not defined in the report structure`)
    }

    const validate = (field, content, expected) => {
      const actualType = typeof content
      const expectedType = typeof expected

      if (content === null || content === undefined) {
        throw new Error(`Field '${field}' cannot be null or undefined`)
      }

      if (actualType !== expectedType) {
        throw new Error(`Field '${field}' expects type '${expectedType}', got '${actualType}'`)
      }

      let result = true
      if (actualType === 'object') {
        // Handle arrays specially - just check if it's an array, don't validate elements
        if (Array.isArray(expected)) {
          if (!Array.isArray(content)) {
            throw new Error(`Field '${field}' expects an array, got '${actualType}'`)
          }
          // Skip validation of array elements
        } else {
          // Handle regular objects
          const expectedKeys = new Set(Object.keys(expected))
          for (const key of expectedKeys) {
            if (!(key in content)) {
              throw new Error(`Field '${field}' is missing required key '${key}'`)
            }
            result = result && validate(key, content[key], expected[key])
          }
          const actualKeys = new Set(Object.keys(content))
          for (const key of actualKeys) {
            if (!(key in expected)) {
              throw new Error(`Field '${field}' has unexpected key '${key}'`)
            }
          }
        }
      }
      return result
    }
    if (validate(field, content, this.#content[field])) {
      this.#content[field] = content
    }
  }

  /**
   * Get the current content (read-only)
   * @returns {Object} - Copy of the current content
   */
  read() {
    return Object.freeze(this.#content)
  }

  get content() {
    return this.#content
  }

  /**
   * Check if a report already exists for this path
   * @returns {Promise<boolean>} - True if report exists, false otherwise
   */
  async exists() {
    try {
      await fs.access(this.fullPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Load existing report data if it exists
   * @returns {Promise<boolean>} - True if report was loaded, false if it didn't exist
   */
  async load() {
    try {
      const reportContent = await fs.readFile(this.fullPath, 'utf8')
      const reportData = JSON.parse(reportContent)
      
      // Merge existing data with current instance
      Object.assign(this.#content, reportData)
      return true
    } catch (error) {
      console.warn(`Could not load existing report: ${error.message}`)
      return false
    }
  }

  /**
   * Write the report to the filesystem as report.json
   * @returns {Promise<void>}
   */
  async write(force = false) {
    if ((await this.exists()) && !force){
      throw new Error(`Can't overwrite existing report.json`)
    }
    console.log('Writing report...')
    // console.log(JSON.stringify(this.#content, null, 2))
    // console.log('Files: ', Object.keys(this.#files))
    // return
    try {
      await fs.writeFile(this.fullPath, JSON.stringify(this.#content, null, 2))
      console.log(`Report written to ${this.fullPath}`)
    } catch (error) {
      throw new Error(`Failed to write report: ${error.message}`)
    }
    await this.writeFiles()
  }

  /**
   * Write the files to the filesystem, in an 'assets' subfolder
   */
  async writeFiles() {
    // Use the directory path (without the filename) for creating assets subdirectory
    const dirPath = this.fullPath.substring(0, this.fullPath.lastIndexOf('/'))
    const assetsPath = join(dirPath, 'assets')
    await fs.mkdir(assetsPath, { recursive: true })
    for (const [path, data] of Object.entries(this.#files)) {
      // Create the full path including any subdirectories
      const fullPath = join(assetsPath, path)
      // Get directory path by removing the filename
      const lastSlashIndex = fullPath.lastIndexOf('/')
      if (lastSlashIndex > 0) { // Only create dirs if path contains a slash
        const dirPath = fullPath.substring(0, lastSlashIndex)
        // Create parent directories if they don't exist
        await fs.mkdir(dirPath, { recursive: true })
      }
      await fs.writeFile(fullPath, data)
    }
  }
}
