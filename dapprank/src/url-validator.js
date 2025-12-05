import { logger } from './logger.js'

/**
 * Validates that URLs reported by AI actually exist in source code
 * Handles direct matches, template patterns, and dynamic construction
 */

/**
 * Normalize URL by lowercasing domain and removing trailing slash
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
export function normalizeUrl(url) {
  if (!url || url.startsWith('<')) return url; // Skip markers like <dynamic>, <arbitrary>
  
  try {
    const urlObj = new URL(url);
    // Lowercase domain, remove trailing slash from pathname, keep query/hash
    const pathname = urlObj.pathname.replace(/\/$/, '') || '/';
    return `${urlObj.protocol}//${urlObj.host.toLowerCase()}${pathname}${urlObj.search}${urlObj.hash}`;
  } catch {
    // Relative URL or invalid - just remove trailing slash
    return url.replace(/^\.\//, '').replace(/\/$/, '');
  }
}

/**
 * Validate URLs against source code
 * Simplified: only checks if domain exists in source code
 * @param {string[]} urls - Array of URLs to validate
 * @param {string} scriptText - Source code to validate against
 * @returns {Array<{url: string, valid: boolean, reason: string}>} Validation results
 */
export function validateUrls(urls, scriptText) {
  return urls.map(url => {
    const normalized = normalizeUrl(url);
    
    // Handle special markers - always valid
    if (url.startsWith('<') && url.endsWith('>')) {
      return { url, valid: true, reason: 'marker' };
    }
    
    // Direct string match (exact)
    if (scriptText.includes(url)) {
      return { url: normalized, valid: true, reason: 'direct' };
    }
    
    // Try to extract domain and check if it exists in code
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      
      // Check if domain exists anywhere in code
      // Don't try to guess how it's templated - source code can do it arbitrarily
      if (scriptText.includes(domain)) {
        return { url: normalized, valid: true, reason: 'domain-found' };
      }
    } catch {
      // Not a valid URL, check if it's a relative path
      const cleanPath = url.replace(/^\//, '');
      if (scriptText.includes(url) || scriptText.includes(cleanPath)) {
        return { url: normalized, valid: true, reason: 'relative' };
      }
    }
    
    return { url, valid: false, reason: 'not-found' };
  });
}

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain or original string if not a URL
 */
export function extractDomain(url) {
  if (url.startsWith('<')) return url; // Markers
  
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return url; // Relative or invalid
  }
}

/**
 * Strip API keys from URLs for grouping/comparison
 * Replaces common API key patterns with placeholders
 * @param {string} url - URL to process
 * @returns {string} URL with API keys replaced by <api-key>
 */
export function stripApiKey(url) {
  if (!url || url.startsWith('<')) return url;
  
  // Common patterns:
  // - /v3/<key> (Infura)
  // - /api/<key> (generic)
  // - /<key>/rpc (some providers)
  // - apiKey=<key> (query param)
  // - api_key=<key> (query param)
  
  let processed = url;
  
  // Path-based keys (32+ alphanumeric characters)
  processed = processed.replace(/\/v\d+\/[a-zA-Z0-9_-]{20,}/g, (match) => {
    const version = match.match(/\/v\d+\//)[0];
    return `${version}<api-key>`;
  });
  
  processed = processed.replace(/\/api\/[a-zA-Z0-9_-]{20,}/g, '/api/<api-key>');
  processed = processed.replace(/\/[a-zA-Z0-9_-]{32,}\/rpc/g, '/<api-key>/rpc');
  processed = processed.replace(/\/[a-zA-Z0-9_-]{32,}$/g, '/<api-key>');
  
  // Query parameter keys
  processed = processed.replace(/([?&])(apiKey|api_key|key|token|access_token)=[a-zA-Z0-9_-]{20,}/gi, '$1$2=<api-key>');
  
  return processed;
}

/**
 * Classify URLs by domain for debugging
 * @param {string[]} urls - URLs to classify
 * @returns {Object} Map of domain to URLs
 */
export function classifyUrlsByDomain(urls) {
  const domainMap = {};
  
  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domainMap[domain]) {
      domainMap[domain] = [];
    }
    domainMap[domain].push(url);
  }
  
  return domainMap;
}
