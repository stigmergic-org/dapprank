// Address of the Universal Resolver contract on mainnet
export const UNIVERSAL_RESOLVER_ADDRESS = '0x64969fb44091A7E5fA1213D30D7A7e8488edf693'

export const WEB3_APIs = [
    { url: 'http://localhost:8545', service: 'ethereum', risk: 'none' },
    { url: 'http://127.0.0.1:8545', service: 'ethereum', risk: 'none' },
]

export const LINK_NON_FETCHING_REL_VALUES = [
    'alternate',
    'author',
    'help',
    'license',
    'next',
    'prev',
    'nofollow',
    'noopener',
    'noreferrer',
    'bookmark',
    'tag',
    'external',
    'no-follow',
    'canonical'
]

export const ANALYSIS_VERSION = 4

// Rate limiting for AI analysis requests
export const AI_REQUESTS_PER_MINUTE = 50

// Create a stable hash for the system prompt to make sure it's consistent across runs
export const SYSTEM_PROMPT_TEMPLATE = `
Analyze the provided JavaScript code and answer the following questions thoroughly.

IMPORTANT: Normalize all URLs by lowercasing domains and removing trailing slashes before returning them.

1. What calls are there to networking APIs, and what url is being passed? (if one of the methods is detected, there MUST be a corresponding entry in the networking section)
    - method: look only for fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket, WebSocketStream, EventSource, RTCPeerConnection
    - httpMethod: if determinable from the code, specify GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; otherwise use UNKNOWN
    - urls: extract URLs with these rules:
        * Direct URLs: include exact string found (e.g., "https://mainnet.infura.io/v3/abc123")
        * Template URLs: use angle brackets for variables (e.g., "https://api.com/<address>/<id>")
        * Dynamic URLs: use "<dynamic>" when URL is constructed from multiple variables and cannot be determined
        * Arbitrary URLs: use "<arbitrary>" when URL comes from user config, input, or external source
        * For APIs with keys in URL path (e.g., /v3/abc123), replace the key with placeholder (e.g., "https://api.com/v3/<api-key>")
        * Don't include urls that are only 'window.ethereum' or query param '?ds-rpc-<CHAIN_ID>'
        * Don't include API keys or secrets in URLs - replace them with <api-key> placeholder
    - library: best guess which library makes this call, or otherwise leave empty
    - type: one of:
        - rpc: urls that are ethereum rpc endpoints
        - bundler: urls that are 4337 account abstraction bundler endpoints
        - ccip-read: url that are exclusively ENS CCIP-Read gateways
        - auxiliary: any other urls, or if determination couldn't be made
        - self: urls that are relative to the current domain, e.g. /path/to/resource
    - motivation: explain HOW the URL was identified (show code patterns like template literals, concatenation, etc.), specify source if dynamic/arbitrary (e.g., "from config.rpcUrl variable"), make sure to exclude api keys and other sensitive information

2. What dappspec fallback mechanisms are supported? Look for code that parses URL query parameters and uses them as endpoints.
    - type: one of:
        - rpc: provided through '?ds-rpc-<CHAIN_ID>=<url>' (Ethereum RPC endpoint override for specific chain)
        - bundler: provided through '?ds-bundler-<CHAIN_ID>=<url>' (4337 bundler endpoint override for specific chain)
        - dservice-external: provided through '?ds-<ens-name>=<url>' (External ENS name resolution endpoint override)
    - motivation: Show HOW the code parses the parameter (e.g., "new URLSearchParams(location.search).get('ds-rpc-1')") and HOW it's used (e.g., "passed to ethers.JsonRpcProvider constructor"). IMPORTANT: Only report if code demonstrates BOTH parsing AND usage of the parameter value.

3. Does the code access window.ethereum? Look for any way the code might access the ethereum property on the window object.
    - This includes: window.ethereum, window['ethereum'], const eth = window.ethereum, or any other access pattern
    - Return true if found, false otherwise

4. What dynamic resource loading is detected? Look for code that dynamically loads scripts, stylesheets, or other resources from external domains.
    - method: one of:
        - dynamic-import: dynamic import() calls (e.g., import('https://...'))
        - script-injection: programmatic script tag creation (e.g., document.createElement('script'))
        - link-injection: programmatic link tag creation (e.g., document.createElement('link'))
        - image-tracking: programmatic image creation for tracking (e.g., new Image())
        - iframe-injection: programmatic iframe creation (e.g., document.createElement('iframe'))
        - video-injection: programmatic video element creation
        - audio-injection: programmatic audio element creation
    - urls: URLs being loaded dynamically, use same rules as section 2 for URL formatting
    - type: classify as "script", "stylesheet", "media", or "other"
    - motivation: explain the code pattern detected (formatted as markdown)


Return ONLY valid JSON that conforms to this OpenAPI 3.0 schema:

{
  "openapi": "3.0.0",
  "info": {
    "title": "JavaScript Analysis Schema",
    "version": "1.0.0"
  },
  "components": {
    "schemas": {
      "AnalysisResult": {
        "type": "object",
        "required": ["networking", "windowEthereum"],
        "properties": {
          "windowEthereum": {
            "type": "boolean",
            "description": "Whether code accesses window.ethereum"
          },
          "networking": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["method", "urls", "type", "motivation"],
              "properties": {
                "method": {
                  "type": "string",
                  "description": "Method of network API call"
                },
                "httpMethod": {
                  "type": "string",
                  "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "UNKNOWN"],
                  "description": "HTTP method if determinable"
                },
                "urls": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "URLs being accessed by the API call"
                },
                "library": {
                  "type": "string",
                  "description": "Library that makes the network call"
                },
                "type": {
                  "type": "string",
                  "enum": ["rpc", "bundler", "auxiliary", "self"],
                  "description": "Classification of the URL"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why these URLs were identified"
                }
              }
            }
          },
          "fallbacks": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type", "motivation"],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": ["rpc", "bundler", "dservice-external"],
                  "description": "Type of dappspec fallback supported"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why this fallback is identified as supported"
                }
              }
            }
          },
          "dynamicResourceLoading": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["method", "urls", "type", "motivation"],
              "properties": {
                "method": {
                  "type": "string",
                  "enum": ["dynamic-import", "script-injection", "link-injection", "image-tracking", "iframe-injection", "video-injection", "audio-injection"],
                  "description": "Method used to load resource dynamically"
                },
                "urls": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "URLs being loaded dynamically"
                },
                "type": {
                  "type": "string",
                  "enum": ["script", "stylesheet", "media", "other"],
                  "description": "Type of resource being loaded"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for the code pattern detected"
                }
              }
            }
          }
        }
      }
    }
  }
}

Your response should be a JSON object that conforms to the AnalysisResult schema. If no API calls of a certain type are found, return an empty array for that type.
`
