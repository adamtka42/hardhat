# Configuration

QRL Hardhat is configured with `hardhat.config.js` in the root of your project.
The config file is loaded before every task, test, and script. It defines the
Hyperion compiler settings, project paths, networks, accounts, gas defaults, and
Mocha options.

A minimal project config usually looks like this:

~~~js
const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

const localAccountAddress = "Q" + "01".repeat(64);

module.exports = {
  defaultNetwork: process.env.HARDHAT_DEFAULT_NETWORK || "qrlLocal",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
    optimizer: {
      enabled: false,
      runs: 200,
    },
  },
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
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
    },
  },
};
~~~

## Top-level options

`defaultNetwork` selects the network used when a command does not pass
`--network`. The default built into QRL Hardhat is `qrl`, but projects commonly
set it to `qrlLocal` for tests.

`networks` maps network names to either an HTTP go-qrl network or a local
in-process `qrlLocal` network.

`hyperion` configures the Hyperion compiler.

`paths` customizes project directories.

`mocha` passes options to Mocha when running `hardhat test`.

Ethereum-only config such as `solc`, Ethereum private keys, and HD wallet
mnemonics is not part of the QRL-only configuration surface.

## Hyperion compiler

QRL Hardhat compiles Hyperion `.hyp` files. The compiler config supports:

~~~js
module.exports = {
  hyperion: {
    version: "local",
    compilerPath: process.env.HYPERION_HYPC_PATH,
    optimizer: {
      enabled: false,
      runs: 200,
    },
  },
};
~~~

`version` selects the expected compiler version. `"local"` (the default)
uses a local binary. A concrete version such as `"0.2.0"` is downloaded only
when `compilerRepositoryUrl` or `HYPERION_COMPILER_REPOSITORY_URL` is set and
no explicit local compiler override is present.

`compilerPath` points at a local `hypc` executable. Local selection takes
precedence over downloads and follows this order:

1. `hyperion.compilerPath`,
2. `HYPERION_HYPC_PATH`,
3. `HYPC_PATH`,
4. `hypc` from `PATH`.

`compilerRepositoryUrl` points at an HTTP(S) compiler repository containing
`list.json` and compiler builds. It has no default today. This keeps existing
local projects unchanged while allowing a future official repository to become
the default without changing the compile pipeline. See the
[compilation guide](../guides/compile-contracts.md) for manifest and checksum
details.

`optimizer.enabled` and `optimizer.runs` are passed into the Hyperion compiler
input.

## qrlLocal network

`qrlLocal` is an in-process QRL VM network for fast local tests. It does not
connect to a go-qrl node. Installed packages ship the QRL VM runtime bundled,
so no extra setup is needed; a built `qrljs-monorepo` checkout can optionally
override the bundled runtime for development.

~~~js
module.exports = {
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: "Q" + "01".repeat(64),
      accounts: [
        {
          address: "Q" + "01".repeat(64),
          seed: process.env.QRL_LOCAL_SEED,
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

`qrlJsMonorepoPath` can also be provided with `QRLJS_MONOREPO_PATH`.

`accounts` is an array of local account objects. Each account needs a QRL
address. `balance` can be a decimal string, hex string, or number. `nonce` is
optional. `seed` is an optional prefixed 51-byte extended QRL seed. It must
derive the configured address and enables `qrl_sign` for that account. Keep
seeds in environment variables and never commit them.

`from` sets the default sender address for transactions on this network.

`blockGasLimit` sets the local block gas limit. It defaults to `30000000`.

`automine` controls local mining behavior. The default local config enables it.

`initialDate` sets the genesis block timestamp as an ISO 8601 date string
(e.g. `"2026-01-01T00:00:00Z"`). Later blocks default to `parent + 1` second;
use `qrl_increaseTime` / `qrl_setNextBlockTimestamp` to shift time in tests.

`throwOnTransactionFailures` / `throwOnCallFailures` (default `true`) make
reverting transactions/calls throw with the decoded reason; see the
[qrlLocal guide](../qrl-local/README.md) for details.

`allowUnlimitedContractSize` skips the deployed-code size limit
(`QRL_MAX_CODE_SIZE`), e.g. for coverage-instrumented contracts. Local testing
only — real networks always enforce the limit.

`stackTraces` (default `true`) appends Hyperion stack traces to failed
transaction/call errors; see the
[stack traces guide](../guides/stack-traces.md).

For a focused qrlLocal guide, see [../qrl-local/README.md](../qrl-local/README.md).

## HTTP go-qrl networks

HTTP networks connect to a running go-qrl JSON-RPC endpoint and use `qrl_*` RPC
methods.

~~~js
const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

module.exports = {
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      chainId: 1,
      from: process.env.QRL_FROM,
      accounts,
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1,
      httpHeaders: {},
      timeout: 20000,
    },
  },
};
~~~

`url` is the HTTP JSON-RPC endpoint. Private devnets often expose dynamic Docker
or Kurtosis ports, so prefer `QRL_RPC_URL` over committing a machine-specific
port.

`chainId` is optional. If set, QRL Hardhat validates that the connected network
matches it.

`from` sets the default sender. If omitted, QRL Hardhat uses the first available
account.

`gas` can be `"auto"` or a number. With `"auto"`, QRL Hardhat calls
`qrl_estimateGas`.

`gasPrice` can be `"auto"` or a number. With `"auto"`, QRL Hardhat calls
`qrl_gasPrice` when needed.

`gasMultiplier` multiplies automatic gas estimates and is useful when estimation
is tight.

`httpHeaders` adds headers to JSON-RPC requests.

`timeout` sets the JSON-RPC request timeout in milliseconds.

## Accounts

HTTP networks support three account modes.

### Local QRL extended seeds

Use an array of QRL extended seed hex strings when Hardhat should sign
transactions locally:

~~~js
module.exports = {
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL,
      accounts: [process.env.QRL_ACCOUNT_SEED],
    },
  },
};
~~~

The seed must be a `0x`-prefixed 51-byte QRL extended seed hex string. Do not
commit real account seeds. Use environment variables or local secret management.

You need a local seed for tests or scripts that deploy contracts, mint tokens,
transfer assets, or otherwise send signed transactions unless the node manages
accounts remotely.

### Remote node accounts

Use `accounts: "remote"` if the connected go-qrl node manages unlocked accounts:

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

With this mode, signing is delegated to the node.

## Project paths

The `paths` config can override the default project directories:

~~~js
module.exports = {
  paths: {
    root: __dirname,
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
~~~

`sources` is where `.hyp` contracts are read from.

`tests` is where `hardhat test` looks for tests.

`cache` stores compiler and task cache data.

`artifacts` stores compiled contract artifacts.

## Mocha

`mocha` is passed to Mocha for the `test` task:

~~~js
module.exports = {
  mocha: {
    timeout: 300000,
  },
};
~~~

Live/private QRL networks can be slow because transactions wait for blocks, so
large timeouts are common for integration tests.

## Common environment variables

`QRL_RPC_URL` points at an HTTP go-qrl endpoint.

`QRL_ACCOUNT_SEED` provides a locally signed QRL account for HTTP networks.

`QRLJS_MONOREPO_PATH` points at a built `qrljs-monorepo` checkout for `qrlLocal`.

`HYPERION_HYPC_PATH` points at a local `hypc` compiler binary.

`HYPERION_COMPILER_REPOSITORY_URL` points at an optional HTTP(S) compiler
repository.

`HARDHAT_DEFAULT_NETWORK` can override `defaultNetwork` if your config uses it.

## QRL-only configuration

Ethereum HD wallet config, raw Ethereum private keys, `eth_*` network assumptions,
Solidity `solc` config, and EVM hardfork settings are not valid QRL Hardhat
configuration. Use Hyperion, QRL addresses, QRL extended seeds, and `qrl_*`
JSON-RPC networks instead.
