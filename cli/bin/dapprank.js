#!/usr/bin/env node
// Load environment variables from .env file
import * as dotenv from 'dotenv'
dotenv.config()

import { program } from 'commander'
import { scanCommand, analyzeCommand, buildIdxsCommand, rankCommand } from '../src/cli-commands.js'
import { logger } from '../src/logger.js'

program
    .name('dapprank')
    .description('Analyze ENS sites for external dependencies and Web3 APIs')
    .option('-i, --ipfs <url>', 'IPFS API URL', 'http://localhost:5001')
    .option('-r, --rpc <url>', 'Ethereum RPC URL', 'https://eth.drpc.org')
    .option('-d, --directory <path>', 'Output directory (only used when --use-mfs=false)', 'public/dapps')
    .option('-c, --cache <path>', 'Directory to use for cache (defaults to ./llm-cache)', './llm-cache')
    .option('-f, --force', 'Force overwrite existing reports')
    .option('-l, --log-level <level>', 'Log level (error, warn, info, debug)', 'error')
    .option('--use-mfs', 'Use IPFS MFS for storage', true)
    .option('-p, --data-pointer <path>', 'File to store MFS root CID', './data-pointer.txt')


// Scan command
program
    .command('scan')
    .description('Scan for all contenthash changes and persist them to the filesystem (uses ENSNode API)')
    .action(async (options) => {
        const parentOptions = program.optsWithGlobals();
        const mergedOptions = { ...parentOptions, ...options };
        
        // Set log level
        let logLevel = mergedOptions.logLevel;
        if (logLevel && logLevel.startsWith('=')) {
            logLevel = logLevel.substring(1);
        }
        logger.setLevel(logLevel);
        
        await scanCommand(mergedOptions);
    });

// Analyze command
program
    .command('analyze')
    .description('Analyze scanned results from dapprank scan in archive folder')
    .option('-b, --backwards', 'Analyze backwards from oldest block number', false)
    .option('--dry-run [type]', 'Dry run analysis to stdout (options: governance, networking, distribution, all)')
    .argument('[ens-name]', 'Optional: Only analyze a specific ENS name')
    .action(async (ensName, options) => {
        const parentOptions = program.optsWithGlobals();
        const mergedOptions = { ...parentOptions, ...options };
        
        // Set log level
        let logLevel = mergedOptions.logLevel;
        if (logLevel && logLevel.startsWith('=')) {
            logLevel = logLevel.substring(1);
        }
        logger.setLevel(logLevel);
        
        await analyzeCommand(ensName, mergedOptions);
    });

// Build indexes command
program
    .command('build-idxs')
    .description('Build directory indexes from archive (live, webapps)')
    .action(async (options) => {
        const parentOptions = program.optsWithGlobals();
        const mergedOptions = { ...parentOptions, ...options };
        
        // Set log level
        let logLevel = mergedOptions.logLevel;
        if (logLevel && logLevel.startsWith('=')) {
            logLevel = logLevel.substring(1);
        }
        logger.setLevel(logLevel);
        
        await buildIdxsCommand(mergedOptions);
    });

// Rank command
program
    .command('rank')
    .description('Calculate censorship resistance rank score for a dapp')
    .argument('<ens-name>', 'ENS name to rank')
    .option('--json', 'Output in JSON format', false)
    .action(async (ensName, options) => {
        const parentOptions = program.optsWithGlobals();
        const mergedOptions = { ...parentOptions, ...options };
        
        // Set log level
        let logLevel = mergedOptions.logLevel;
        if (logLevel && logLevel.startsWith('=')) {
            logLevel = logLevel.substring(1);
        }
        logger.setLevel(logLevel);
        
        await rankCommand(ensName, mergedOptions);
    });

program.parseAsync();
