## DappSpec

DappSpec is an effort that aims to standardize design choices for decentralized applications (dapps), in order to enhance censorship resistance across the ecosystem. At the core of this specification is the `dappspec.json` manifest file, which provides essential information about the dapp's dependencies, services, and fallback mechanisms.

### Motivation

The decentralized web aims to provide applications that are resilient against censorship and single points of failure. However, many "decentralized" applications still depend on centralized infrastructure, creating vulnerabilities. DappSpec addresses this by:

1. Making dependency information explicit and machine-readable
2. Providing redundancy options for critical services
3. Enabling alternative frontends to locate and use required services
4. Standardizing how dapps interact with blockchain infrastructure

By following this specification, dapp developers create applications that are more resilient, and users gain access to tools that can help bypass potential censorship.

### Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119 and RFC 8174.

#### DappSpec Version
`0.1.0`

#### Manifest Location

The DappSpec manifest MUST be stored at `/.well-known/dappspec.json` within the dapp's content root.

#### Naming Requirements

Dapps conforming to this specification MUST use an ENS domain as their primary identifier. The [contenthash](https://docs.ens.domains/ensip/7) of the given ENS domain SHOULD be set to an IPFS CID (content identifier).

#### Manifest Schema

```typescript
interface Manifest {
  dappspec: string;
  repository: string;
  preserveHistory: number;
  dservices: {
    self: string[];
    serviceWorker: boolean;
    external: string[];
  };
  chains: {
    [chainId: string]: {
      rpcs: string[];
      bundlers: string[];
      contracts: string[];
    }
  }
  fallbacks: {
    window: boolean;
    rpcs: boolean;
    bundlers: boolean; 
    dservice: boolean;
  };
  auxiliary: string[];
}
```

The manifest fields are defined as follows:
- `dappspec`: The version of the DappSpec specification being used.
- `repository`: URL of the source code repository for the dapp, typically a git repository.
- `preserveHistory`: Indicates how many historical versions pinning services should maintain. A value of -1 means all history should be preserved.
- `dservices`: Information about the dapp's own decentralized backend service.
  - `self`: List of URLs for the backend service implemented by this dapp.
  - `serviceWorker`: Indicates if the app can act as a proxy to the dservice endpoints using a service worker.
  - `external`: List of ENS names for external decentralized services the dapp depends on.
- `chains`: Blockchain configuration organized by chain ID.
  - `rpcs`: List of RPC URLs the dapp uses for each chain.
  - `bundlers`: List of EIP-4337 bundler URLs the dapp uses.
  - `contracts`: List of contract addresses the dapp interacts with.
- `fallbacks`: Configuration for various fallback mechanisms.
  - `window`: Indicates if window.ethereum injection is used.
  - `rpcs`: Indicates if custom RPC endpoints are supported via query parameters.
  - `bundlers`: Indicates if custom bundler endpoints are supported via query parameters.
  - `dservice`: Indicates if custom dservice URLs are supported via query parameters.
- `auxiliary`: List of URLs for non-critical services such as analytics.

### DServices

#### What is a DService?

A DService (Decentralized Service) is a backend service that provides data to dapps in a decentralized manner. Unlike traditional backends, DServices:

1. MUST only rely on indexed data from blockchains (Ethereum L1/L2s) or content-addressed data
2. MUST be deterministic - all DService nodes given the same input should produce the same state
3. MUST be open source so that anyone can run their own instance
4. Dapps SHOULD provide multiple endpoints for redundancy

#### Building a DService

To build a compliant DService:

1. Design your service to only consume data from blockchains or content-addressed sources (IPFS, etc.)
2. Ensure deterministic processing of data - any node running your code should arrive at the same state
3. Document the deployment process clearly so others can run the service
4. Publish the source code under an open-source license
5. Deploy multiple instances on different infrastructure for redundancy

#### Service Worker Proxy

The `serviceWorker` field in the manifest indicates whether the dapp implements a service worker that can proxy requests to DService endpoints. When set to `true`, this feature provides several benefits:

1. **Easily accessible**: Other dapps can simply send request directly to a .eth name (i.e. through a mirror), e.g. `mydapp.eth.link` or `mydapp.eth.sucks`

2. **Enhanced Privacy**: The service worker can mask direct connections to backend services, potentially improving user privacy.

3. **Offline Capabilities**: With a properly implemented service worker, the dapp may continue to function when temporarily offline, serving cached data.

4. **Fallback Routing**: The service worker can automatically route requests to alternative endpoints if primary endpoints are unavailable.

5. **Request Normalization**: Service workers can standardize requests to ensure compatibility with different backend implementations.

Implementing a DService proxy via service worker:

1. Register a service worker in your dapp that intercepts fetch requests to your DService endpoints.
2. Implement logic to try multiple endpoints in sequence if the primary endpoint fails.
3. Include appropriate caching strategies based on the nature of the data.
4. Consider implementing retry logic with exponential backoff for failed requests.

Example service worker implementation pattern:

```javascript
self.addEventListener('fetch', event => {
  // Only handle requests to dservice endpoints
  if (isDServiceRequest(event.request.url)) {
    event.respondWith(
      fetchFromDService(event.request)
        .catch(error => {
          console.error('Primary endpoint failed:', error);
          return fetchFromFallbackDService(event.request);
        })
    );
  }
});
```

### RPC, Bundler, and Contract Addresses

The `chains` section of the manifest serves several crucial purposes:

- **RPC Endpoints**: Listing multiple RPC endpoints provides redundancy if some endpoints become unavailable or are censored. While not required, multiple endpoints are strongly RECOMMENDED.
- **Bundler URLs**: For Account Abstraction (EIP-4337) compatibility, listing bundler endpoints that the dapp uses helps ensure transaction submission can continue even if some bundlers are unavailable.
- **Contract Addresses**: Explicitly listing contract addresses the dapp interacts with allows:
  - Alternative frontends to properly interact with the same contracts
  - Users to verify they're interacting with the expected contracts
  - Monitoring tools to track contract interactions

### Fallback Mechanisms

#### Window.ethereum Fallback

The `fallbacks.window` flag indicates whether the dapp uses the injected `window.ethereum` provider from browser wallets. When set to `true`, it signals that:

- The dapp can function with user-provided wallet connections
- Alternative browsers should implement compatibility with this pattern
- The dapp may fall back to this connection method if RPC endpoints are unavailable

#### Query Parameter Fallbacks

When `fallbacks.rpcs` or `fallbacks.dservice` are set to `true`, the dapp supports overriding default endpoints via URL query parameters. All URL values must be URL-encoded:

- **RPC Overrides**: Using `?ds-rpc-<CHAIN_ID>=url` (e.g., `?ds-rpc-1=https%3A%2F%2Fmainnet.infura.io%2Fv3%2FYOUR-API-KEY`)
- **Bundler Overrides**: Using `?ds-bundler-<CHAIN_ID>=url` (e.g., `?ds-bundler-1=https%3A%2F%2Fbundler.example.com`)
- **DService Overrides**: 
  - Main service: `?ds-self=url` (URL-encoded value)
  - External services: `?ds-<ens-name>=url` (URL-encoded value)

These parameters allow users to specify alternative endpoints when the default ones are inaccessible, enhancing censorship resistance. When a user provides any of these query parameters, the given value SHOULD be prioritized over the apps existing options.

### Auxiliary Services

The `auxiliary` array lists URLs for non-essential services that the dapp uses but aren't critical to its core functionality:

- Analytics platforms
- Monitoring services
- Feature flagging services
- Non-critical API integrations

Listing these services:
- Helps users understand what third-party services the dapp connects to
- Enables privacy-focused browsers to block these connections
- Distinguishes between essential and non-essential external dependencies

### Rationale

This specification is designed to highlight design choices necessary to build truely resilient applications. By requiring you to list ethereum rpc, bundler, and auxiliary endpoints it forces you to consider where centralization chokepoints are located within your application. Further, documenting fallback options highlights steps you can take to further add resilience in case all the default endpoints are not available. 

The introduction of the *dservice* concept is an acknoledgement that most applications need to rely on some sort of indexer to access blockchain data. The ethereum rpc api is simply not sophisticated enough for advanced query functionality. However, dservices takes this a step further by introducing redundancy by allowing multiple endpoints and allowing the user to pass their own endpoint through a query parameter. Additionally dservices can become a canonical way dapps can expose backend apis. By allowing dapps to define other ENS names as *externalDservices*, infrastructure can be shared across multiple dapps. For example, `dappA.eth` can expose a dservice with three backing endpoints, `dappB.eth` can now consume the dservice of Dapp A by resovling `dappA.eth/.well-known/dappspec.json` and using the resolved urls to make requests. Dapps could even implement payment or subscription services where they charge other dapps to consume the default endpoints.


### Recommendations

Below are guidelines for building and deploying dapps:

#### Use IPFS

While ENS supports other protocols, IPFS is RECOMMENDED because:
- It has wide adoption
- Can be run locally
- Has no token dependencies
- Standardizing on one protocol simplifies ecosystem tooling

#### Avoid IPNS

IPNS is NOT RECOMMENDED because:
- Content can change at any time at the key holder's discretion
- There is no persistent log of changes, unlike publishing CIDs directly on-chain
- There is no simple way to create stronger governance mechanism around updating the CID

#### Building and Deploying

1. **Make a static build of your webapp.** A static web application can be delivered directly to the browser without server-side alterations.

2. **Deploy your static build to IPFS.** Assuming your build is in the `./dist` directory:
   ```
   $ ipfs add -r --cid-version=1 --pin=true ./dist
   ```

3. **Set the `contenthash` record on your ENS domain using the CID from step 2.** Format the `contenthash` as `ipfs://cid`.

#### Optimizing Distribution Purity

Ensure all resources (scripts, media, etc.) are loaded from the same origin as the page. Check for external references in tags like `<script>`, `<link>`, `<img>`, `<iframe>`, `<source>`, etc.

By following these guidelines and implementing the DappSpec manifest, you contribute to a more resilient and censorship-resistant decentralized web ecosystem. 