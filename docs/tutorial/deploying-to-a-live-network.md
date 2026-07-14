# 7. Deploying to a live network

Once you are ready to share your contract with other people, you can deploy it
to a running QRL network. This can be a private development network, a shared
test network, or another go-qrl network with HTTP JSON-RPC enabled.

At the software level, deploying to qrlLocal and deploying to an HTTP network
use the same `hre.qrl` helpers. The main difference is which network you connect
to and how the deployer account signs transactions.

Let's create a new directory called `scripts` inside the project root directory
and paste the following into `scripts/deploy.js`:

```js
async function main() {
  const [deployer] = await network.provider.send("qrl_accounts");

  console.log("Deploying contracts with the account:", deployer);

  const Token = await qrl.getContractFactory("Token");
  const token = await Token.deploy({ from: deployer }, [], {
    timeoutMs: 300000,
  });

  console.log("Deployment transaction:", token.deployTransactionHash);
  console.log("Token address:", token.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

To tell QRL Hardhat to connect to a specific network when running a task, use
the `--network` parameter:

```sh
npx hardhat run scripts/deploy.js --network <network-name>
```

Running against qrlLocal is useful for checking that the deployment code works:

```sh
npx hardhat run scripts/deploy.js --network qrlLocal
```

The deployment exists only in the in-process qrlLocal network used for that run.

## Deploying to remote networks

To deploy to a remote go-qrl network, add an HTTP network entry to
`hardhat.config.js`:

```js
const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

module.exports = {
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1,
    },
  },
};
```

`QRL_RPC_URL` should point at a running go-qrl HTTP JSON-RPC endpoint.
`QRL_ACCOUNT_SEED` should contain a `0x`-prefixed 51-byte QRL extended seed for
local signing.

::: warning
Do not commit real seeds. Use environment variables or local secret management.
:::

Before deploying, verify the endpoint:

```sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
```

Finally, run:

```sh
QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
```

If the node manages unlocked accounts itself, configure `accounts: "remote"`
instead of passing local seeds:

```js
module.exports = {
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL,
      accounts: "remote",
    },
  },
};
```

If everything went well, you should see the deployment transaction hash and the
deployed QRL contract address.

