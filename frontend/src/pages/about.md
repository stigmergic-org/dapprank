## About

Dapp Rank was created to improve the state of censorship resistant applications in the Ethereum ecosystem. It provides users with a way to assess the risk of dapps at a glance. The risk assessment and scoring system also gives developers a way to see how they are doing and how they can improve the censorship resistance of their dapps.


### Why is this important?

Many builders compromise when building their applications, and understandably so. Building an app that can be fully distributed using the ENS + IPFS combo is a significant hurdle for many developers. This constraint puts limits on how fast you can move and how quickly you can grow your application, at least for now. So why build applications in this way? You do it out of care for your users.

People actually want tools that are resilient and that doesn't go away when the builder abandons the project. There is also the problem of censorship. There are multiple examples of applications disappearing or becoming unusable because the builder or an oppressive government decided to take it down.

We need to do better! We need to celebrate builders that go through the effort of serving their users fully. This is why Dapp Rank exists.


### How is the risk of a dapp assessed?

The methodology of how dapps are being evaluated is currently under development. The main discussion is taking place in the [Best Practices for Dapps (dappspec) thread @ Ethereum Magicians](https://ethereum-magicians.org/t/new-erc-best-practices-for-dapps-dappspec/24407).

The goal is to eventually evaluate dapps based on three main criterias: *control*, *integrity*, and *networking*. Also worth noting is that DappRank primarily considers the frontend code of the application. Smart contract logic is considered out of scope.


- **Integrity** is primarily assessed based on how much of the dapp is distributed over IPFS, but also other integirty checks. If media or scripts are loaded from external sources during page load this is considered as a violation.
- **Networking** is assessed based on how the dapp interacts with external APIs. If any external api appears in any of the dapps scripts this is considered as a violation if it doesn't talk to an Ethereum RPC, 4337 Bundler, or DService.
- **Control** is currently not implemented, but going to assess the resiliency of the process of updating the ENS contenthash, i.e. publishing a new version of the dapp.


### How can I help?

Build a dapp that is useful to others!


You can also help us improve by sharing your ideas or adding improvements. Feel free to open an issue or submitting a pull request to the [GitHub repository](https://github.com/stigmergic-org/dapprank).
