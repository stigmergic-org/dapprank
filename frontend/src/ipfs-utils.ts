import { unixfs } from '@helia/unixfs'
import * as dagCbor from '@ipld/dag-cbor'
import * as dagJson from '@ipld/dag-json'
import * as dagPb from '@ipld/dag-pb'
import * as raw from 'multiformats/codecs/raw'
import { MemoryBlockstore } from 'blockstore-core/memory'
import { CARFactory } from "cartonne"
import { concat } from 'uint8arrays'
import { CID } from 'multiformats/cid'

/**
 * Reads a JSON file from UnixFS and parses it.
 * 
 * @param fs - The UnixFS instance to use
 * @param cid - The root CID to read from
 * @param path - The path to the JSON file, relative to the root CID
 * @returns The parsed JSON content
 * @throws Error if the file cannot be read or parsed
 */
export async function getJson<T = any>(fs: any, cid: CID, path: string): Promise<T> {
  const chunks = []
  for await (const chunk of fs.cat(cid, { path })) {
    chunks.push(chunk)
  }
  const content = new TextDecoder().decode(concat(chunks))
  return JSON.parse(content)
}

/**
 * Fetches a CAR file from the given path and returns a unixfs instance
 * containing the CAR file contents.
 * 
 * @param path - The path to fetch the CAR file from (without format parameter)
 * @returns A unixfs instance and the root CID of the CAR file
 * @throws Error if the CAR file cannot be fetched or processed
 */
export async function fetchCar(path: string) {
  // Create a memory blockstore to store the blocks
  const blockstore = new MemoryBlockstore()
  
  // Create a fake Helia instance with the blockstore and codec getters
  const fakeHelia = {
    blockstore,
    getCodec: (code: number) => {
      switch (code) {
        case dagCbor.code:
          return dagCbor
        case dagJson.code:
          return dagJson
        case dagPb.code:
          return dagPb
        case raw.code:
          return raw
        default:
          throw new Error(`Unknown codec: ${code}`)
      }
    }
  }
  
  // Create a unixfs instance with the fake Helia
  const fs = unixfs(fakeHelia)
  
  // Ensure the path doesn't already have a trailing slash, then add format parameter
  const fetchPath = `${path}?format=car`
  
  // Fetch the CAR file
  const response = await fetch(fetchPath)
  if (!response.ok) {
    throw new Error(`Failed to fetch CAR file from ${fetchPath}: ${response.status} ${response.statusText}`)
  }
  
  // Convert the response to bytes
  const carBytes = new Uint8Array(await response.arrayBuffer())
  
  // Create a CAR factory with the necessary codecs
  const carFactory = new CARFactory()
  carFactory.codecs.add(dagCbor)
  carFactory.codecs.add(dagPb)
  carFactory.codecs.add(dagJson)
  carFactory.codecs.add(raw)
  
  // Parse the CAR bytes
  const car = carFactory.fromBytes(carBytes, { verify: true })
  
  // Store all blocks in the blockstore
  for await (const block of car.blocks) {
    await blockstore.put(block.cid, block.payload)
  }
  
  // Check if we have any roots
  if (car.roots.length === 0) {
    throw new Error('CAR file has no roots')
  }
  
  // Return the unixfs instance and the root CID
  return { fs, root: car.roots[0] }
} 