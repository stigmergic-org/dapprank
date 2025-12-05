import { promises as fs } from 'fs'
import { join } from 'path'
import { CID } from "multiformats/cid"
import { toString } from 'uint8arrays/to-string'
import { logger } from './logger.js'

// Cache for script analysis to avoid repeated AI calls for identical content
export class CacheManager {
    constructor(cachePath) {
        this.cachePath = cachePath;
        logger.debug('cachePath', this.cachePath)
    }

    // Ensure cache directory exists
    async ensureCacheDirectory(promptVersion) {
        const promptDir = join(this.cachePath, `prompt-v${promptVersion}`);
        await fs.mkdir(promptDir, { recursive: true });
        return promptDir;
    }

    // Convert CID to base64 multihash
    cidToBase64Multihash(fileCid) {
        let cid = fileCid
        if (typeof fileCid === 'string') {
            cid = CID.parse(fileCid)
        }
        // Convert to base64 and make filesystem-safe by replacing invalid characters
        const base64 = toString(cid.multihash.digest, 'base64')
        // Replace '/' with '_' and '=' with '-' to make it filesystem-safe
        return base64.replace(/\//g, '_').replace(/=/g, '-')
    }

    // Get cache entry
    async getEntry(promptVersion, fileCid) {
        const promptDir = await this.ensureCacheDirectory(promptVersion);
        const multihash = this.cidToBase64Multihash(fileCid);
        const cacheFile = join(promptDir, `${multihash}.json`);
        
        const cacheExists = await fs.access(cacheFile).then(() => true).catch(() => false);
        if (cacheExists) {
            const cacheData = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
            return cacheData.values || null;
        }
        return null;
    }

    // Set cache entry
    async setEntry(promptVersion, fileCid, values) {
        const promptDir = await this.ensureCacheDirectory(promptVersion);
        const multihash = this.cidToBase64Multihash(fileCid);
        const cacheFile = join(promptDir, `${multihash}.json`);
        
        const cacheData = {
            values,
            timestamp: new Date().toISOString()
        };
        
        await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
        logger.debug(`Cached entry for prompt-v${promptVersion}, file ${fileCid}`);
    }
}