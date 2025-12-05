# DappRank CLI Tool

A CLI tool for analyzing ENS sites for external dependencies and Web3 APIs.

## Project Structure

The project has been refactored into a modular structure for better maintainability:

```
dapprank/
├── bin/
│   └── dapprank.js          # CLI entry point
├── src/
│   ├── index.js             # Main module exports
│   ├── cache-manager.js     # Script analysis caching
│   ├── constants.js         # Configuration constants and system prompts
│   ├── ens-resolver.js      # ENS resolution logic
│   ├── html-analyzer.js     # HTML parsing and metadata extraction
│   ├── ipfs-utils.js        # IPFS operations and file handling
│   ├── report-generator.js  # Report generation and file management
│   ├── script-analyzer.js   # JavaScript analysis and AI integration
│   └── cli-commands.js      # CLI command definitions
└── package.json
```

## Modules

### `cache-manager.js`
Handles script analysis caching to avoid repeated AI calls for identical content.

### `constants.js`
Contains all configuration constants, system prompts, and shared values.

### `ens-resolver.js`
Handles ENS name resolution using the Universal Resolver contract.

### `html-analyzer.js`
Parses HTML content, extracts metadata, and identifies external resources.

### `ipfs-utils.js`
Manages IPFS operations including file listing, content retrieval, and MIME type detection.

### `report-generator.js`
Generates analysis reports and manages file storage and symlinks.

### `script-analyzer.js`
Analyzes JavaScript code using AI (Google Gemini) to identify libraries and network calls.

### `cli-commands.js`
Defines and implements all CLI commands (add, update, test).

## Usage

```bash
# Add a new report for an ENS domain
pnpm run add <ens-name>

# Update all existing reports
pnpm run update

# Test analysis for a CID without saving
pnpm run test <cid>

# Run with custom IPFS and RPC endpoints
pnpm run add <ens-name> --ipfs <ipfs-url> --rpc <rpc-url>
```

## Dependencies

- `@simplepg/common` - For ENS resolution
- `@google/genai` - For AI-powered script analysis
- `kubo-rpc-client` - For IPFS operations
- `viem` - For Ethereum interactions
- `cheerio` - For HTML parsing
- `@babel/parser` & `@babel/traverse` - For JavaScript AST analysis

## Environment Variables

- `GOOGLE_API_KEY` - Required for AI analysis functionality
