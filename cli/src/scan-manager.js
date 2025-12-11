import { GraphQLClient } from 'graphql-request'
import { logger } from './logger.js'

const ENS_API_URL = 'https://api.mainnet.ensnode.io/subgraph'

// GraphQL query for contenthash changes
const CONTENTHASH_QUERY = `
  query ($first: Int, $orderBy: ContenthashChanged_orderBy, $orderDirection: OrderDirection, $blockNumberGte: Int) {
    contenthashChangeds(
      first: $first
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { blockNumber_gte: $blockNumberGte }
    ) {
      hash
      blockNumber
      id
      resolver {
        domain {
          name
        }
      }
      transactionID
    }
  }
`

export class ScanManager {
  constructor(storage) {
    this.storage = storage
    this.statePath = '/state.json'
    this.client = new GraphQLClient(ENS_API_URL)
  }

  async initialize() {
    // Create folder structure if it doesn't exist
    await this.storage.ensureDirectory('/archive')
    
    // Initialize scan height if it doesn't exist
    if (!(await this.storage.exists(this.statePath))) {
      await this.saveScanHeight(0)
    }
  }

  async getLastScanHeight() {
    try {
      const data = await this.storage.readFileString(this.statePath)
      const state = JSON.parse(data)
      // Handle legacy format with blockNumber
      const scannedUntil = state.scannedUntil || 0
      return scannedUntil
    } catch (error) {
      logger.warn('Could not read scan height, starting from 0:', error.message)
      return 0
    }
  }

  async saveScanHeight(blockNumber) {
    try {
      // Read existing state to preserve other fields
      const existingData = await this.storage.readFileString(this.statePath)
      const existingState = JSON.parse(existingData)
      
      // Merge with existing state, updating scannedUntil
      const data = { 
        ...existingState,
        scannedUntil: blockNumber
      }
      
      await this.storage.writeFile(this.statePath, JSON.stringify(data, null, 2))
    } catch (error) {
      // If we can't read existing state, just save the new state
      const data = { scannedUntil: blockNumber }
      await this.storage.writeFile(this.statePath, JSON.stringify(data, null, 2))
    }
  }

  async scanContenthashChanges(fromBlock = 0) {
    const startTime = Date.now()
    logger.info(`Scanning for contenthash changes from block ${fromBlock}...`)
    
    let hasMore = true
    let lastBlockNumber = fromBlock
    let totalChanges = 0
    
    while (hasMore) {
      try {
        const variables = {
          first: 1000,
          orderBy: 'blockNumber',
          orderDirection: 'asc',
          blockNumberGte: fromBlock > 0 ? fromBlock : undefined
        }
        
        const data = await this.client.request(CONTENTHASH_QUERY, variables)
        const changes = data.contenthashChangeds
        
        if (changes.length === 0) {
          hasMore = false
          break
        }
        
        logger.info(`Found ${changes.length} contenthash changes`)
        
        // Process each change
        for (const change of changes) {
          await this.saveContenthashChange(change)
          lastBlockNumber = Math.max(lastBlockNumber, parseInt(change.blockNumber))
          totalChanges++
        }
        
        // Persist scan height after each successful batch
        if (lastBlockNumber > fromBlock) {
          await this.saveScanHeight(lastBlockNumber)
          await this.storage.flush()
          logger.info(`Progress saved: scan height updated to block ${lastBlockNumber}`)
        }
        
        // If we got less than 1000 results, we've reached the end
        if (changes.length < 1000) {
          hasMore = false
        } else {
          // Update fromBlock to continue from the last block we processed
          fromBlock = lastBlockNumber + 1
        }
        
      } catch (error) {
        logger.error(`Error fetching contenthash changes: ${error.message}`)
        hasMore = false
      }
    }
    
    // Final scan height save (this will be redundant if we're saving after each batch, but good for safety)
    if (lastBlockNumber > fromBlock) {
      await this.saveScanHeight(lastBlockNumber)
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    const blocksProcessed = lastBlockNumber - fromBlock
    const rate = blocksProcessed > 0 && duration > 0 ? (blocksProcessed / parseFloat(duration)).toFixed(0) : '0'
    logger.info(`Scan complete. Processed ${totalChanges} changes up to block ${lastBlockNumber} in ${duration}s (${rate} blocks/sec)`)
    return { totalChanges, lastBlockNumber }
  }

  async saveContenthashChange(change) {
    // Skip entries with missing data
    if (!change.resolver || !change.resolver.domain || !change.resolver.domain.name) {
      logger.debug(`Skipping entry with missing domain data: ${change.id}`);
      return;
    }
    
    const ensName = change.resolver.domain.name
    const blockNumber = change.blockNumber
    const contenthash = change.hash
    const txHash = change.transactionID
    const ownerAddress = change.resolver.domain.wrappedOwnerId || change.resolver.domain.ownerId
    
    // Skip names that contain [<hex>] pattern (excluding our own generated long-name hashes)
    if (/\[[0-9a-f]{16,}\]/.test(ensName)) {
      logger.debug(`Skipping ENS name with [<hex>] pattern: ${ensName}`);
      return;
    }
    
    // Handle extremely long ENS names that would cause filesystem path issues
    let safeEnsName = ensName
    const maxPathLength = 200 // Conservative limit for filesystem compatibility
    
    if (ensName.length > maxPathLength) {
      // Create a hash-based name for extremely long ENS names
      const crypto = await import('crypto')
      const hash = crypto.createHash('sha256').update(ensName).digest('hex').substring(0, 16)
      safeEnsName = `[${hash}].long-name`
      logger.info(`Truncated extremely long ENS name "${ensName.substring(0, 50)}..." to "${safeEnsName}"`)
    }
    
    try {
      // Create metadata.json file
      const metadataPath = `/archive/${safeEnsName}/${blockNumber}/metadata.json`
      const metadata = {
        contenthash,
        tx: txHash,
        originalName: ensName !== safeEnsName ? ensName : undefined // Store original name if truncated
      }
      
      await this.storage.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
      
      logger.info(`Saved: ${safeEnsName} at block ${blockNumber}`)
    } catch (error) {
      logger.error(`Error saving contenthash change for ${safeEnsName}: ${error.message}`)
      // Continue processing other entries even if this one fails
    }
  }
}
