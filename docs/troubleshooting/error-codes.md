# Error codes

QRL Hardhat errors use the `BDLR` prefix followed by a numeric code. This page
documents the error codes most likely to appear in QRL projects and the normal
fixes for each one.

For broader troubleshooting examples, see [Common problems](common-problems.md).

## Project and config

### BDLR1: You are not inside a Hardhat project

QRL Hardhat could not find a `hardhat.config.js` file in the current directory
or its parents.

Fix:

- run the command from your project root,
- create a project with `npx hardhat`,
- or pass `--config /path/to/hardhat.config.js`.

### BDLR8: Invalid Hardhat config

The config file loaded, but one or more fields failed validation.

Fix:

- check the full validation message,
- verify `networks`, `paths`, and `hyperion` fields,
- use the reserved `hardhatqrlvm` name for the in-process network and HTTP
  fields such as `url`, `accounts`, `gas`, and `gasPrice` for remote networks.

See [Configuration](../config/README.md).

### BDLR9: Imported the runtime from the config

The config probably imported `@theqrl/hardhat` instead of
`@theqrl/hardhat/config`.

Fix:

~~~js
const { task } = require("@theqrl/hardhat/config");
~~~

Use `@theqrl/hardhat` in scripts, tests, and runtime code, not in the config
file.

## Network and accounts

### BDLR100: Selected network does not exist

The value passed to `--network` is not defined in `hardhat.config.js`.

Fix:

- use an existing network name,
- add a matching entry under `networks`,
- or set `defaultNetwork`.

### BDLR101: Connected to the wrong network

The configured `chainId` does not match the value returned by `qrl_chainId`.

Fix:

- update the network `chainId`,
- connect to the intended node,
- or remove `chainId` if you do not want Hardhat to enforce it.

Verify the endpoint:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

### BDLR104: Account is not managed

The transaction `from` account is not available to Hardhat or the connected
node.

Fix:

- use an address returned by `qrl_accounts`,
- set `QRL_ACCOUNT_SEED` for local HTTP signing,
- configure `accounts: "remote"` and unlock/manage the account in go-qrl,
- or add the account to `hardhatqrlvm.accounts`.

Recipient addresses do not need to be managed. Sender addresses do.

### BDLR105: Missing transaction parameter

Hardhat is signing a transaction locally and a required transaction field is
missing.

Fix:

- pass a valid `from`,
- let gas estimation fill `gas` where supported,
- set `to`, `data`, `value`, or `nonce` only when the operation needs them,
- avoid hand-building raw transaction requests unless necessary.

### BDLR106: No remote accounts available

The network is configured to use node-managed accounts, but the node does not
return usable accounts.

Fix:

- configure `accounts: "remote"` only when the node manages unlocked accounts,
- otherwise provide `QRL_ACCOUNT_SEED`,
- check `qrl_accounts` directly.

### BDLR109: Cannot connect to the network

The configured HTTP endpoint is not reachable.

Common causes:

- go-qrl is not running,
- `QRL_RPC_URL` points at the wrong host or port,
- Docker or Kurtosis restarted and exposed a new dynamic port,
- the network config still uses a stale fallback URL.

Fix:

~~~sh
QRL_RPC_URL=http://localhost:<current-port> \
npx hardhat test --network qrl
~~~

For Docker-based private networks, find the current RPC port with:

~~~sh
docker ps --format '{{.Names}} {{.Ports}}'
~~~

### BDLR110: Network timeout

The node accepted the connection but did not respond before the timeout.

Fix:

- verify the node is healthy,
- increase the network timeout,
- reduce test/script concurrency,
- check whether the private network is producing blocks slowly.

### BDLR111: Invalid JSON-RPC response

The endpoint returned data that was not valid JSON-RPC.

Fix:

- verify `QRL_RPC_URL` points at a go-qrl JSON-RPC endpoint,
- check proxies, load balancers, or port mappings,
- call `qrl_chainId` with `curl` to confirm the response shape.

## QRL-specific validation

### BDLR115: Invalid QRL address

A QRL address must be `Q` followed by 128 hexadecimal characters.

Fix:

- check the address prefix,
- check the address length,
- avoid Ethereum `0x` addresses in QRL config, tests, and scripts.

### BDLR116: Invalid hex data

Transaction data, bytecode, or manually encoded calldata is not valid hex.

Fix:

- use `0x`-prefixed hex strings,
- prefer `contract.encodeFunctionData()` over manual calldata,
- avoid passing plain text where byte data is expected.

### BDLR117: Invalid QRL ABI operation

An ABI operation could not be encoded or decoded.

Common causes:

- wrong argument count,
- wrong argument type,
- invalid QRL address argument,
- unknown function or event name,
- ambiguous overloaded function name.

For overloaded functions, use full signatures:

~~~js
await resolver.callStatic["addr(bytes32)"](node);
await resolver.functions["setAddr(bytes32,address)"](node, recipient, { from });
resolver.encodeFunctionData("setAddr(bytes32,address)", [node, recipient]);
resolver.decodeFunctionResult("addr(bytes32)", data);
~~~

### BDLR121: Legacy `eth_*` RPC unsupported

The QRL-only fork rejects legacy `eth_*` JSON-RPC methods.

Fix:

- use the equivalent `qrl_*` method,
- update scripts, plugins, and tests that still call `eth_*`,
- use `hre.qrl` contract helpers where possible.

### BDLR122: Transaction receipt hash mismatch

The node returned a receipt for a different transaction hash than the one
Hardhat requested.

Fix:

- retry against a healthy node,
- check whether the RPC endpoint is proxied or load-balanced incorrectly,
- inspect node logs for receipt/indexing issues.

### BDLR123: QRL runtime unavailable

`hardhatqrlvm` could not load the QRL VM runtime — neither the bundle shipped in
installed packages nor the development override was usable.

Fix — with installed packages, unset the override (`QRLJS_MONOREPO_PATH` /
`qrlJsMonorepoPath`) or point it at a BUILT checkout; when running Hardhat
from its source tree, the override is required:

~~~sh
cd /path/to/qrljs-monorepo
npm install
npm run build --workspaces --if-present
npm run tsc

cd /path/to/qrl-hardhat-project
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo \
npx hardhat test --network hardhatqrlvm
~~~

You can also set `networks.<name>.qrlJsMonorepoPath` in
`hardhat.config.js`.

### BDLR124: No QRL sender account available

A transaction sent through an ergonomic contract helper (a direct method
alias or `factory.deploy()`) had no sender and none could be resolved.

The default sender is resolved in this order:

1. the explicit `from` in the transaction overrides,
2. the network's `from` config field,
3. the first account returned by `qrl_accounts`.

Fix (any one of):

~~~js
// pass an explicit sender
const tx = await contract.store(42, { from });

// or set a default sender for the network in hardhat.config.js
networks: {
  qrl: {
    url: "http://127.0.0.1:33462",
    from: "Q…",
    accounts,
  },
},
~~~

Or use a network that exposes accounts through `qrl_accounts` (a configured
`accounts` list or a node with unlocked accounts).

### BDLR125: Unresolved library references

The contract uses an external Hyperion library and no address was provided
for it at deployment. Deploy the library first and pass its address:

~~~js
const Consumer = await qrl.getContractFactory("Consumer", {
  libraries: { MathLib: mathLib.address },
});
~~~

See [deploying contracts with external libraries](../guides/deploying.md).

### BDLR126: Unknown library provided for linking

A `libraries` entry names a library the contract's bytecode does not
reference. Check the name; both `MathLib` and
`contracts/MathLib.hyp:MathLib` forms are accepted.

### BDLR127: Ambiguous library name for linking

Two libraries referenced by the contract share the same bare name. Use the
fully qualified `file.hyp:Library` form.

### BDLR128: Invalid library address for linking

Library addresses must be valid QRL addresses (`Q` + 128 hex characters).

### BDLR129: Link reference placeholder mismatch

A link reference reported by the compiler does not point at a `__$...$__`
placeholder — the artifact is corrupted or was produced by an incompatible
hypc build. Recompile the project.

### BDLR130: Invalid initialDate network config value

`initialDate` on a `hardhatqrlvm` network must be an ISO 8601 date string, e.g.
`"2026-01-01T00:00:00Z"`.

### BDLR131: Conflicting library addresses for linking

The same library was provided twice — through its bare and fully qualified
names — with different addresses. Remove one entry or make them identical.

## Compile, artifacts, and imports

### BDLR400-BDLR407: Source or import resolution errors

These errors mean a Hyperion source file or imported library could not be
resolved.

Fix:

- check relative imports,
- check package installation,
- keep source files inside the project or allowed library scope,
- avoid imports that escape a library boundary.

### BDLR700-BDLR799: Artifact errors

Artifact errors usually mean a contract has not been compiled or the requested
contract name does not match an artifact.

Fix:

~~~sh
npx hardhat clean
npx hardhat compile
~~~

Then verify the contract name passed to `qrl.getContractFactory()` or
`qrl.getContractAt()`.

## Plugin errors

### BDLR800-BDLR899: Plugin system errors

These errors come from plugin loading and dependency validation.

Fix:

- install the plugin package locally,
- install required peer dependencies,
- make sure peer dependency versions match,
- load QRL-compatible plugins with `usePlugin()`.

See [QRL Hardhat plugins](../plugins/README.md).
