# QRL Hardhat

QRL Hardhat is a QRL-only smart contract development tool based on the upstream
Hardhat/Buidler `v1.3.3` codebase.

It targets Hyperion `.hyp` contracts, QRL addresses, `qrl_*` JSON-RPC methods, local
in-process tests through `qrlLocal`, and live go-qrl HTTP networks.

## Installation

~~~sh
npm install --save-dev @theqrl/hardhat
~~~

## Getting Started

See the repository guide:

~~~text
docs/getting-started.md
~~~

The guide covers:

- prerequisites and installation,
- project layout,
- `qrlLocal` configuration,
- HTTP go-qrl network configuration,
- Hyperion `.hyp` compilation,
- tests and deployment scripts,
- `hre.qrl` runtime helpers,
- overloaded function signatures,
- common troubleshooting.

For the full configuration reference, see:

~~~text
docs/config/README.md
~~~

For compile details, see:

~~~text
docs/guides/compile-contracts.md
~~~

For deployment details, see:

~~~text
docs/guides/deploying.md
~~~

For script usage, see:

~~~text
docs/guides/scripts.md
~~~

For task automation, see:

~~~text
docs/guides/create-task.md
~~~

For runtime helper details, see:

~~~text
docs/advanced/hardhat-runtime-environment.md
~~~

## Minimal Configuration

~~~js
const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

const localAccountAddress = "Q" + "01".repeat(64);

module.exports = {
  defaultNetwork: process.env.HARDHAT_DEFAULT_NETWORK || "qrlLocal",
  networks: {
    qrlLocal: {
      type: "qrl-local",
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

Run tasks with:

~~~sh
npx hardhat compile
npx hardhat test --network qrlLocal
npx hardhat run scripts/deploy.js --network qrl
~~~

Local signing uses QRL extended seeds and ML-DSA-87 via
`@theqrl/web3-qrl-accounts`. Legacy mnemonic and raw-key account configs are
intentionally unsupported.
