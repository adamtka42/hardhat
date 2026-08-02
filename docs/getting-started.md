# Getting started with QRL Hardhat

QRL Hardhat is a QRL-only smart contract development toolchain based on the
upstream Hardhat/Buidler `v1.3.3` codebase. It compiles Hyperion `.hyp`
contracts, uses QRL addresses as the native address format, and talks to QRL
nodes through `qrl_*` JSON-RPC methods.

This guide shows the recommended setup for a new project and mirrors the shape
of the upstream Hardhat getting-started flow: prerequisites, installation,
project structure, configuration, compile, test, and scripts.

## Prerequisites

- Node.js 20 or later.
- npm.
- A Hyperion compiler available to Hardhat's compile task.
- For local in-process tests: nothing extra — installed packages ship the QRL
  VM runtime bundled. (Working from this repository's source tree instead
  still needs a built `qrljs-monorepo` checkout exposed with
  `QRLJS_MONOREPO_PATH` or `networks.hardhatqrlvm.qrlJsMonorepoPath`.)
- For live/private networks: a running go-qrl HTTP JSON-RPC node.
- For locally signed live transactions: a QRL extended seed in
  `QRL_ACCOUNT_SEED`, or use `accounts: "remote"` with a node-managed account.

## Installation

Create a project directory and install QRL Hardhat:

~~~sh
mkdir qrl-hardhat-example
cd qrl-hardhat-example
npm init -y
npm install --save-dev @theqrl/hardhat
~~~

If you are developing against a local checkout of this repository, link or
install the package from that checkout using your normal workspace workflow.

## Project structure

A minimal QRL Hardhat project looks like this:

~~~text
qrl-hardhat-example/
  contracts/
    Sample.hyp
  scripts/
    deploy.js
  test/
    sample-test.js
  hardhat.config.js
  package.json
~~~

- `contracts`: Hyperion source files using the `.hyp` extension.
- `test`: Mocha tests that use the Hardhat Runtime Environment.
- `scripts`: deployment and maintenance scripts.
- `hardhat.config.js`: compiler, task, and network configuration.

## Configuration

Create `hardhat.config.js`:

~~~js
task("accounts", "Prints QRL accounts", async (_, { network }) => {
  const accounts = await network.provider.send("qrl_accounts");
  for (const address of accounts) {
    console.log(address);
  }
});

const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

const localAccountAddress = "Q" + "01".repeat(64);

module.exports = {
  defaultNetwork: process.env.HARDHAT_DEFAULT_NETWORK || "hardhatqrlvm",
  networks: {
    hardhatqrlvm: {
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      blockGasLimit: 30000000,
    },
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
    },
  },
};
~~~

Use `hardhatqrlvm` for fast in-process tests. Use `qrl` or another HTTP network for
a running go-qrl node.

### hardhatqrlvm

`hardhatqrlvm` runs a local QRL VM in-process. It does not require a go-qrl node;
installed packages include the QRL VM runtime, so it works directly:

~~~sh
npx hardhat test --network hardhatqrlvm
~~~

For qrljs/Hardhat development you can point at a built `qrljs-monorepo`
checkout instead, with `QRLJS_MONOREPO_PATH` or `qrlJsMonorepoPath` in
`hardhat.config.js`.

### HTTP networks

HTTP networks point at go-qrl JSON-RPC endpoints:

~~~sh
export QRL_RPC_URL=http://127.0.0.1:33462
export QRL_ACCOUNT_SEED=<qrl-extended-seed>
npx hardhat test --network qrl
~~~

If the node manages accounts itself, configure the network with
`accounts: "remote"` instead of local seeds.

## Write a contract

Create `contracts/Sample.hyp`:

~~~solidity
// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

contract Sample {
    uint256 private value;

    event ValueChanged(uint256 newValue);

    function store(uint256 newValue) public {
        value = newValue;
        emit ValueChanged(newValue);
    }

    function retrieve() public view returns (uint256) {
        return value;
    }
}
~~~

Compile it:

~~~sh
npx hardhat compile
~~~

Compiled artifacts are written to `artifacts/` and cache files are written to
`cache/`. See [guides/compile-contracts.md](guides/compile-contracts.md) for
the full compile reference.

## Test a contract

Create `test/sample-test.js`:

~~~js
const assert = require("assert");

describe("Sample", function () {
  it("deploys and calls a Hyperion contract", async function () {
    this.timeout(300000);

    const Sample = await qrl.getContractFactory("Sample");
    const sample = await Sample.deploy();

    const tx = await sample.store(42);
    const receipt = await tx.wait();
    const stored = await sample.retrieve();

    assert.ok(sample.deployTransactionHash);
    assert.ok(sample.address);
    assert.strictEqual(receipt.status, "0x1");
    assert.strictEqual(stored.toString(10), "42");
  });
});
~~~

Run the test on `hardhatqrlvm`:

~~~sh
export QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
npx hardhat test --network hardhatqrlvm
~~~

Run it against an HTTP node:

~~~sh
export QRL_RPC_URL=http://127.0.0.1:33462
export QRL_ACCOUNT_SEED=<qrl-extended-seed>
npx hardhat test --network qrl
~~~

## Debug contract code with console.log

When running on `hardhatqrlvm`, contracts can import
`@theqrl/hardhat/console.hyp` and print temporary debug values from inside
Hyperion code:

~~~solidity
import "@theqrl/hardhat/console.hyp";

function store(uint256 newValue) public {
    console.log("new", newValue);
}
~~~

See [Contract console logging](guides/console-log.md) for the supported
signatures and network behavior.

## Deploy with a script

Create `scripts/deploy.js`:

~~~js
async function main() {
  const Sample = await qrl.getContractFactory("Sample");
  const sample = await Sample.deploy();

  const tx = await sample.store(42);
  await tx.wait();
  const stored = await sample.retrieve();

  console.log("Sample deployed to:", sample.address);
  console.log("Deployment transaction:", sample.deployTransactionHash);
  console.log("Stored value:", stored.toString(10));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

Run it:

~~~sh
npx hardhat run scripts/deploy.js --network hardhatqrlvm
~~~

or:

~~~sh
npx hardhat run scripts/deploy.js --network qrl
~~~

See [guides/deploying.md](guides/deploying.md) for deployment details and
[guides/scripts.md](guides/scripts.md) for the full scripts guide.

## Runtime helpers

QRL Hardhat extends the runtime with `qrl` helpers:

- `qrl.getContractFactory(name)`: load a compiled Hyperion artifact. The
  factory's `deploy()` returns a ready-to-use contract wrapper.
- `qrl.getContractAt(name, address)`: attach to an already deployed contract.
- `qrl.deployContract(name, tx, argsOrData?, waitOptions?)`: deploy with a
  lower-level transaction object; returns `{ hash, receipt, address }`.
- `qrl.sendTransaction(tx)`: send a QRL transaction.
- `qrl.call(tx, blockTag?)`: run `qrl_call`.
- `qrl.waitForTransaction(hash, timeoutMs?)`: wait for a receipt.

Contract wrappers expose direct method aliases for unambiguous ABI functions:

- `contract.name(...args, txOverrides?)` calls read-only functions (a single
  output is unwrapped to a scalar) or sends state-changing transactions and
  returns `{ hash, wait() }`.

The explicit low-level maps remain available:

- `contract.functions.name(...args, txOptions)` sends a state-changing call.
- `contract.callStatic.name(...args, txOptions)` simulates a call and always
  returns a decoded array.
- `contract.send.name(...args, txOptions)` sends and returns a transaction hash.
- `contract.encodeFunctionData(identifier, args)` encodes calldata.
- `contract.decodeFunctionResult(identifier, data)` decodes return data.

For overloaded ABI functions, use the full canonical signature:

~~~js
await resolver.functions["setAddr(bytes32,address)"](node, recipient, { from });
const [resolved] = await resolver.callStatic["addr(bytes32)"](node);
~~~

Unambiguous functions are also available by name. See
[advanced/hardhat-runtime-environment.md](advanced/hardhat-runtime-environment.md)
for the full runtime reference.

## JSON-RPC methods

This fork is QRL-only. Use `qrl_*` JSON-RPC methods such as:

- `qrl_accounts`
- `qrl_chainId`
- `qrl_getBalance`
- `qrl_getTransactionCount`
- `qrl_sendTransaction`
- `qrl_sendRawTransaction`
- `qrl_call`
- `qrl_estimateGas`
- `qrl_getTransactionReceipt`
- `qrl_getBlockByNumber`

Legacy `eth_*` compatibility is intentionally not the primary interface.

## Troubleshooting

### hardhatqrlvm cannot load the QRL runtime

Installed packages ship the runtime bundled; this error normally appears only
when `QRLJS_MONOREPO_PATH` (or `qrlJsMonorepoPath`) points at a missing or
unbuilt checkout — a set override never falls back to the bundle. Either unset
the override or build the checkout:

~~~sh
cd /path/to/qrljs-monorepo
npm install
npm run build

cd /path/to/qrl-hardhat-example
export QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
npx hardhat test --network hardhatqrlvm
~~~

When running Hardhat from this repository's source tree (not a packed
installation), the bundle is absent and the override is required.

Alternatively, use an HTTP network:

~~~sh
HARDHAT_DEFAULT_NETWORK=qrl npx hardhat test
~~~

### No accounts are returned

For HTTP networks, either configure `accounts: "remote"` and unlock/manage
accounts in the node, or set `QRL_ACCOUNT_SEED` so Hardhat can sign locally.

### Function is overloaded

Use a full function signature in helpers and ABI utilities, for example
`setAddr(bytes32,address)` instead of `setAddr`.

For TypeScript project setup, see
[guides/typescript.md](guides/typescript.md). For VS Code debugging, see
[guides/vscode-tests.md](guides/vscode-tests.md). For hardhatqrlvm details, see
[hardhat-qrlvm/README.md](hardhat-qrlvm/README.md).

For more troubleshooting cases, see
[troubleshooting/common-problems.md](troubleshooting/common-problems.md). For
debug output and stack traces, see
[troubleshooting/verbose-logging.md](troubleshooting/verbose-logging.md).

