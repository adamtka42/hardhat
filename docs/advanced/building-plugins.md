# Building plugins

Plugins are reusable QRL Hardhat configuration. Anything you can do in a plugin
can usually be prototyped in `hardhat.config.js` first and moved into a package
when it becomes reusable.

The main things a plugin can do are:

- define tasks,
- override existing tasks,
- extend the resolved config,
- extend the Hardhat Runtime Environment,
- read or write artifacts,
- throw plugin-specific errors.

This guide covers the plugin API that remains useful in the QRL fork. It does
not describe the removed Ethereum plugin stack.

## Plugin entrypoint

A plugin package is loaded with `usePlugin("package-name")`. The package should
export a function from its main entrypoint:

~~~js
module.exports = function qrlExamplePlugin() {
  // Register tasks and extenders here.
};
~~~

When loaded, QRL Hardhat calls the exported function while processing
`hardhat.config.js`.

During development, you can put the same code directly in `hardhat.config.js`.
Move it to a package once the behavior is stable.

## Defining tasks

Use `task()` from `@theqrl/hardhat/config`:

~~~js
const { task } = require("@theqrl/hardhat/config");

task("qrl-chain-id", "Prints the selected QRL chain id").setAction(
  async (_, { network }) => {
    const chainId = await network.provider.send("qrl_chainId");
    console.log(chainId);
  }
);
~~~

Task actions receive `(taskArgs, hre, runSuper)`. The `hre` object includes:

- `config`
- `hardhatArguments`
- `network`
- `run`
- `tasks`
- `qrl`

Use `hre.network.provider.send()` for direct `qrl_*` RPC calls and `hre.qrl`
for artifact, deployment, contract, call, and transaction helpers.

## Parameters

Use `types` for parsed task parameters:

~~~js
const { task, types } = require("@theqrl/hardhat/config");

task("qrl-balance", "Prints a QRL account balance")
  .addParam("account", "QRL address")
  .addOptionalParam("block", "Block tag", "latest", types.string)
  .setAction(async ({ account, block }, { network }) => {
    const [balance] = await network.provider.send("qrl_getBalance", [
      account,
      block,
    ]);

    console.log(balance);
  });
~~~

For go-qrl compatibility, pass a block tag such as `latest` to
`qrl_getBalance`.

## Overriding tasks

Calling `task()` with an existing task name overrides that task. Use `runSuper`
to preserve the original behavior:

~~~js
const { task } = require("@theqrl/hardhat/config");

task("test").setAction(async (args, hre, runSuper) => {
  const chainId = await hre.network.provider.send("qrl_chainId");
  console.log("Running tests on QRL chain:", chainId);

  return runSuper(args);
});
~~~

Override built-in tasks conservatively. Prefer adding a new task unless the
plugin genuinely needs to hook into a standard workflow such as `compile`,
`test`, `run`, `clean`, or `console`.

Internal tasks are available through `internalTask()`, but they are less stable
than public tasks and may change as the QRL fork evolves.

## Extending the config

Use `extendConfig()` to add derived fields to the resolved config:

~~~js
const { extendConfig } = require("@theqrl/hardhat/config");

extendConfig((config, userConfig) => {
  const userPluginConfig = userConfig.qrlExample || {};

  config.qrlExample = {
    timeoutMs: userPluginConfig.timeoutMs || 300000,
  };
});
~~~

The `userConfig` object is read-only. Do not mutate it. Add fields to the
resolved `config` object instead.

Any user-facing plugin config should be optional so projects can load the plugin
without extra boilerplate.

## Extending the runtime environment

Use `extendEnvironment()` to expose helpers on `hre`:

~~~js
const { extendEnvironment } = require("@theqrl/hardhat/config");

extendEnvironment((hre) => {
  hre.qrlExample = {
    async accounts() {
      return hre.network.provider.send("qrl_accounts");
    },
    async deploy(contractName, tx = {}) {
      const [from] = await hre.network.provider.send("qrl_accounts");
      return hre.qrl.deployContract(contractName, { from, ...tx });
    },
  };
});
~~~

The extender runs after the Hardhat Runtime Environment is initialized.

If you write the plugin in TypeScript, add module augmentation for
`HardhatRuntimeEnvironment` and any config fields your plugin adds. Keep the
runtime behavior and type declarations in sync.

## Reading artifacts

Plugins can use artifact helpers from `@theqrl/hardhat/plugins`:

~~~js
const { readArtifact } = require("@theqrl/hardhat/plugins");

task("artifact-abi", "Prints a contract ABI")
  .addParam("contract", "Contract name")
  .setAction(async ({ contract }, { config }) => {
    const artifact = await readArtifact(config.paths.artifacts, contract);
    console.log(JSON.stringify(artifact.abi, null, 2));
  });
~~~

Artifacts are generated from Hyperion `.hyp` contracts and consumed by
`hre.qrl`.

## Lazy initialization

Use `lazyObject()` or `lazyFunction()` from `@theqrl/hardhat/plugins` when a
helper is expensive to initialize:

~~~js
const { lazyObject } = require("@theqrl/hardhat/plugins");
const { extendEnvironment } = require("@theqrl/hardhat/config");

extendEnvironment((hre) => {
  hre.qrlExample = lazyObject(() => ({
    async chainId() {
      return hre.network.provider.send("qrl_chainId");
    },
  }));
});
~~~

This keeps startup time low when users run unrelated tasks.

## Throwing plugin errors

Use `HardhatPluginError` for user-facing plugin failures:

~~~js
const { HardhatPluginError } = require("@theqrl/hardhat/plugins");

throw new HardhatPluginError(
  "qrl-hardhat-example-plugin",
  "QRL_RPC_URL must be set for this task"
);
~~~

This gives users cleaner error messages than throwing arbitrary errors.

## Dependencies

Plugin packages should treat QRL Hardhat as a peer dependency:

~~~json
{
  "peerDependencies": {
    "@theqrl/hardhat": "^1.3.3"
  },
  "devDependencies": {
    "@theqrl/hardhat": "^1.3.3"
  }
}
~~~

If your plugin depends on another plugin, that plugin should normally be a peer
dependency too. If your plugin exposes a third-party library in its public API,
consider making that library a peer dependency so users control the version.

## QRL-only assumptions

QRL Hardhat plugins should not assume Ethereum-only APIs. Prefer:

- `qrl_*` JSON-RPC methods,
- `hre.qrl` contract helpers,
- QRL addresses,
- Hyperion artifacts,
- qrlLocal or HTTP go-qrl networks.

Avoid depending on `eth_*` RPC methods, Ethereum private keys, Ethers.js
signers, Web3.js providers, Ganache, Truffle, Waffle, Solidity-only compiler
options, or Buidler EVM internals unless your plugin explicitly provides a
compatibility layer and documents its limits.

