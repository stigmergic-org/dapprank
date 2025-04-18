/**
 * Utility functions for handling environment variables
 */

/**
 * Get the Tenderly API Key from environment variables
 */
export function getTenderlyApiKey(): string | undefined {
  return process.env.TENDERLY_API_KEY;
}

/**
 * Check if Tenderly API Key is available
 */
export function hasTenderlyApiKey(): boolean {
  const apiKey = getTenderlyApiKey();
  return !!apiKey && apiKey.length > 0;
}

/**
 * Log environment information (for debugging)
 */
export function logEnvironmentInfo(): void {
  console.log('Environment Information:');
  console.log('- Tenderly API Key available:', hasTenderlyApiKey());
} 