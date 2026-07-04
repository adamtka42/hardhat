# QRL Hardhat plugins

QRL Hardhat still supports the core Hardhat/Buidler plugin mechanism:

- `usePlugin()` loads a plugin from `hardhat.config.js`.
- Plugins can define and override tasks.
- Plugins can extend the resolved config.
- Plugins can extend the Hardhat Runtime Environment.
- Plugins can export helpers, lazy objects, and plugin-specific errors.

This fork does not include the old Ethereum plugin set. The removed upstream
plugins for Ethers.js, Web3.js, Waffle, Truffle, Ganache, Etherscan, Solidity
linting, Solidity preprocessing, Vyper, and Docker Solidity compilation were
specific to Ethereum/Solidity workflows and are not part of QRL Hardhat.

## Loading a plugin

Install a QRL-compatible plugin and load it from `hardhat.config.js`:

~~~js
usePlugin("qrl-hardhat-example-plugin");

module.exports = {
  defaultNetwork: "qrlLocal",
};
~~~

`usePlugin()` validates the plugin package and peer dependencies before loading
the plugin entrypoint. If the package exports a function, QRL Hardhat calls it
while loading the config.

## What plugins can do

QRL-compatible plugins should use the public config environment:

~~~js
const {
  task,
  internalTask,
  extendConfig,
  extendEnvironment,
  types,
  usePlugin,
} = require("@theqrl/hardhat/config");
~~~

Plugins can also use helpers from:

~~~js
const {
  HardhatPluginError,
  lazyFunction,
  lazyObject,
  readArtifact,
  readArtifactSync,
  saveArtifact,
} = require("@theqrl/hardhat/plugins");
~~~

The most common plugin features are:

- add QRL-aware tasks,
- wrap or extend existing tasks,
- add optional config fields,
- expose helper objects on `hre`,
- read generated Hyperion artifacts,
- call `hre.network.provider.send("qrl_*", ...)`,
- use `hre.qrl` for contract deployment, calls, and transactions.

## QRL compatibility expectations

QRL plugins should use QRL-native surfaces:

- Hyperion `.hyp` artifacts,
- QRL addresses,
- `qrl_*` JSON-RPC methods,
- `hre.qrl` helpers,
- qrlLocal or HTTP go-qrl networks.

Avoid assuming Ethereum-only behavior such as `eth_*` RPC, Ethereum private
keys, HD wallets, Solidity-only source paths, Ethers.js signers, Web3.js
providers, Ganache, or Buidler EVM.

## Building a plugin

For the current plugin API and QRL-specific examples, see
[Building plugins](../advanced/building-plugins.md).

