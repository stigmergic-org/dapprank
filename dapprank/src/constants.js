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

export const ANALYSIS_VERSION = 2

// Create a stable hash for the system prompt to make sure it's consistent across runs
export const SYSTEM_PROMPT_TEMPLATE = `
Analyze the provided JavaScript code and answer the following questions thouroughly.

1. What top level javascript libraries are being used?
    - name: explicity name or descriptive title of the library
    - motivation: say why you concluded the code uses this library (formatted as markdown)
2. What calls are there to networking libraries, and what url is being passed? (if one of the methods is detected, there MUST be a corresponding entry in the networking section)
    - method: look only for fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket, WebSocketStream, EventSource, RTCPeerConnection
    - urls: best guess at what url is being passed to the function call (if multiple, return all), don't list urls that are not part of the codebase at all, don't include api keys. Don't include if url is only 'window.ethereum' or query param '?ds-rpc-<CHAIN_ID>'.
    - library: best guess if this call originates from one of the libraries from (1), or otherwise
    - type: one of:
        - rpc: urls that are ethereum rpc endpoints.
        - bundler: urls that are 4337 account abstraction bundler endpoints
        - auxiliary: any other urls, or if determination couldn't be made
        - self: urls that are relative to the current domain, e.g. /path/to/resource
    - motivation: say why you concluded the given url, the library being used, and/or how data is passed to the call (formatted as markdown), make sure to exclude api keys and other sensitive information
3. What dappspec fallback is supported? These are query parameters that can be used to specify backup url endpoints for common services.
    - type: one of:
        - rpc: provided through '?ds-rpc-<CHAIN_ID>=url'
        - bundler: provided through '?ds-bundler-<CHAIN_ID>=url'
        - dservice-self: provided through '?dservice=url'
        - dservice-external: provided through '?ds-<ens-name>=url'
    - motivation: say why you concluded that the script supports parsing and using these query parameters (formatted as markdown)


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
        "required": ["libraries", "networking"],
        "properties": {
          "libraries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "motivation"],
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Name or descriptive title of the library"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why this library was identified"
                }
              }
            }
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
                  "enum": ["rpc", "bundler", "dservice-self", "dservice-external"],
                  "description": "Type of dappspec fallback supported"
                },
                "motivation": {
                  "type": "string",
                  "description": "Explanation for why this fallback is identified as supported"
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
