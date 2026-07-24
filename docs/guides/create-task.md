# Creating tasks

Tasks are named actions that can be run from the QRL Hardhat CLI. Built-in
commands like `compile`, `test`, `clean`, and `run` are tasks. Projects can add
their own tasks in `hardhat.config.js` to automate contract operations, network
checks, deployment steps, and maintenance workflows.

This guide uses QRL-specific examples. It does not use Ethers.js, Web3.js,
Waffle, Truffle, Ethereum addresses, or `eth_*` JSON-RPC methods.

## Defining a task

A simple task can be defined directly in `hardhat.config.js`:

~~~js
task("accounts", "Prints QRL accounts", async (_, { network }) => {
  const accounts = await network.provider.send("qrl_accounts");

  for (const address of accounts) {
    console.log(address);
  }
});

module.exports = {
  networks: {
    hardhatqrlvm: {
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      accounts: [{ address: "Q" + "01".repeat(64), balance: "1000000000" }],
    },
  },
};
~~~

Run it with:

~~~sh
npx hardhat accounts --network hardhatqrlvm
~~~

A task action receives two useful arguments:

- `taskArgs`: parsed task arguments,
- `hre`: the Hardhat Runtime Environment.

The example destructures `{ network }` from the HRE.

## Accessing the HRE

The second action argument is the full HRE:

~~~js
task("network-info", "Prints selected QRL network info").setAction(
  async (_, hre) => {
    const chainId = await hre.network.provider.send("qrl_chainId");

    console.log("Network:", hre.network.name);
    console.log("Chain id:", chainId);
  }
);
~~~

The HRE exposes:

- `config`
- `hardhatArguments`
- `network`
- `run`
- `tasks`
- `qrl`

Use `hre.qrl` for contract helpers and `hre.network.provider.send` for direct
`qrl_*` JSON-RPC calls.

## Parameters

Use `.addParam` for required named parameters:

~~~js
task("balance", "Prints a QRL account balance")
  .addParam("account", "QRL account address")
  .setAction(async ({ account }, { network }) => {
    const [balance] = await network.provider.send("qrl_getBalance", [
      account,
      "latest",
    ]);

    console.log(balance.toString());
  });
~~~

Run it with:

~~~sh
npx hardhat balance --account Q... --network qrl
~~~

For go-qrl compatibility, include the block tag for `qrl_getBalance`; `latest`
is the normal choice.

## Optional parameters and types

Use `.addOptionalParam` with `types` when you want parsing and validation:

~~~js
task("balance", "Prints a QRL account balance")
  .addParam("account", "QRL account address")
  .addOptionalParam("block", "Block tag", "latest")
  .addFlag("decimal", "Print the balance as a decimal string")
  .setAction(async ({ account, block, decimal }, { network }) => {
    const [balance] = await network.provider.send("qrl_getBalance", [
      account,
      block,
    ]);

    if (decimal) {
      console.log(BigInt(balance).toString(10));
    } else {
      console.log(balance);
    }
  });
~~~

Available task argument types include:

- `types.string`
- `types.boolean`
- `types.int`
- `types.float`
- `types.inputFile`
- `types.json`

Example with an integer parameter:

~~~js
const { task, types } = require("@theqrl/hardhat/config");

task("wait-blocks", "Waits for a number of blocks")
  .addOptionalParam("count", "Number of blocks", 1, types.int)
  .setAction(async ({ count }) => {
    console.log("Blocks to wait:", count);
  });
~~~

When writing tasks in `hardhat.config.js`, `task` is available globally. Import
from `@theqrl/hardhat/config` if you prefer explicit config files or need
`types`.

## Positional parameters

Use positional parameters when the command reads naturally without names:

~~~js
task("receipt", "Prints a transaction receipt")
  .addPositionalParam("hash", "Transaction hash")
  .setAction(async ({ hash }, { network }) => {
    const receipt = await network.provider.send("qrl_getTransactionReceipt", [
      hash,
    ]);

    console.log(JSON.stringify(receipt, null, 2));
  });
~~~

Run it with:

~~~sh
npx hardhat receipt 0xabc123 --network qrl
~~~

## Deploying from a task

Tasks can use `hre.qrl` just like scripts and tests:

~~~js
task("deploy-sample", "Deploys the Sample contract")
  .addOptionalParam("value", "Initial value", 0, types.int)
  .setAction(async ({ value }, { qrl }) => {
    const Sample = await qrl.getContractFactory("Sample");

    const sample = await Sample.deploy({}, [value], {
      timeoutMs: 300000,
    });

    console.log("Transaction:", sample.deployTransactionHash);
    console.log("Contract:", sample.address);
  });
~~~

`deploy` takes transaction overrides first and constructor arguments second,
resolves its sender from the network's `from` config or the first
`qrl_accounts` account, and returns a ready-to-use contract wrapper.

Run it with:

~~~sh
npx hardhat deploy-sample --value 42 --network hardhatqrlvm
~~~

For HTTP networks, set `QRL_RPC_URL` and either `QRL_ACCOUNT_SEED` or
`accounts: "remote"` in config.

## Calling other tasks

Use `hre.run` to call another task:

~~~js
task("compile-and-deploy", "Compiles and deploys Sample").setAction(
  async (_, hre) => {
    await hre.run("compile");
    await hre.run("deploy-sample", { value: 42 });
  }
);
~~~

This is useful when composing a larger workflow from smaller tasks.

## Overriding tasks

Defining a task with the same name as an existing task overrides it. The third
action argument, `runSuper`, calls the previous implementation:

~~~js
task("compile", "Compiles and prints a project message").setAction(
  async (args, hre, runSuper) => {
    console.log("Starting Hyperion compilation");

    if (runSuper.isDefined) {
      await runSuper(args);
    }

    console.log("Compilation finished");
  }
);
~~~

Task overrides cannot remove existing parameters. Keep overrides small and avoid
changing built-in behavior unless the project really needs it.

## Internal tasks

Use `internalTask` for helper tasks that should not appear in the normal help
output:

~~~js
const { internalTask, task } = require("@theqrl/hardhat/config");

internalTask("project:get-deployer", "Returns the deployer account").setAction(
  async (_, { network }) => {
    const [from] = await network.provider.send("qrl_accounts");
    return from;
  }
);

task("print-deployer", "Prints the deployer account").setAction(
  async (_, { run }) => {
    const deployer = await run("project:get-deployer");
    console.log(deployer);
  }
);
~~~

Internal tasks are useful when you want user-facing tasks to share smaller,
testable steps.

## Environment extenders

Advanced projects and plugins can extend the HRE with `extendEnvironment`:

~~~js
const { extendEnvironment } = require("@theqrl/hardhat/config");

extendEnvironment((hre) => {
  hre.projectName = "example";
});
~~~

Use this sparingly in project configs. For most project automation, ordinary
tasks are simpler and easier to reason about.

## Task naming

Use short names for user-facing commands, such as `accounts`, `balance`, or
`deploy-sample`.

Use namespaced names for internal or workflow-specific tasks, such as
`project:get-deployer` or `deploy:sample`.

## Error handling

Task actions can throw regular JavaScript errors. QRL Hardhat prints the error
and exits with a non-zero code.

Common task failures include:

- no RPC endpoint available for the selected HTTP network,
- no deployer account returned by `qrl_accounts`,
- a `from` account that is not managed by Hardhat or the connected node,
- a missing compiled artifact,
- a receipt timeout on slow private networks.

For deployment-specific troubleshooting, see [deploying.md](deploying.md).

## What not to use

Old upstream task examples often use Web3.js, Ethers.js, Waffle, Truffle,
Ganache, Ethereum addresses, Solidity contracts, and `eth_*` JSON-RPC methods.
Those examples are not the QRL Hardhat task surface.

Use QRL addresses, Hyperion `.hyp` artifacts, `hre.qrl`, and `qrl_*` JSON-RPC
methods instead.
