# qrlLocal network

`qrlLocal` is the in-process QRL VM network used by QRL Hardhat for fast local
tests, scripts, and contract development. It is the QRL replacement for the old
Ethereum in-memory network docs; it does not emulate `eth_*` JSON-RPC or the old
Buidler EVM.

Use `qrlLocal` when you want local execution without starting a go-qrl node. Use
an HTTP go-qrl network when you need to test node-managed accounts, private
network behavior, external RPC infrastructure, or raw transaction submission.

## Requirements

`qrlLocal` loads VM packages from a built `qrljs-monorepo` checkout. Build that
checkout first and expose its path to Hardhat:

~~~sh
cd /path/to/qrljs-monorepo
npm install
npm run build

cd /path/to/qrl-hardhat-project
export QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
npx hardhat test --network qrlLocal
~~~

You can also set the path in `hardhat.config.js` with
`networks.qrlLocal.qrlJsMonorepoPath`.

## Configuration

A typical `qrlLocal` config looks like this:

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
          nonce: 0,
        },
      ],
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1,
      blockGasLimit: 30000000,
      automine: true,
    },
  },
};
~~~

`type` must be `"qrl-local"`.

`chainId` defaults to `1`.

`qrlJsMonorepoPath` points at a built `qrljs-monorepo` checkout. If omitted,
Hardhat reads `QRLJS_MONOREPO_PATH`.

`accounts` is an array of local account objects. Each account needs a QRL
address. `balance` can be a decimal string, hex string, or safe non-negative
number. `nonce` is optional.

`from` sets the default sender for transactions on this network.

`blockGasLimit` defaults to `30000000`.

`automine` defaults to `true`.

`gas` and `gasPrice` can be fixed numbers or `"auto"`. The local provider
returns `0x0` for `qrl_gasPrice`.

## Running tests and scripts

Run tests against the in-process network:

~~~sh
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo \
npx hardhat test --network qrlLocal
~~~

Run a script:

~~~sh
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo \
npx hardhat run scripts/deploy.js --network qrlLocal
~~~

Inside tests and scripts, use the same runtime APIs as with HTTP networks:

~~~js
const [from] = await network.provider.send("qrl_accounts");
const chainId = await network.provider.send("qrl_chainId");
const balance = await network.provider.send("qrl_getBalance", [from, "latest"]);
~~~

Contract helpers use `hre.qrl`:

~~~js
const Sample = await qrl.getContractFactory("Sample");
const sample = await Sample.deploy();
console.log(sample.address);
~~~

`deploy()` returns a ready-to-use contract wrapper. On `qrlLocal`, the sender
defaults to the network's `from` config field.

## Contract console logging

`qrlLocal` can print debug logs emitted from Hyperion contracts through
`@theqrl/hardhat/console.hyp`:

~~~solidity
import "@theqrl/hardhat/console.hyp";

contract Sample {
    function store(uint256 value) public {
        console.log("value", value);
    }
}
~~~

Logs are enabled by default on `qrlLocal`. Disable them with
`networks.qrlLocal.consoleLog: false`. HTTP go-qrl networks accept the same
config field for shared config compatibility, but they do not print contract
console logs.

See [Contract console logging](../guides/console-log.md) for supported
signatures, formatting, and limitations.

## Supported local RPC behavior

`qrlLocal` supports the QRL JSON-RPC methods implemented by the underlying local
VM provider. Hardhat handles these methods directly:

- `qrl_chainId`
- `qrl_accounts`
- `qrl_requestAccounts`
- `qrl_gasPrice`

The local provider also supports local test helpers such as:

- `qrl_snapshot`
- `qrl_revert`
- `qrl_mine`

For example:

~~~js
const snapshot = await network.provider.send("qrl_snapshot");
await network.provider.send("qrl_mine");
await network.provider.send("qrl_revert", [snapshot]);
~~~

## Differences from HTTP go-qrl networks

`qrlLocal` does not connect to a go-qrl node and does not use node-managed
accounts. Accounts are configured in `hardhat.config.js`.

HTTP networks can use locally signed QRL extended seeds or `accounts: "remote"`.
`qrlLocal` uses configured local account objects instead.

`qrlLocal` rejects `eth_*` RPC methods. Use `qrl_*` methods only.

`qrlLocal` rejects `qrl_sendRawTransaction`. Use `qrl_sendTransaction` through
Hardhat's normal contract helpers or provider calls. Raw QRL transaction
submission belongs to HTTP go-qrl networks.

Chain id validation is applied to HTTP networks with configured `chainId`.
`qrlLocal` exposes its configured chain id directly from the in-process provider.

## Common errors

If the VM packages cannot be loaded, Hardhat throws `BDLR123`:

~~~text
Cannot load local qrljs-monorepo from <path>: <message>.
Build qrljs-monorepo first or set networks.<network>.qrlJsMonorepoPath / QRLJS_MONOREPO_PATH.
~~~

Fix it by building `qrljs-monorepo` and setting the correct path.

If a config includes `url` under a `qrl-local` network, config validation fails.
`qrlLocal` is not an HTTP network.

If a local account address is malformed, config validation fails. Use native QRL
addresses, not Ethereum-style `0x` addresses.

If deployment fails because the sender is not managed, set `from` to one of the
addresses in `networks.qrlLocal.accounts` or pass `{ from }` explicitly.

## When to use HTTP instead

Use an HTTP go-qrl network instead of `qrlLocal` when you need to validate:

- private-network ports and connectivity,
- node-managed accounts,
- local signing with `QRL_ACCOUNT_SEED`,
- raw transaction submission,
- behavior that depends on the actual go-qrl node.
