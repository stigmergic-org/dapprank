# DappRank

ENS site analysis and ranking tool with a web frontend and CLI backend.

## Project Structure

This is a pnpm workspace with two packages:

- **`frontend/`** - Web application built with webpack and TypeScript
- **`dapprank/`** - CLI tool for analyzing ENS sites

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
# Install dependencies for all packages
pnpm install

# Start the frontend development server
pnpm dev

# Build the frontend
pnpm build

# Run CLI commands
pnpm analyze
pnpm add
pnpm update
```

### Package-specific commands

```bash
# Frontend
pnpm --filter frontend run start
pnpm --filter frontend run build

# CLI
pnpm --filter dapprank run analyze
pnpm --filter dapprank run add
pnpm --filter dapprank run update
```

## License

GPL-3.0-only
