/**
 * Deduplication utilities for analysis results
 * These can be used by report consumers for their own aggregation needs
 */

/**
 * Normalize library name for fuzzy matching
 * Removes common variations to enable better deduplication
 * @param {string} name - Library name
 * @returns {string} Normalized name
 */
export function normalizeLibraryName(name) {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .trim()
    .replace(/\.js$/, '')           // Remove .js suffix
    .replace(/\.min$/, '')          // Remove .min suffix
    .replace(/@[\d.]+.*$/, '')      // Remove version numbers like @1.2.3
    .replace(/^@[^/]+\//, '')       // Remove npm scope like @org/
    .replace(/[-_]/g, '');          // Normalize separators
}

/**
 * Check if two library names are similar (fuzzy match)
 * @param {string} name1 - First library name
 * @param {string} name2 - Second library name
 * @returns {boolean} True if names are similar
 */
export function areSimilarLibraries(name1, name2) {
  const norm1 = normalizeLibraryName(name1);
  const norm2 = normalizeLibraryName(name2);
  
  // Exact match
  if (norm1 === norm2) return true;
  
  // Substring match (e.g., "ethers" matches "ethersproject")
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    // But avoid false positives - names should be at least 3 chars
    return Math.min(norm1.length, norm2.length) >= 3;
  }
  
  return false;
}

/**
 * Deduplicate array of library objects using fuzzy matching
 * @param {Array<{name: string, motivation: string}>} libraries - Libraries to deduplicate
 * @returns {Array<{name: string, motivation: string}>} Deduplicated libraries
 */
export function deduplicateLibraries(libraries) {
  if (!libraries || libraries.length === 0) return [];
  
  const seen = new Map();
  const result = [];
  
  for (const lib of libraries) {
    if (!lib.name) continue;
    
    // Check if we've seen a similar library
    let foundSimilar = false;
    for (const [seenName, _] of seen) {
      if (areSimilarLibraries(lib.name, seenName)) {
        foundSimilar = true;
        break;
      }
    }
    
    if (!foundSimilar) {
      const normalizedKey = normalizeLibraryName(lib.name);
      seen.set(lib.name, true);
      result.push(lib);
    }
  }
  
  return result;
}

/**
 * Deduplicate networking entries by method + urls + type
 * @param {Array<{method: string, urls: string[], type: string, ...}>} networking - Networking entries
 * @returns {Array} Deduplicated networking entries
 */
export function deduplicateNetworking(networking) {
  if (!networking || networking.length === 0) return [];
  
  const seen = new Set();
  const result = [];
  
  for (const net of networking) {
    // Create a key from method, sorted urls, and type
    const urlsKey = [...(net.urls || [])].sort().join('|');
    const key = `${net.method}:${urlsKey}:${net.type}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      result.push(net);
    }
  }
  
  return result;
}

/**
 * Deduplicate fallbacks by type
 * @param {Array<{type: string, motivation: string}>} fallbacks - Fallback entries
 * @returns {Array} Deduplicated fallbacks
 */
export function deduplicateFallbacks(fallbacks) {
  if (!fallbacks || fallbacks.length === 0) return [];
  
  const seen = new Set();
  const result = [];
  
  for (const fallback of fallbacks) {
    if (!seen.has(fallback.type)) {
      seen.add(fallback.type);
      result.push(fallback);
    }
  }
  
  return result;
}

/**
 * Deduplicate distribution purity items by url
 * @param {Array<{type: string, url: string, ...}>} items - Distribution purity items
 * @returns {Array} Deduplicated items
 */
export function deduplicateDistributionPurityItems(items) {
  if (!items || items.length === 0) return [];
  
  const seen = new Set();
  const result = [];
  
  for (const item of items) {
    // Key by type and url
    const key = `${item.type}:${item.url}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  
  return result;
}

/**
 * Generic deduplication by key function
 * @param {Array} items - Items to deduplicate
 * @param {Function} keyFn - Function that extracts key from item
 * @returns {Array} Deduplicated items
 */
export function deduplicateByKey(items, keyFn) {
  if (!items || items.length === 0) return [];
  
  const seen = new Set();
  const result = [];
  
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  
  return result;
}
