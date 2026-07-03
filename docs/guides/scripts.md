# Writing scripts

Scripts are regular JavaScript files that use the Hardhat Runtime Environment to
compile, deploy, query, and maintain QRL contracts. They are useful for
deployments, admin actions, migrations, smoke tests, and one-off network checks.

The recommended way to run a script is through QRL Hardhat:

~~~sh
npx hardhat run scripts/deploy.js --network qrlLocal
~~~

or against an HTTP go-qrl network:

~~~sh
QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
~~~

`hardhat run` compiles the project first, creates the selected network provider,
and injects the runtime fields into the script global scope.

## Script structure

A script should usually define an async `main` function and exit explicitly:

~~~js
async function main() {
  const [from] = await network.provider.send("qrl_accounts");
  console.log("Deploying from:", from);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

When run through `hardhat run`, these globals are available:

- `config`
- `hardhatArguments`
- `network`
- `run`
- `tasks`
- `qrl`

For explicit style, import the runtime instead:

~~~js
const hre = require("@theqrl/hardhat");

async function main() {
  const [from] = await hre.network.provider.send("qrl_accounts");
  console.log("Deploying from:", from);
}
~~~

## Deploying a contract

Create `scripts/deploy.js`:

~~~js
async function main() {
  const [from] = await network.provider.send("qrl_accounts");
  const Sample = await qrl.getContractFactory("Sample");

  const deployment = await Sample.deploy({ from }, [], {
    timeoutMs: 300000,
  });

  console.log("Transaction:", deployment.hash);
  console.log("Contract:", deployment.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

Run it on `qrlLocal`:

~~~sh
npx hardhat run scripts/deploy.js --network qrlLocal
~~~

Run it on an HTTP network:

~~~sh
QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
~~~

The second `deploy` argument is either constructor arguments or pre-encoded
constructor data. For a constructor with arguments:

~~~js
const deployment = await Token.deploy(
  { from, gas: 15000000 },
  ["Example Token", "EXT", 18],
  { timeoutMs: 300000 }
);
~~~

## Calling a deployed contract

Attach to a deployed contract with `qrl.getContractAt`:

~~~js
async function main() {
  const [from] = await network.provider.send("qrl_accounts");
  const token = await qrl.getContractAt("Token", process.env.TOKEN_ADDRESS);

  const [name] = await token.callStatic.name();
  const [balance] = await token.callStatic.balanceOf(from);

  console.log("Name:", name);
  console.log("Balance:", balance.toString(10));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

`callStatic` simulates execution and decodes return values. It must not persist
state changes.

## Sending a transaction

Use `contract.functions` for normal contract interactions. State-changing
functions send a transaction and return the transaction hash:

~~~js
async function main() {
  const [from] = await network.provider.send("qrl_accounts");
  const token = await qrl.getContractAt("Token", process.env.TOKEN_ADDRESS);

  const txHash = await token.functions.transfer(process.env.RECIPIENT, 100, {
    from,
    gas: 15000000,
  });

  const receipt = await qrl.waitForTransaction(txHash, 300000);
  console.log("Transfer mined in transaction:", receipt.transactionHash);
}
~~~

Use `contract.send` if you always want to send a transaction, even for ABI
functions that look read-only. Use `contract.callStatic` if you always want a
simulation.

## Raw transaction and call helpers

For lower-level scripts, encode calldata yourself and use `qrl.sendTransaction`
or `qrl.call`:

~~~js
async function main() {
  const [from] = await network.provider.send("qrl_accounts");
  const token = await qrl.getContractAt("Token", process.env.TOKEN_ADDRESS);

  const data = token.encodeFunctionData("transfer", [process.env.RECIPIENT, 1]);
  const txHash = await qrl.sendTransaction({
    from,
    to: token.address,
    data,
    gas: 15000000,
  });

  await qrl.waitForTransaction(txHash, 300000);
}
~~~

For read-only calls:

~~~js
const data = token.encodeFunctionData("balanceOf", [from]);
const result = await qrl.call({ to: token.address, data }, "latest");
const [balance] = token.decodeFunctionResult("balanceOf", result);
~~~

## Running tasks from scripts

Use `run` to invoke another Hardhat task:

~~~js
async function main() {
  await run("compile");
  const [from] = await network.provider.send("qrl_accounts");
  console.log(from);
}
~~~

`hardhat run` already runs compile before the script. Calling `run("compile")`
can still be useful in standalone scripts that import `@theqrl/hardhat`
directly.

## Standalone scripts

You can execute a script with `node` if it imports QRL Hardhat explicitly:

~~~js
const hre = require("@theqrl/hardhat");

async function main() {
  await hre.run("compile");

  const [from] = await hre.network.provider.send("qrl_accounts");
  const Sample = await hre.qrl.getContractFactory("Sample");
  const deployment = await Sample.deploy({ from }, [], {
    timeoutMs: 300000,
  });

  console.log(deployment.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

Run it with:

~~~sh
node scripts/deploy-standalone.js
~~~

Use `HARDHAT_DEFAULT_NETWORK` or the config default to select the network when
not using the Hardhat CLI.

## Network environment

Common environment variables for scripts:

- `QRL_RPC_URL`: HTTP go-qrl endpoint.
- `QRL_ACCOUNT_SEED`: local QRL extended seed used to sign HTTP network
  transactions.
- `QRLJS_MONOREPO_PATH`: built `qrljs-monorepo` checkout used by `qrlLocal`.
- `HYPERION_HYPC_PATH`: local Hyperion compiler binary.
- `HARDHAT_DEFAULT_NETWORK`: default network override if your config uses it.

Private devnets often expose dynamic Docker or Kurtosis ports. Check the current
host port and pass it with `QRL_RPC_URL` instead of hardcoding a machine-specific
port in committed config.

Do not commit real QRL extended seeds. Keep them in environment variables or a
local secret manager.

## Overloaded functions

If a contract has overloaded ABI functions, use the full canonical signature:

~~~js
await resolver.functions["setAddr(bytes32,address)"](node, recipient, {
  from,
});

const [resolved] = await resolver.callStatic["addr(bytes32)"](node);
~~~

Unambiguous functions are also available by name.

## Timeouts

HTTP/private QRL networks can be slower than `qrlLocal`. Pass a larger timeout
when waiting for deployment or transaction receipts:

~~~js
const deployment = await Sample.deploy({ from }, [], { timeoutMs: 300000 });
const receipt = await qrl.waitForTransaction(txHash, 300000);
~~~

Mocha tests use `mocha.timeout` from config, but scripts should pass explicit
wait timeouts where needed.

## What not to use

Old upstream Buidler examples often use Ethers.js, Web3.js, Waffle, Truffle,
Ganache, Solidity contracts, Ethereum addresses, and `eth_*` JSON-RPC methods.
Those examples are not the QRL Hardhat scripting surface.

Use Hyperion `.hyp` contracts, QRL addresses, QRL extended seeds, `hre.qrl`, and
`qrl_*` JSON-RPC methods instead.
