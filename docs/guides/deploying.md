# Deploying contracts

Deployment in QRL Hardhat is done with scripts and the `hre.qrl` runtime helpers.
The same deployment script can target `qrlLocal` for fast local checks or an HTTP
go-qrl network for private/devnet deployments.

This guide focuses on the operational deployment flow: choosing the network,
providing accounts, waiting for receipts, and debugging common deployment
failures.

## Basic deployment script

Create `scripts/deploy.js`:

~~~js
async function main() {
  const Sample = await qrl.getContractFactory("Sample");
  const sample = await Sample.deploy();

  console.log("Deployment transaction:", sample.deployTransactionHash);
  console.log("Contract address:", sample.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

`Sample.deploy` sends a `qrl_sendTransaction`, waits for
`qrl_getTransactionReceipt`, checks the receipt status, and returns a
ready-to-use contract wrapper. The deployed address and deployment metadata
are available as `sample.address`, `sample.deployTransactionHash`, and
`sample.deployReceipt`. The sender defaults to the network's `from` config or
the first `qrl_accounts` account.

For constructors with arguments, pass transaction overrides first and the
constructor arguments second:

~~~js
const token = await Token.deploy(
  { gas: 15000000 },
  ["Example Token", "EXT", 18],
  { timeoutMs: 300000 }
);
~~~

## Deploying contracts with external libraries

A Hyperion `library` with `external` functions is deployed once and shared by
its consumers through `delegatecall`. The compiler leaves a placeholder in the
consumer's bytecode, and the artifact records it under `linkReferences`.
Deploy the library first and pass its address through the `libraries` option:

~~~js
const MathLib = await qrl.getContractFactory("MathLib");
const mathLib = await MathLib.deploy();

const UsesMathLib = await qrl.getContractFactory("UsesMathLib", {
  libraries: { MathLib: mathLib.address },
});
const usesMathLib = await UsesMathLib.deploy();
~~~

The factory holds the linked bytecode, so every `deploy` call reuses it. The
low-level helper accepts the same option:

~~~js
await qrl.deployContract("UsesMathLib", {}, [], {
  libraries: { MathLib: mathLib.address },
});
~~~

Library names are accepted in bare form (`MathLib`) and fully qualified form
(`contracts/MathLib.hyp:MathLib`). Use the fully qualified form when two
libraries share a bare name. Deploying bytecode with unresolved placeholders
fails with `HH125: Unresolved library references`, naming the missing
libraries.

Libraries with only `internal` functions (like the bundled `console.hyp`) are
inlined by the compiler and need no linking.

## Deploying to qrlLocal

`qrlLocal` is the in-process QRL VM network. It is the fastest target for local
smoke tests and development deployments.

Example config:

~~~js
const localAccountAddress = "Q" + "01".repeat(64);

module.exports = {
  defaultNetwork: "qrlLocal",
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [
        {
          address: localAccountAddress,
          balance: "1000000000000000000000000",
        },
      ],
      blockGasLimit: 30000000,
    },
  },
};
~~~

Build `qrljs-monorepo`, set `QRLJS_MONOREPO_PATH`, then run:

~~~sh
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo \
npx hardhat run scripts/deploy.js --network qrlLocal
~~~

If `qrlLocal` cannot load the VM packages, build `qrljs-monorepo` first and make
sure `QRLJS_MONOREPO_PATH` or `networks.qrlLocal.qrlJsMonorepoPath` points at the
checkout.

## Deploying to an HTTP go-qrl network

HTTP networks point at a running go-qrl JSON-RPC endpoint.

Example config:

~~~js
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
~~~

Run the deployment with a live endpoint and a deployer seed:

~~~sh
QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
~~~

The seed must be a `0x`-prefixed 51-byte QRL extended seed. Do not commit real
seeds. Use environment variables or local secret management.

If the node manages unlocked accounts itself, configure `accounts: "remote"`
instead of local seeds:

~~~js
module.exports = {
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL,
      accounts: "remote",
    },
  },
};
~~~

## Private devnets and dynamic ports

Private networks launched through Docker or Kurtosis often expose a different
host port after every restart. Do not commit a machine-specific private network
port into `hardhat.config.js`. Prefer `QRL_RPC_URL`:

~~~sh
QRL_RPC_URL=http://localhost:<current-port> \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
~~~

To verify the endpoint before deploying, call `qrl_chainId`:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

A successful response confirms that the RPC endpoint is reachable. It does not
confirm that the deployer account has funds.

## Choosing the deployer

Deployment needs a `from` account that can sign and pay for the transaction.
There are three common cases:

- `qrlLocal`: use one of `networks.qrlLocal.accounts`.
- HTTP with local signing: set `QRL_ACCOUNT_SEED` and use the derived account.
- HTTP with node signing: set `accounts: "remote"` and use an unlocked node
  account.

`factory.deploy()` resolves the sender in this order: the explicit `from` in
the transaction overrides, the network's `from` config field, and finally the
first account returned by `qrl_accounts`. When none is available, deployment
fails with `BDLR124`.

To inspect the accounts a network exposes:

~~~js
const [from] = await network.provider.send("qrl_accounts");
~~~

If this returns no accounts, the network cannot deploy. Configure a local seed,
remote accounts, or qrlLocal accounts.

If you pass a custom `from`, make sure it is managed by Hardhat or the connected
node:

~~~js
const sample = await Sample.deploy({ from: process.env.DEPLOYER });
~~~

An unmanaged `from` account causes `BDLR104`.

## Gas and fees

For most deployments, leave `gas` as `"auto"` in the network config. QRL Hardhat
will call `qrl_estimateGas` and normalize numeric transaction quantities for
QRL JSON-RPC.

If the private network has a strict block gas limit, pass a gas value below that
limit:

~~~js
const sample = await Sample.deploy(
  { gas: 15000000 },
  [],
  { timeoutMs: 300000 }
);
~~~

Transaction quantity fields can be numbers, hex strings, or decimal strings.
QRL Hardhat normalizes fields such as `gas`, `gasLimit`, `gasPrice`, `value`,
`nonce`, `chainId`, `maxFeePerGas`, and `maxPriorityFeePerGas` before sending
RPC requests.

## Waiting for deployment

`deploy` waits for a receipt by default. Private networks can be slow, so use a
larger timeout:

~~~js
const sample = await Sample.deploy({}, [], {
  timeoutMs: 300000,
  pollIntervalMs: 1000,
});
~~~

For lower-level transactions, wait explicitly:

~~~js
const txHash = await qrl.sendTransaction({ from, data });
const receipt = await qrl.waitForTransaction(txHash, 300000, 1000);
~~~

If a receipt has a failed status, QRL Hardhat reports deployment failure instead
of returning a contract address.

## Verifying a deployment

`deploy` already returns a usable contract wrapper, so call a read-only
function on it directly:

~~~js
const value = await sample.retrieve();
console.log(value.toString(10));
~~~

To verify a contract deployed earlier, attach to its address instead:

~~~js
const sample = await qrl.getContractAt("Sample", address);
~~~

The mined deployment receipt is available as `sample.deployReceipt`. You can
also fetch it again over RPC:

~~~js
const receipt = await network.provider.send("qrl_getTransactionReceipt", [
  sample.deployTransactionHash,
]);
console.log(receipt.contractAddress);
~~~

## Common deployment failures

### BDLR109: Cannot connect to the network

The configured `url` is not reachable. Check that the node is running and that
`QRL_RPC_URL` points at the current port:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

If the endpoint is a Docker/Kurtosis private network, re-check the exposed host
port after every restart.

### BDLR104: account is not managed

The transaction `from` account is not available to Hardhat or the connected
node. Use one of `qrl_accounts`, set `QRL_ACCOUNT_SEED`, configure
`accounts: "remote"`, or add the account to `qrlLocal.accounts`.

### No accounts are returned

HTTP deployments need either local seeds or node-managed accounts. Set
`QRL_ACCOUNT_SEED` for local signing, or configure `accounts: "remote"` with a
node that has unlocked accounts.

### HH125: Unresolved library references

The contract uses an external library and no address was provided for it.
Deploy the library first and pass its address through the `libraries` option;
see "Deploying contracts with external libraries" above.

### Connected to the wrong network

If the config sets `chainId`, QRL Hardhat validates it against `qrl_chainId`.
Update the config or connect to the intended network.

### Transaction timeout

The transaction was sent but no receipt was observed before the timeout. Increase
`timeoutMs`, check block production, and confirm that the node is synced and
mining/validating.

### Missing contract address

A deployment receipt without `contractAddress` means the transaction did not
produce a deployable contract address. Check the receipt status and the compiled
artifact bytecode.

### Contract artifact not found

Run `npx hardhat compile` and make sure the contract name is correct. If more
than one source file defines the same contract name, use a fully qualified name:

~~~js
const Factory = await qrl.getContractFactory("contracts/Sample.hyp:Sample");
~~~

## Next steps

After deployment, store the address outside source control if it is environment
specific, or commit it only if it is meant to be a shared deployment address for
a known network.

For broader script patterns, see [scripts.md](scripts.md). For runtime helper
details, see [../advanced/hardhat-runtime-environment.md](../advanced/hardhat-runtime-environment.md).
