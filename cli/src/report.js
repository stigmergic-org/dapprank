import { logger } from './logger.js'

export class Report {
  #content = {
    version: 4,
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
    failedScriptAnalysis: [],
    ownerAnalysis: {
      type: '',
      ownerAddress: '',
      config: [],
    },
  }
  #files = {}

  constructor(storage, name, blockNumber) {
    this.storage = storage
    this.name = name
    this.blockNumber = blockNumber.toString()
    this.basePath = `/archive/${name}/${this.blockNumber}`
    this.set('blockNumber', blockNumber)
  }

  async readMetadata() {
    const metadataPath = `${this.basePath}/metadata.json`
    const metadataContent = await this.storage.readFileString(metadataPath)
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

  get files() {
    return this.#files
  }

  /**
   * Check if a report already exists for this path
   * @returns {Promise<boolean>} - True if report exists, false otherwise
   */
  async exists() {
    const reportPath = `${this.basePath}/report.json`
    return await this.storage.exists(reportPath)
  }

  /**
   * Load existing report data if it exists
   * @returns {Promise<boolean>} - True if report was loaded, false if it didn't exist
   */
  async load() {
    try {
      const reportPath = `${this.basePath}/report.json`
      const reportContent = await this.storage.readFileString(reportPath)
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
   * Write the report to storage as report.json
   * @returns {Promise<void>}
   */
  async write(force = false) {
    if ((await this.exists()) && !force){
      throw new Error(`Can't overwrite existing report.json`)
    }
    logger.info('Writing report...')
    try {
      const reportPath = `${this.basePath}/report.json`
      await this.storage.writeFile(reportPath, JSON.stringify(this.#content, null, 2))
      logger.info(`Report written to ${reportPath}`)
    } catch (error) {
      throw new Error(`Failed to write report: ${error.message}`)
    }
    await this.writeFiles()
  }

  /**
   * Write the files to storage, in an 'assets' subfolder
   */
  async writeFiles() {
    const assetsPath = `${this.basePath}/assets`
    
    for (const [path, data] of Object.entries(this.#files)) {
      const fullPath = `${assetsPath}/${path}`
      
      try {
        await this.storage.writeFile(fullPath, data)
        logger.debug(`Wrote asset: ${fullPath}`)
      } catch (error) {
        logger.warn(`Failed to write asset ${path}: ${error.message}`)
      }
    }
  }
}
