#!/usr/bin/env node
// Load environment variables from .env file
import * as dotenv from 'dotenv'
dotenv.config()

import { program } from 'commander'
import { addCommand, updateCommand, testCommand, scanCommand, initializeCache } from '../src/cli-commands.js'

program
    .name('dapprank')
    .description('Analyze ENS sites for external dependencies and Web3 APIs')
    .option('-i, --ipfs <url>', 'IPFS API URL', 'http://localhost:5001')
    .option('-r, --rpc <url>', 'Ethereum RPC URL', 'http://localhost:8545')

// Add command
program
    .command('add')
    .description('Add a new report for an ENS domain')
    .argument('<ens-name>', 'ENS name to analyze')
    .option('-f, --force', 'Force analysis even if a report exists for this CID', false)
    .option('-n, --no-save', 'Skip saving the report to disk and print to console instead', true)
    .action(async (ensName, options) => {
        const parentOptions = program.optsWithGlobals();
        await addCommand(ensName, options, parentOptions);
    });

// Update command
program
    .command('update')
    .description('Update all existing reports')
    .option('--halt-on-error', 'Stop processing all domains after the first error', false)
    .action(async (options) => {
        const parentOptions = program.optsWithGlobals();
        await updateCommand(options, parentOptions);
    });

// Test command
program
    .command('test')
    .description('Test analysis for a CID without saving')
    .argument('<cid>', 'CID to analyze')
    .action(async (cid, options) => {
        const parentOptions = program.optsWithGlobals();
        await testCommand(cid, options, parentOptions);
    });

// Scan command
program
    .command('scan')
    .description('Scan for all contenthash changes and persist them to the filesystem (uses ENSNode API)')
    .requiredOption('-f, --folder <path>', 'Folder to store scan results')
    .action(async (options) => {
        const parentOptions = program.optsWithGlobals();
        await scanCommand(options, parentOptions);
    });

// Load the cache before parsing commands
await initializeCache();

program.parseAsync();
