import contentHash from 'content-hash'

/**
 * Decode contenthash to human-readable text format and get codec
 * @param {string} contenthash - The contenthash to decode
 * @returns {object|null} - Object with decoded value and codec, or null if decoding fails
 */
export async function decodeContenthash(contenthash) {
  // Remove 0x prefix if present for content-hash package
  const hexData = contenthash.startsWith('0x') ? contenthash.slice(2) : contenthash

  try {
    // Use content-hash package to decode
    const decodedValue = contentHash.decode(hexData)
    const codec = contentHash.getCodec(hexData)

    return {
      value: decodedValue,
      codec: codec
    }
  } catch (decodeError) {
    console.log('Error decoding contenthash with content-hash package:', decodeError.message)
    return null
  }
}
