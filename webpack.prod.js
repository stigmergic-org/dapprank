const { merge } = require("webpack-merge");
const CompressionWebpackPlugin = require("compression-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const common = require("./webpack.common");
const { exec } = require("child_process");
const webpack = require("webpack");
const dotenv = require("dotenv");

// Load environment variables
const env = dotenv.config().parsed || {};

// Custom plugin to add build to IPFS
class IPFSPlugin {
  // Wrap exec in a Promise
  execPromise(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync('IPFSPlugin', async (compilation, callback) => {
      try {
        console.log('\nPreparing Git repository...');
        await this.execPromise('git update-server-info');
        await this.execPromise('mkdir -p dist/.well-known');
        await this.execPromise('cp -r .git dist/.well-known/source.git');
        
        console.log('\nAdding build to IPFS...');
        const { stdout, stderr } = await this.execPromise('ipfs add --hidden --cid-version=1 -r dist');
        
        if (stderr) {
          console.error(`IPFS stderr: ${stderr}`);
        }
        
        // Extract the CID of the dist directory
        const lines = stdout.trim().split('\n');
        const distLine = lines[lines.length - 1];
        
        if (distLine && distLine.includes('dist')) {
          const parts = distLine.split(' ');
          if (parts.length >= 2) {
            const cid = parts[1];
            console.log('\n==================================');
            console.log(`🎉 Successfully added to IPFS!`);
            console.log(`📋 CID: ${cid}`);
            console.log(`🔗 Gateway link: http://${cid}.ipfs.localhost:8082/`);
            console.log(`🔗 Explorer link: https://webui.ipfs.io/#/ipfs/${cid}/`);
            console.log('==================================\n');
          }
        } else {
          console.log('\nCould not find the CID for the dist directory in the IPFS output.');
        }
        
        callback();
      } catch (error) {
        console.error(`Error: ${error.message}`);
        callback(error);
      }
    });
  }
}

module.exports = merge(common, {
  mode: "production",
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
  plugins: [
    new CompressionWebpackPlugin({
      algorithm: 'gzip',
      test: /\.(js|css|html|svg)$/,
      threshold: 10240,
      minRatio: 0.8,
    }),
    new webpack.DefinePlugin({
      'process.env': {
        // Pass the environment variables
        TENDERLY_API_KEY: JSON.stringify(env.TENDERLY_API_KEY || process.env.TENDERLY_API_KEY || ''),
        // Add other environment variables as needed
      }
    }),
    new IPFSPlugin()
  ]
});
