
## FAQ

---

### How do I get my dapp listed?

Adding a new dapp to the list of reviewed dapps is currently a manual process. Feel free to open an issue on the [GitHub repository](https://github.com/stigmergic-org/dapprank).

---

### How is the risk of a dapp assessed?

The risk of a dapp is assessed based on the three main criteria: distribution purity, networking purity, and web3 api usage.

- **Distribution purity** is assessed based on how much of the dapp is distributed over IPFS. If media or scripts are loaded from external sources during page load this is considered as a violation.
- **Networking purity** is assessed based on how the dapp interacts with external APIs. If any external api appears in any of the dapps scripts this is considered as a violation.
- **Web3 api usage** is currently assessed based on if the dapp uses the *window.ethereum* or a local rpc endpoint.

---

### The risk assessment algorithm is wrong!

This might very well be the case. We happily accept suggestions for how it can be improved. Please open an issue or submit a pull request to the [GitHub repository](https://github.com/stigmergic-org/dapprank).
