import { promises as fs } from 'fs'
import { join } from 'path'
import crypto from 'crypto'

// Cache for script analysis to avoid repeated AI calls for identical content
const scriptAnalysisCache = new Map();
const CACHE_FILE_PATH = join(process.cwd(), 'script-analysis-cache.json');

// Load cache from disk if it exists
export async function loadScriptAnalysisCache() {
    try {
        const cacheExists = await fs.access(CACHE_FILE_PATH).then(() => true).catch(() => false);
        if (cacheExists) {
            const cacheData = JSON.parse(await fs.readFile(CACHE_FILE_PATH, 'utf-8'));
            Object.entries(cacheData).forEach(([key, value]) => {
                scriptAnalysisCache.set(key, value);
            });
            console.log(`Loaded script analysis cache with ${scriptAnalysisCache.size} entries`);
        }
    } catch (error) {
        console.error('Failed to load script analysis cache:', error.message);
    }
}

// Save cache to disk
export async function saveScriptAnalysisCache() {
    try {
        const cacheData = Object.fromEntries(scriptAnalysisCache.entries());
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));
        console.log(`Saved script analysis cache with ${scriptAnalysisCache.size} entries`);
    } catch (error) {
        console.error('Failed to save script analysis cache:', error.message);
    }
}

// Get cache entry
export function getCacheEntry(key) {
    return scriptAnalysisCache.get(key);
}

// Set cache entry
export function setCacheEntry(key, value) {
    scriptAnalysisCache.set(key, value);
}

// Create a stable hash for the system prompt to make sure it's consistent across runs
export function createPromptHash(systemPrompt) {
    return crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 8);
}

// Create a combined hash for script content and prompt
export function createCombinedHash(scriptText, promptHash) {
    const scriptHash = crypto.createHash('sha256').update(scriptText).digest('hex');
    return `${scriptHash}_${promptHash}`;
}
