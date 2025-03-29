## Best Practices

Below are some high level guidelines for building and deploying dapps. These are not exhaustive, but they should provide a decent starting point.

### Use IPFS

While ENS does support other protocols, we recommend using IPFS for your dapp. This is because it already has the most wide adoption, can easily be run locally, and has no token associated with it. Additionally, standardizing around one protocol makes it easier for the ecosystem to integrate and build tools around the dapp ecosystem.

### Avoid IPNS

While common IPFS implementations supports a protocol called IPNS, we strongly discourage its use. IPNS allows the content hash to change at any time at the whim of the key holder. There is no persistant log of the changes, unlike what you get if you publish a CID directly on chain.

### Building and deploying

There are three steps to building and deploying a dapp:

1. **Make a static build of your webapp.** A static web application is a web application that can be delivered directly to an end user's browser without any server-side alteration of the HTML, CSS, or JavaScript content.

2. **Deploy your static build to IPFS.** Assuming your build is in the `./dist` directory, you can deploy it to IPFS with the following command:
   ```
   $ ipfs add -r --cid-version=1 --pin=true ./dist
   ```

3. **Use the CID (IPFS hash) from step (2) to set the `contentHash` record on your ENS domain.** Remember that you need to format the `contentHash` string as `ipfs://cid`.

### Optimizing distribution purity

When any page of your app is loaded, you need to make sure that all resources (like scripts or media) are loaded from the same origin as the page, e.g., they are part of the `./dist` directory that you added to IPFS. Generally, you want to look out for anything inside of tags like `<script>`, `<link>`, `<img>`, `<iframe>`, `<source>`, etc.
