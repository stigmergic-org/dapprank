import { GraphQLClient } from 'graphql-request'
import { promises as fs } from 'fs'
import { join } from 'path'

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
  constructor(folderPath) {
    this.folderPath = folderPath
    this.archivePath = join(folderPath, 'archive')
    this.statePath = join(folderPath, 'state.json')
    this.client = new GraphQLClient(ENS_API_URL)
  }

  async initialize() {
    // Create folder structure if it doesn't exist
    await fs.mkdir(this.folderPath, { recursive: true })
    await fs.mkdir(this.archivePath, { recursive: true })
    
    // Initialize scan height if it doesn't exist
    try {
      await fs.access(this.statePath)
    } catch {
      // File doesn't exist, create with initial height
      await this.saveScanHeight(0)
    }
  }

  async getLastScanHeight() {
    try {
      const data = await fs.readFile(this.statePath, 'utf8')
      const state = JSON.parse(data)
      // Handle legacy format with blockNumber
      const scannedUntil = state.scannedUntil || 0
      return scannedUntil
    } catch (error) {
      console.warn('Could not read scan height, starting from 0:', error.message)
      return 0
    }
  }

  async saveScanHeight(blockNumber) {
    try {
      // Read existing state to preserve other fields
      const existingData = await fs.readFile(this.statePath, 'utf8')
      const existingState = JSON.parse(existingData)
      
      // Merge with existing state, updating scannedUntil
      const data = { 
        ...existingState,
        scannedUntil: blockNumber
      }
      
      await fs.writeFile(this.statePath, JSON.stringify(data, null, 2))
    } catch (error) {
      // If we can't read existing state, just save the new state
      const data = { scannedUntil: blockNumber }
      await fs.writeFile(this.statePath, JSON.stringify(data, null, 2))
    }
  }

  async scanContenthashChanges(fromBlock = 0) {
    console.log(`Scanning for contenthash changes from block ${fromBlock}...`)
    
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
        
        console.log(`Found ${changes.length} contenthash changes`)
        
        // Process each change
        for (const change of changes) {
          await this.saveContenthashChange(change)
          lastBlockNumber = Math.max(lastBlockNumber, parseInt(change.blockNumber))
          totalChanges++
        }
        
        // Persist scan height after each successful batch
        if (lastBlockNumber > fromBlock) {
          await this.saveScanHeight(lastBlockNumber)
          console.log(`Progress saved: scan height updated to block ${lastBlockNumber}`)
        }
        
        // If we got less than 1000 results, we've reached the end
        if (changes.length < 1000) {
          hasMore = false
        } else {
          // Update fromBlock to continue from the last block we processed
          fromBlock = lastBlockNumber + 1
        }
        
      } catch (error) {
        console.error('Error fetching contenthash changes:', error)
        hasMore = false
      }
    }
    
    // Final scan height save (this will be redundant if we're saving after each batch, but good for safety)
    if (lastBlockNumber > fromBlock) {
      await this.saveScanHeight(lastBlockNumber)
    }
    
    console.log(`Scan complete. Processed ${totalChanges} changes up to block ${lastBlockNumber}`)
    return { totalChanges, lastBlockNumber }
  }

  async saveContenthashChange(change) {
    // Skip entries with missing data
    if (!change.resolver || !change.resolver.domain || !change.resolver.domain.name) {
      console.log(`Skipping entry with missing domain data: ${change.id}`);
      return;
    }
    
    const ensName = change.resolver.domain.name
    const blockNumber = change.blockNumber
    const contenthash = change.hash
    const txHash = change.transactionID
    
    // Handle extremely long ENS names that would cause filesystem path issues
    let safeEnsName = ensName
    const maxPathLength = 200 // Conservative limit for filesystem compatibility
    
    if (ensName.length > maxPathLength) {
      // Create a hash-based name for extremely long ENS names
      const crypto = await import('crypto')
      const hash = crypto.createHash('sha256').update(ensName).digest('hex').substring(0, 16)
      safeEnsName = `[${hash}].long-name.eth`
      console.log(`Truncated extremely long ENS name "${ensName.substring(0, 50)}..." to "${safeEnsName}"`)
    }
    
    try {
      // Create domain directory
      const domainPath = join(this.archivePath, safeEnsName)
      await fs.mkdir(domainPath, { recursive: true })
      
      // Create block directory
      const blockPath = join(domainPath, blockNumber.toString())
      await fs.mkdir(blockPath, { recursive: true })
      
      // Create metadata.json file
      const metadataPath = join(blockPath, 'metadata.json')
      const metadata = {
        contenthash,
        tx: txHash,
        originalName: ensName !== safeEnsName ? ensName : undefined // Store original name if truncated
      }
      
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
      
      console.log(`Saved: ${safeEnsName} at block ${blockNumber}`)
    } catch (error) {
      console.error(`Error saving contenthash change for ${safeEnsName}:`, error.message)
      // Continue processing other entries even if this one fails
    }
  }
}
