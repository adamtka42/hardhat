# QRL Hardhat plugins

QRL Hardhat still supports the core Hardhat/Buidler plugin mechanism:

- `usePlugin()` loads a plugin from `hardhat.config.js`.
- Plugins can define and override tasks.
- Plugins can extend the resolved config.
- Plugins can extend the Hardhat Runtime Environment.
- Plugins can export helpers, lazy objects, and plugin-specific errors.

This fork does not include the old Ethereum plugin set. The removed upstream
plugins for Ethers.js, Ethereum Web3.js, Waffle, Truffle, Ganache, Etherscan,
Solidity linting, Solidity preprocessing, Vyper, and Docker Solidity compilation
were specific to Ethereum/Solidity workflows and are not part of QRL Hardhat.

## Loading a plugin

Install a QRL-compatible plugin and load it from `hardhat.config.js`:

~~~js
usePlugin("qrl-hardhat-example-plugin");

module.exports = {
  defaultNetwork: "hardhatqrlvm",
};
~~~

`usePlugin()` validates the plugin package and peer dependencies before loading
the plugin entrypoint. If the package exports a function, QRL Hardhat calls it
while loading the config.

## Official QRL Web3 plugin

`@theqrl/hardhat-web3` is the official QRL-compatible Web3 plugin. It adds the
`Web3` constructor and a `web3` instance connected to the selected Hardhat
network. Use the QRL namespace:

~~~js
usePlugin("@theqrl/hardhat-web3");

task("accounts", "Prints QRL accounts", async (_, { web3 }) => {
  console.log(await web3.qrl.getAccounts());
});
~~~

The plugin uses `@theqrl/web3`; it does not provide Ethereum `web3.eth`
compatibility.

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
- hardhatqrlvm or HTTP go-qrl networks.

Avoid assuming Ethereum-only behavior such as `eth_*` RPC, Ethereum private
keys, HD wallets, Solidity-only source paths, Ethers.js signers, Ethereum Web3
providers, Ganache, or Buidler EVM. Use `@theqrl/web3` when a Web3 API is needed.

## Building a plugin

For the current plugin API and QRL-specific examples, see
[Building plugins](../advanced/building-plugins.md).
