# QRL Hardhat Web3

This plugin integrates [`@theqrl/web3`](https://www.npmjs.com/package/@theqrl/web3) with QRL Hardhat.

## What

This plugin adds the `@theqrl/web3` constructor and an initialized Web3
instance to the Hardhat Runtime Environment. The instance uses the provider of
the selected QRL Hardhat network.

## Installation

~~~bash
npm install --save-dev @theqrl/hardhat-web3 @theqrl/web3
~~~

Add the plugin to `hardhat.config.js`:

~~~js
usePlugin("@theqrl/hardhat-web3");
~~~

## Tasks

This plugin creates no additional tasks.

## Environment extensions

The plugin adds these fields to the `HardhatRuntimeEnvironment`:

- `Web3`: the constructor exported as `Web3` by `@theqrl/web3`.
- `web3`: a singleton `Web3` instance connected to the selected Hardhat
  network.

QRL network APIs are available under `web3.qrl`. The plugin does not add an
Ethereum `web3.eth` alias.

Subscriptions are available when the selected provider supports them.
`hardhatqrlvm` forwards subscription notifications, including `newHeads`. HTTP
networks do not advertise subscription support; use a subscription-capable
transport when push events are required.

## Usage

Access Web3 through the Hardhat Runtime Environment in tasks, scripts, tests,
or the console. For example, in `hardhat.config.js`:

~~~js
usePlugin("@theqrl/hardhat-web3");

task("accounts", "Prints QRL accounts", async (_, { web3 }) => {
  console.log(await web3.qrl.getAccounts());
});

module.exports = {};
~~~

Run the task with:

~~~bash
npx hardhat accounts
~~~

## TypeScript support

Add the plugin's module augmentation to the `files` array in `tsconfig.json`:

~~~json
{
  "files": [
    "node_modules/@theqrl/hardhat-web3/src/type-extensions.d.ts"
  ]
}
~~~
