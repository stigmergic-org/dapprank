import { merge } from "webpack-merge";
import common from "./webpack.common.js";
import { unixfs } from '@helia/unixfs';
import { MemoryBlockstore } from 'blockstore-core/memory';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import * as dagPb from '@ipld/dag-pb';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { CARFactory, CarBlock } from 'cartonne';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create global objects
globalThis.blockstore = new MemoryBlockstore();
globalThis.latestIpfsCid = null;

// Create fake Helia instance globally
globalThis.fakeHelia = {
  blockstore: globalThis.blockstore,
  getCodec: (code) => {
    switch (code) {
      case dagCbor.code:
        return dagCbor;
      case dagJson.code:
        return dagJson;
      case dagPb.code:
        return dagPb;
      case raw.code:
        return raw;
      default:
        throw new Error(`Unknown codec: ${code}`);
    }
  }
};

// Initialize UnixFS with the fake Helia
globalThis.unixfs = unixfs(globalThis.fakeHelia);

// Create CAR factory globally
globalThis.carFactory = new CARFactory();
globalThis.carFactory.codecs.add(dagCbor);
globalThis.carFactory.codecs.add(dagPb);
globalThis.carFactory.codecs.add(dagJson);
globalThis.carFactory.codecs.add(raw);

// Custom plugin to build IPFS data after webpack build
class IpfsPlugin {
  apply(compiler) {
    // Use afterCompile hook to access assets before they're optimized
    compiler.hooks.afterCompile.tapAsync('IpfsPlugin', async (compilation, callback) => {
      const assets = compilation.getAssets();
      if (assets.length === 0) {
        callback();
        return;
      }
      
      try {
        // Reset blockstore for new build
        globalThis.blockstore = new MemoryBlockstore();
        globalThis.fakeHelia.blockstore = globalThis.blockstore;
        
        // Add all assets to UnixFS and get the root CID
        const rootCid = await addAssetsToUnixfs(assets, globalThis.unixfs);
        globalThis.latestIpfsCid = rootCid.toString();
        
        callback();
      } catch (error) {
        console.error('Error creating IPFS data:', error);
        callback(error);
      }
    });
  }
}

// Function to add webpack assets to UnixFS and return the root CID
async function addAssetsToUnixfs(assets, fs) {
  // Convert assets to ImportCandidateStream
  const importCandidates = function* () {
    for (const asset of assets) {
      try {
        const content = Buffer.from(asset.source.source());
        yield {
          path: asset.name,
          content
        };
      } catch (error) {
        console.warn(`Could not convert asset ${asset.name}: ${error.message}`);
        // Yield an empty file as fallback
        yield {
          path: asset.name,
          content: Buffer.from('')
        };
      }
    }
  };
  
  // Use addAll to process all files at once
  let rootEntry = null;
  for await (const entry of fs.addAll(importCandidates(), { wrapWithDirectory: true })) {
    // The last entry will be the root directory
    rootEntry = entry;
  }
  
  if (!rootEntry) {
    throw new Error('No root entry found after importing assets');
  }
  
  return rootEntry.cid;
}

// Custom middleware to handle CAR file requests
function carMiddleware(req, res, next) {
  if (req.url.includes('?format=car')) {
    // Extract the path from the URL
    const urlPath = req.url.split('?')[0];
    
    // Set cache control headers to prevent caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    
    // Create and serve a CAR file for the requested path
    createAndServeCarFile(urlPath, res).catch(err => {
      console.error('Error serving CAR file:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    });
  } else {
    next();
  }
}

// Function to create and serve a CAR file
async function createAndServeCarFile(urlPath, res) {
  if (!globalThis.latestIpfsCid) {
    res.statusCode = 503;
    res.end('IPFS data not yet available');
    return;
  }
  
  try {
    // Get the CID for the requested path
    const rootCid = CID.parse(globalThis.latestIpfsCid);
    let targetCid = rootCid;
    if (urlPath !== '/') {
      const stats = await globalThis.unixfs.stat(rootCid, { path: urlPath });
      targetCid = stats.cid;
    }
    
    // Create a CAR with the target CID as the root
    const car = await globalThis.carFactory.build();
    car.roots = [targetCid]; // Set the roots array directly to the target CID
    
    // Add the root block
    await addBlockToCar(targetCid, car, true);
    
    // Process the requested path and all its contents
    await processPath(targetCid, car);

    const carBytes = car.bytes;
    
    // Send the CAR file
    res.setHeader('Content-Type', 'application/vnd.ipld.car');
    res.setHeader('Content-Length', carBytes.length);
    // Add a unique ETag based on timestamp to force revalidation
    res.setHeader('ETag', `"${Date.now().toString()}"`);
    res.end(carBytes);
  } catch (error) {
    console.error('Error creating CAR file:', error);
    res.statusCode = 500;
    res.end('Error creating CAR file');
  }
}

// Helper function to add a block to the CAR
async function addBlockToCar(cid, car) {
  const bytes = await globalThis.blockstore.get(cid);
  const block = new CarBlock(cid, bytes);
  // Add the block to the CAR
  car.blocks.put(block);
}

// Helper function to process a path and all its contents
async function processPath(cid, car) {
  try {
    // Use ls to get all entries at the path
    for await (const entry of globalThis.unixfs.ls(cid)) {
      // Add the entry's CID block
      await addBlockToCar(entry.cid, car);
      
      // If this is a directory, recursively process its contents
      if (entry.type === 'directory') {
        await processPath(entry.cid, car);
      }
    }
  } catch (error) {
    console.warn(`Error processing path ${path} with CID ${cid.toString()}: ${error.message}`);
  }
}

// Export the webpack config
export default merge(common, {
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    static: {
      directory: "./dist"
    },
    historyApiFallback: true,
    port: 3000,
    setupMiddlewares: (middlewares, devServer) => {
      // Insert the CAR middleware before other middlewares
      middlewares.unshift({
        name: 'car-middleware',
        middleware: carMiddleware
      });
      return middlewares;
    }
  },
  plugins: [
    new IpfsPlugin()
  ]
}); 