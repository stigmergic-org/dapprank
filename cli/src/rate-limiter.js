import { logger } from './logger.js'

/**
 * Simple rate limiter that ensures we don't exceed a certain number of requests per minute
 */
export class RateLimiter {
  #requestTimestamps = []
  #maxRequestsPerMinute
  #minDelayMs
  #lastRateLimitError = null
  
  constructor(maxRequestsPerMinute = 2) {
    this.#maxRequestsPerMinute = maxRequestsPerMinute
    // Calculate minimum delay between requests to stay under limit
    // Add 10% buffer for safety
    this.#minDelayMs = Math.ceil((60000 / maxRequestsPerMinute) * 1.1)
    logger.debug(`Rate limiter initialized: ${maxRequestsPerMinute} requests/min, ${this.#minDelayMs}ms between requests`)
  }
  
  /**
   * Called when a 429 rate limit error occurs
   * This helps the rate limiter be aware of rate limit violations
   */
  onRateLimitError() {
    this.#lastRateLimitError = Date.now()
    logger.debug('Rate limiter notified of 429 error')
  }
  
  /**
   * Wait if necessary to respect rate limit, then record the request
   * @returns {Promise<void>}
   */
  async waitForSlot() {
    const now = Date.now()
    
    // If we recently got a rate limit error, add extra delay
    if (this.#lastRateLimitError && (now - this.#lastRateLimitError) < 120000) {
      const timeSinceError = now - this.#lastRateLimitError
      const extraDelay = Math.max(0, 5000 - timeSinceError) // Wait at least 5s after a 429
      if (extraDelay > 0) {
        logger.debug(`Rate limit: adding ${Math.ceil(extraDelay / 1000)}s delay due to recent 429 error`)
        await new Promise(resolve => setTimeout(resolve, extraDelay))
      }
    }
    
    // Remove timestamps older than 1 minute
    this.#requestTimestamps = this.#requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    )
    
    // If we've hit the limit, wait until the oldest request is outside the 1-minute window
    if (this.#requestTimestamps.length >= this.#maxRequestsPerMinute) {
      const oldestTimestamp = this.#requestTimestamps[0]
      const timeToWait = 60000 - (now - oldestTimestamp) + 100 // Add 100ms buffer
      
      if (timeToWait > 0) {
        logger.debug(`Rate limit: waiting ${Math.ceil(timeToWait / 1000)}s (${this.#requestTimestamps.length}/${this.#maxRequestsPerMinute} requests in last minute)`)
        await new Promise(resolve => setTimeout(resolve, timeToWait))
      }
    }
    
    // Also enforce minimum delay between consecutive requests
    if (this.#requestTimestamps.length > 0) {
      const lastTimestamp = this.#requestTimestamps[this.#requestTimestamps.length - 1]
      const timeSinceLastRequest = now - lastTimestamp
      
      if (timeSinceLastRequest < this.#minDelayMs) {
        const delayNeeded = this.#minDelayMs - timeSinceLastRequest
        logger.debug(`Rate limit: enforcing minimum delay of ${Math.ceil(delayNeeded / 1000)}s between requests`)
        await new Promise(resolve => setTimeout(resolve, delayNeeded))
      }
    }
    
    // Record this request
    this.#requestTimestamps.push(Date.now())
  }
  
  /**
   * Get current request count in the last minute
   */
  getCurrentCount() {
    const now = Date.now()
    this.#requestTimestamps = this.#requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    )
    return this.#requestTimestamps.length
  }
}

// Global singleton instance
let globalRateLimiter = null

/**
 * Get or create the global rate limiter instance
 * @param {number} maxRequestsPerMinute - Maximum requests per minute
 * @returns {RateLimiter}
 */
export function getRateLimiter(maxRequestsPerMinute = 2) {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(maxRequestsPerMinute)
  }
  return globalRateLimiter
}
