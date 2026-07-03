# 3. Creating a new QRL Hardhat project

We will install QRL Hardhat using the npm CLI. The Node.js package manager is
used to create the project and install JavaScript dependencies.

Open a new terminal and run these commands:

```sh
mkdir qrl-hardhat-tutorial
cd qrl-hardhat-tutorial
npm init --yes
npm install --save-dev @theqrl/hardhat
```

::: tip
Installing QRL Hardhat may install native and QRL JavaScript dependencies, so be
patient.
:::

Create a `hardhat.config.js` file in the project root:

```js
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

const localAccounts = [
  { address: "Q" + "01".repeat(64), balance: "1000000000000" },
  { address: "Q" + "02".repeat(64), balance: "1000000000000" },
  { address: "Q" + "03".repeat(64), balance: "1000000000000" },
];

module.exports = {
  defaultNetwork: process.env.HARDHAT_DEFAULT_NETWORK || "qrlLocal",
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccounts[0].address,
      accounts: localAccounts,
      blockGasLimit: 30000000,
    },
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
    },
  },
};
```

When QRL Hardhat is run, it searches for the closest `hardhat.config.js` file
starting from the current working directory. This file normally lives in the
root of your project and contains your tasks, compiler settings, and network
configuration.

## QRL Hardhat's architecture

QRL Hardhat is designed around the concepts of **tasks**, the **Hardhat Runtime
Environment**, and QRL network providers.

### Tasks

Every time you run QRL Hardhat from the CLI you are running a task. For example,
`npx hardhat compile` runs the `compile` task. To see the currently available
tasks in your project, run:

```sh
npx hardhat
```

You can inspect a task with:

```sh
npx hardhat help compile
```

::: tip
You can create your own tasks. Check out the
[Creating a task](../guides/create-task.md) guide.
:::

### Runtime helpers

QRL Hardhat exposes QRL-specific helpers through the Hardhat Runtime
Environment. In tests, scripts, and tasks you will use `qrl` to deploy
contracts, get contract instances, encode calls, and wait for transaction
receipts.

The most common helpers are:

```js
const Factory = await qrl.getContractFactory("Token");
const deployment = await Factory.deploy({ from });
const token = await qrl.getContractAt("Token", deployment.address);
```

You will use these helpers throughout the rest of the tutorial.

