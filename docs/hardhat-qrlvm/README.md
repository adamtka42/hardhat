# hardhatqrlvm network

`hardhatqrlvm` is the in-process QRL VM network used by QRL Hardhat for fast local
tests, scripts, and contract development. It is the QRL replacement for the old
Ethereum in-memory network docs; it does not emulate `eth_*` JSON-RPC or the old
Buidler EVM.

Use `hardhatqrlvm` when you want local execution without starting a go-qrl node. Use
an HTTP go-qrl network when you need to test node-managed accounts, private
network behavior, external RPC infrastructure, or raw transaction submission.

## Requirements

Installed `@theqrl/hardhat` packages ship the QRL VM runtime bundled inside
the artifact, so `hardhatqrlvm` works out of the box — no extra repositories or
environment variables:

~~~sh
npx hardhat test --network hardhatqrlvm
~~~

For qrljs or Hardhat development you can override the bundled runtime with a
locally built `qrljs-monorepo` checkout:

~~~sh
cd /path/to/qrljs-monorepo
npm install
npm run build

cd /path/to/qrl-hardhat-project
export QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
npx hardhat test --network hardhatqrlvm
~~~

A set override is authoritative: when the checkout is missing or unbuilt the
error surfaces instead of silently falling back to the bundle. The path can
also be set in `hardhat.config.js` with `networks.hardhatqrlvm.qrlJsMonorepoPath`.

## Configuration

A typical `hardhatqrlvm` config looks like this:

~~~js
const localAccountAddress = "Q" + "01".repeat(64);

module.exports = {
  defaultNetwork: "hardhatqrlvm",
  networks: {
    hardhatqrlvm: {
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

The in-process provider is selected by the reserved network name `hardhatqrlvm`.

`chainId` defaults to `1`.

`qrlJsMonorepoPath` optionally points at a built `qrljs-monorepo` checkout to
override the bundled runtime (a development feature). If omitted, Hardhat
reads `QRLJS_MONOREPO_PATH`; when neither is set, the runtime bundled with
the package is used.

`accounts` is an array of local account objects. Each account needs a QRL
address. `balance` can be a decimal string, hex string, or safe non-negative
number. `nonce` is optional.

`from` sets the default sender for transactions on this network.

`blockGasLimit` defaults to `30000000`.

`automine` defaults to `true`.

`gas` and `gasPrice` can be fixed numbers or `"auto"`. The local provider
returns `0x0` for `qrl_gasPrice`.

## Running tests and scripts

To expose the local network to external clients (frontends, wallets, other
processes), run it as a standalone endpoint with
[`hardhat node`](../guides/node.md).

Run tests against the in-process network:

~~~sh
npx hardhat test --network hardhatqrlvm
~~~

Run a script:

~~~sh
npx hardhat run scripts/deploy.js --network hardhatqrlvm
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

`deploy()` returns a ready-to-use contract wrapper. On `hardhatqrlvm`, the sender
defaults to the network's `from` config field.

## Contract console logging

`hardhatqrlvm` can print debug logs emitted from Hyperion contracts through
`@theqrl/hardhat/console.hyp`:

~~~solidity
import "@theqrl/hardhat/console.hyp";

contract Sample {
    function store(uint256 value) public {
        console.log("value", value);
    }
}
~~~

Logs are enabled by default on `hardhatqrlvm`. Disable them with
`networks.hardhatqrlvm.consoleLog: false`. HTTP go-qrl networks accept the same
config field for shared config compatibility, but they do not print contract
console logs.

See [Contract console logging](../guides/console-log.md) for supported
signatures, formatting, and limitations.

## Supported local RPC behavior

`hardhatqrlvm` supports the QRL JSON-RPC methods implemented by the underlying local
VM provider. Hardhat handles these methods directly:

- `qrl_chainId`
- `qrl_accounts`
- `qrl_requestAccounts`
- `qrl_gasPrice`
- `qrl_sendRawTransaction`
- `qrl_sign` (for accounts configured with a seed)
- `qrl_pendingTransactions`
- `qrl_newFilter`, `qrl_newBlockFilter`,
  `qrl_newPendingTransactionFilter`
- `qrl_getFilterChanges`, `qrl_getFilterLogs`, `qrl_uninstallFilter`
  (polling filters expire after five minutes of inactivity, as in go-qrl)
- `qrl_subscribe`, `qrl_unsubscribe` (push notifications; served to
  WebSocket clients by `hardhat node`)

The provider mirrors the go-qrl node's compatibility surface, so tooling that
probes the connection on startup works against `hardhatqrlvm` too:

- `net_version`, `net_listening`, `net_peerCount`
- `web3_clientVersion`, `web3_sha3` (keccak-256, like go-qrl)
- `qrl_coinbase`, `qrl_mining`, `qrl_syncing`
- `qrl_getBlockTransactionCountByNumber` / `...ByHash`
- `qrl_getTransactionByBlockNumberAndIndex` / `...ByBlockHashAndIndex`
- `debug_traceCall`, `debug_traceTransaction` (go-qrl-shaped `structLogs`;
  see the [stack traces guide](../guides/stack-traces.md))

The local provider also supports local test helpers such as:

- `qrl_snapshot`
- `qrl_revert`
- `qrl_mine`
- `qrl_increaseTime`
- `qrl_setNextBlockTimestamp`

For example:

~~~js
const snapshot = await network.provider.send("qrl_snapshot");
await network.provider.send("qrl_mine");
await network.provider.send("qrl_revert", [snapshot]);
~~~

## Time manipulation

Block timestamps on `hardhatqrlvm` are deterministic: the genesis block starts at
`0` (or at the configured `initialDate`) and every mined block gets
`parent + 1` second. Time-dependent contracts (vesting, timelocks, deadlines)
are tested with the time helpers:

~~~js
// Shift the next block (and, through parent chaining, all later blocks)
// forward by one hour. Returns the cumulative total of all increases as a
// decimal string.
const total = await network.provider.send("qrl_increaseTime", [3600]);

// One-shot absolute timestamp for the next mined block. Must be greater
// than the latest block timestamp.
await network.provider.send("qrl_setNextBlockTimestamp", [1767225600]);

// Explicit qrl_mine timestamps take precedence over both helpers.
await network.provider.send("qrl_mine", [{ timestamp: 1767230000 }]);
~~~

To start the chain clock at a real date, set `initialDate` (ISO 8601) on the
network config:

~~~js
hardhatqrlvm: {
  qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
  initialDate: "2026-01-01T00:00:00Z",
},
~~~

Note that unlike the original Hardhat, `qrl_increaseTime` is not coupled to
the wall clock: the shift is applied to the next mined block on top of the
deterministic `parent + 1` sequence, which keeps test runs reproducible.
`qrl_snapshot`/`qrl_revert` also restore pending time state.

With `automine: false`, the timestamp of the block under assembly is FROZEN
the moment its first transaction executes (so the mined header always
matches what the contracts observed). Time manipulation performed after that
point applies to the FOLLOWING block, is validated against the frozen
timestamp, and explicit `qrl_mine` options are rejected while transactions
are pending.

## Transaction failures

By default `hardhatqrlvm` throws when a transaction or call reverts, matching the
original Hardhat in-memory network:

- `qrl_call` throws a provider error with the raw revert payload in
  `error.data`.
- `qrl_sendTransaction` (with automine) throws too. The transaction IS still
  mined: the error carries `error.transactionHash`, so the status-`0x0`
  receipt stays queryable.
- When the revert payload is a standard `Error(string)` or `Panic(uint256)`,
  the decoded reason is appended to the error message, e.g.
  `QRL execution reverted (reason: 'locked', tx: 0x…)`. Custom errors stay
  decodable from `error.data`.
- A Hyperion stack trace (`at Contract.function (file:line)` per frame) is
  appended below the message; see the
  [stack traces guide](../guides/stack-traces.md).
- With `automine: false` nothing throws; the failure is only visible in the
  receipt after `qrl_mine`.
- Gas estimation of a reverting transaction fails before anything is sent;
  pass an explicit `gas` value to submit a transaction you expect to revert.

Both behaviors can be disabled per network:

~~~js
hardhatqrlvm: {
  qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
  throwOnTransactionFailures: false,
  throwOnCallFailures: false,
},
~~~

With the flags off, `qrl_sendTransaction` silently returns the hash of a
status-`0x0` transaction and `qrl_call` returns the raw revert data.

## Differences from HTTP go-qrl networks

`hardhatqrlvm` does not connect to a go-qrl node and does not use node-managed
accounts. Accounts are configured in `hardhat.config.js`.

HTTP networks can use locally signed QRL extended seeds or `accounts: "remote"`.
`hardhatqrlvm` uses configured local account objects instead. A local account can
optionally include a seed to enable `qrl_sign`; the seed must derive the
configured address.

`hardhatqrlvm` rejects `eth_*` RPC methods. Use `qrl_*` methods only.

`hardhatqrlvm` accepts signed QRL transactions through `qrl_sendRawTransaction`.
It verifies the ML-DSA signature and public key, then validates the local chain
id and current account nonce before execution.

Chain id validation is applied to HTTP networks with configured `chainId`.
`hardhatqrlvm` exposes its configured chain id directly from the in-process provider.

## Common errors

If the QRL runtime cannot be loaded, Hardhat throws `BDLR123`. With installed
packages this normally means the development override (`QRLJS_MONOREPO_PATH`
/ `qrlJsMonorepoPath`) points at a missing or unbuilt checkout — a set
override never falls back to the bundled runtime. Unset the override or build
the checkout it points to (see Requirements above).

If a config includes `url` under a `hardhatqrlvm` network, config validation fails.
`hardhatqrlvm` is not an HTTP network.

If a local account address is malformed, config validation fails. Use native QRL
addresses, not Ethereum-style `0x` addresses.

If deployment fails because the sender is not managed, set `from` to one of the
addresses in `networks.hardhatqrlvm.accounts` or pass `{ from }` explicitly.

## When to use HTTP instead

Use an HTTP go-qrl network instead of `hardhatqrlvm` when you need to validate:

- private-network ports and connectivity,
- node-managed accounts,
- remote-node account management and signing behavior,
- consensus and transaction-pool behavior of the actual node,
- behavior that depends on the actual go-qrl node.
