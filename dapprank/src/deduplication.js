/**
 * Deduplication utilities for analysis results
 * These can be used by report consumers for their own aggregation needs
 */

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
