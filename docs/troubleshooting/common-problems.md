# Common problems

This page collects the QRL Hardhat issues most likely to appear while compiling,
testing, deploying, or running scripts against `qrlLocal` and HTTP go-qrl
networks.

For debug output and stack traces, see
[verbose-logging.md](verbose-logging.md). For a code-by-code reference, see
[error-codes.md](error-codes.md).

## qrlLocal cannot load qrljs-monorepo

Typical error:

~~~text
BDLR123: Cannot load local qrljs-monorepo from <path>: <message>.
Build qrljs-monorepo first or set networks.<network>.qrlJsMonorepoPath / QRLJS_MONOREPO_PATH.
~~~

`qrlLocal` needs a built `qrljs-monorepo` checkout because the local QRL VM
packages are loaded from that repository.

Fix:

~~~sh
cd /path/to/qrljs-monorepo
npm install
npm run build

cd /path/to/qrl-hardhat-project
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo \
npx hardhat test --network qrlLocal
~~~

You can also set the path in `hardhat.config.js`:

~~~js
module.exports = {
  networks: {
    qrlLocal: {
      type: "qrl-local",
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
    },
  },
};
~~~

If you do not need `qrlLocal`, use an HTTP go-qrl network instead:

~~~sh
HARDHAT_DEFAULT_NETWORK=qrl npx hardhat test
~~~

## BDLR109: Cannot connect to the network

Typical error:

~~~text
BDLR109: Cannot connect to the network qrlPrivate.
Please make sure your node is running, and check your internet connection and networks config
~~~

This means the configured HTTP URL is not reachable. The most common causes are:

- the go-qrl node is not running,
- `QRL_RPC_URL` points at the wrong host or port,
- a Docker/Kurtosis private network restarted and exposed a new host port,
- the config default URL is stale.

Verify the endpoint directly:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

A successful response looks like:

~~~json
{"jsonrpc":"2.0","id":1,"result":"0x1"}
~~~

Run with the current endpoint:

~~~sh
QRL_RPC_URL=http://localhost:<current-port> npx hardhat test --network qrl
~~~

For private devnets, prefer passing `QRL_RPC_URL` at runtime instead of
committing a machine-specific port to `hardhat.config.js`.

## Private network port changed

Docker and Kurtosis commonly expose dynamic host ports. If tests worked earlier
but now fail with `BDLR109`, check the current execution-client port.

For Docker, inspect running containers:

~~~sh
docker ps --format '{{.Names}} {{.Ports}}'
~~~

Look for an execution client exposing container port `8545`, for example:

~~~text
el-1-... 0.0.0.0:32842->8545/tcp
~~~

Then run:

~~~sh
QRL_RPC_URL=http://localhost:32842 npx hardhat test --network qrl
~~~

Use the actual port shown by your environment.

## No accounts are returned

If `qrl_accounts` returns an empty list, Hardhat cannot deploy or send
transactions on that network.

For HTTP networks, use one of these account modes:

~~~js
// Local signing with a QRL extended seed
accounts: [process.env.QRL_ACCOUNT_SEED]
~~~

~~~js
// Node-managed accounts
accounts: "remote"
~~~

For `qrlLocal`, configure local accounts:

~~~js
accounts: [
  {
    address: "Q" + "01".repeat(64),
    balance: "1000000000000000000000000",
  },
]
~~~

Check accounts with:

~~~sh
npx hardhat accounts --network qrlLocal
~~~

or with direct RPC:

~~~js
const accounts = await network.provider.send("qrl_accounts");
~~~

## Missing QRL_ACCOUNT_SEED on HTTP networks

HTTP deployments and state-changing transactions need a signing account unless
the node manages unlocked accounts with `accounts: "remote"`.

For local signing:

~~~sh
QRL_RPC_URL=http://localhost:<port> \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
~~~

The seed must be a `0x`-prefixed 51-byte QRL extended seed hex string. Do not
commit real seeds.

## BDLR104: account is not managed

Typical error:

~~~text
BDLR104: Account Q... is not managed by the node you are connected to.
~~~

The transaction `from` account is not available to the selected network. This
usually happens when a script or test sends from a hardcoded QRL address that is
only meant to be a recipient.

Fix one of these:

- use an account returned by `qrl_accounts`,
- set `QRL_ACCOUNT_SEED` for the account you want to sign with,
- configure `accounts: "remote"` and unlock/manage the account in the node,
- add the account to `qrlLocal.accounts` for local tests.

Recipient addresses do not need to be managed. Sender addresses do.

## Contract console.log prints nothing

Contract-side `console.log` output is printed only by `qrlLocal`. If the same
contract runs on an HTTP go-qrl network, the console call succeeds silently and
no logs are printed.

Check these items:

- run the script or test with `--network qrlLocal`,
- make sure the contract imports `@theqrl/hardhat/console.hyp`,
- check that `networks.qrlLocal.consoleLog` is not set to `false`,
- rebuild `qrljs-monorepo` if Hardhat warns that the loaded local VM does not
  support contract console logging.

See [Contract console logging](../guides/console-log.md).

## qrl_getBalance requires a block tag

Some go-qrl endpoints require the block tag argument for `qrl_getBalance`.
Always pass one explicitly:

~~~js
const [balance] = await network.provider.send("qrl_getBalance", [
  address,
  "latest",
]);
~~~

This avoids private-network errors such as missing a required RPC argument.

## Chain id mismatch

If a network config sets `chainId`, QRL Hardhat validates it against
`qrl_chainId`. A mismatch fails early so transactions are not sent to the wrong
network.

Check the connected chain:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

Then either connect to the intended network or update the `chainId` in
`hardhat.config.js`.

## Gas or block gas limit failures

Private networks may use a lower block gas limit than `qrlLocal`. If a deploy or
state-changing test fails only on a private network, check the latest block:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_getBlockByNumber","params":["latest",false],"id":1}'
~~~

If needed, pass a gas value below the private network block gas limit in the
trailing transaction overrides:

~~~js
const tx = await contract.method(arg1, arg2, {
  gas: 15000000,
});
await tx.wait();
~~~

QRL Hardhat normalizes numeric transaction quantity fields before sending RPC
requests, including `gas`, `gasLimit`, `gasPrice`, `value`, `nonce`, `chainId`,
`maxFeePerGas`, and `maxPriorityFeePerGas`.

## Transaction or deployment timeout

Typical error:

~~~text
BDLR110: Network connection timed-out.
~~~

or a deployment wait timeout while polling for a receipt.

Private networks can take longer to produce blocks. Increase deployment or
receipt wait timeouts:

~~~js
const contract = await Factory.deploy({}, [], {
  timeoutMs: 300000,
  pollIntervalMs: 1000,
});
~~~

For raw transactions:

~~~js
const txHash = await qrl.sendTransaction({ from, to, data });
const receipt = await qrl.waitForTransaction(txHash, 300000, 1000);
~~~

If increasing the timeout does not help, check whether the node is producing
blocks and whether the transaction is valid.

## Contract artifact not found

Typical error:

~~~text
Artifact for contract "Sample" not found.
~~~

Fix:

~~~sh
npx hardhat compile
~~~

Also check:

- the contract source has a `.hyp` extension,
- `paths.sources` points at the right directory,
- the contract name matches the artifact name,
- duplicate contract names use fully qualified names.

For duplicate names:

~~~js
const Factory = await qrl.getContractFactory("contracts/Sample.hyp:Sample");
~~~

If artifacts look stale, rebuild from scratch:

~~~sh
npx hardhat clean
npx hardhat compile
~~~

## Function is overloaded

If an ABI contains overloaded functions, using the short name is ambiguous:

~~~text
Function setAddr is overloaded. Use a full signature like setAddr(bytes32,address).
~~~

Use full canonical signatures:

~~~js
await resolver.functions["setAddr(bytes32,address)"](node, recipient, {
  from,
});

const [resolved] = await resolver.callStatic["addr(bytes32)"](node);
const data = resolver.encodeFunctionData("setAddr(bytes32,address)", [
  node,
  recipient,
]);
~~~

Unambiguous function names are still available by short name.

## Invalid QRL ABI operation

`BDLR117` means QRL Hardhat could not encode or decode the requested ABI
operation. Common causes are:

- wrong function or event name,
- missing full signature for an overloaded function or event,
- argument count mismatch,
- unsupported or malformed ABI type,
- invalid QRL address value.

Check the artifact ABI and prefer full signatures when in doubt.

## npm update notice

This output is not a test warning:

~~~text
npm notice New major version of npm available
~~~

It only means npm has a newer version. Tests can pass normally with this notice.
To hide it locally or in CI:

~~~sh
npm config set update-notifier false
~~~

or per command:

~~~sh
NPM_CONFIG_UPDATE_NOTIFIER=false npm run test:local
~~~

Do not upgrade npm in the middle of debugging unless you intentionally want to
change the toolchain.

## Node punycode deprecation warning

This warning can appear on newer Node.js versions:

~~~text
[DEP0040] DeprecationWarning: The `punycode` module is deprecated.
~~~

It comes from a dependency using Node's deprecated `punycode` module. It is not a
Hardhat test failure by itself. Treat the actual failing error below it as the
root cause.

## Legacy eth_* RPC methods

This fork is QRL-only. Use `qrl_*` JSON-RPC methods such as:

- `qrl_accounts`
- `qrl_chainId`
- `qrl_getBalance`
- `qrl_sendTransaction`
- `qrl_call`
- `qrl_estimateGas`
- `qrl_getTransactionReceipt`

Legacy `eth_*` methods are intentionally not the primary interface and may be
rejected.
