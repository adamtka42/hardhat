# Creating a plugin

Plugins are reusable QRL Hardhat configuration. They are useful when a task,
runtime helper, or config extension should be shared across multiple projects.

This guide creates a small QRL-compatible plugin that:

- adds a task,
- reads QRL accounts through `qrl_accounts`,
- adds a helper to the Hardhat Runtime Environment.

For a deeper reference, see [Building plugins](../advanced/building-plugins.md).

## Start in your config

Before publishing a plugin, prototype the behavior in `hardhat.config.js`:

~~~js
task("qrl-accounts", "Prints QRL accounts").setAction(async (_, { network }) => {
  const accounts = await network.provider.send("qrl_accounts");

  for (const account of accounts) {
    console.log(account);
  }
});

module.exports = {
  defaultNetwork: "qrlLocal",
};
~~~

Run it with:

~~~sh
npx hardhat qrl-accounts --network qrlLocal
~~~

If the behavior is useful in more than one project, move it into a plugin.

## Create the package

Create a new package:

~~~sh
mkdir qrl-hardhat-example-plugin
cd qrl-hardhat-example-plugin
npm init --yes
~~~

Add QRL Hardhat as a peer dependency and development dependency:

~~~json
{
  "name": "qrl-hardhat-example-plugin",
  "version": "0.1.0",
  "main": "index.js",
  "peerDependencies": {
    "@theqrl/hardhat": "^1.3.3"
  },
  "devDependencies": {
    "@theqrl/hardhat": "^1.3.3"
  }
}
~~~

## Add a plugin entrypoint

Create `index.js`:

~~~js
const { extendEnvironment, task } = require("@theqrl/hardhat/config");

module.exports = function qrlExamplePlugin() {
  task("qrl-accounts", "Prints QRL accounts").setAction(
    async (_, { network }) => {
      const accounts = await network.provider.send("qrl_accounts");

      for (const account of accounts) {
        console.log(account);
      }
    }
  );

  extendEnvironment((hre) => {
    hre.qrlExample = {
      async accounts() {
        return hre.network.provider.send("qrl_accounts");
      },
    };
  });
};
~~~

The exported function is called when the plugin is loaded with `usePlugin()`.

## Load the plugin

Install the plugin in a QRL Hardhat project and load it from
`hardhat.config.js`:

~~~js
usePlugin("qrl-hardhat-example-plugin");

module.exports = {
  defaultNetwork: "qrlLocal",
  networks: {
    qrlLocal: {
      type: "qrl-local",
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      accounts: [{ address: "Q" + "01".repeat(64), balance: "1000000000000" }],
    },
  },
};
~~~

Run the plugin task:

~~~sh
npx hardhat qrl-accounts --network qrlLocal
~~~

Use the runtime helper from a task, script, test, or console:

~~~js
const accounts = await qrlExample.accounts();
~~~

## Add parameters

Plugins can use the same task parameter API as project configs:

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

Run it with:

~~~sh
npx hardhat qrl-balance --account Q... --network qrl
~~~

## Keep it QRL-compatible

QRL-compatible plugins should prefer:

- `qrl_*` JSON-RPC methods,
- `hre.qrl` helpers,
- Hyperion `.hyp` artifacts,
- QRL addresses,
- qrlLocal and HTTP go-qrl networks.

Avoid assuming Ethereum private keys, Ethers.js signers, Web3.js providers,
Ganache, Truffle, Waffle, Buidler EVM, or Solidity-only compiler behavior unless
your plugin explicitly implements and documents a compatibility layer.

