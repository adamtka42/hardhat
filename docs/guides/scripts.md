# Writing scripts

Scripts are regular JavaScript files that use the Hardhat Runtime Environment to
compile, deploy, query, and maintain QRL contracts. They are useful for
deployments, admin actions, migrations, smoke tests, and one-off network checks.

The recommended way to run a script is through QRL Hardhat:

~~~sh
npx hardhat run scripts/deploy.js --network hardhatqrlvm
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
  const Sample = await qrl.getContractFactory("Sample");
  const sample = await Sample.deploy();

  console.log("Transaction:", sample.deployTransactionHash);
  console.log("Contract:", sample.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

`deploy()` waits for the deployment receipt and returns a ready-to-use
contract wrapper. The sender defaults to the network's `from` config or the
first `qrl_accounts` account.

Run it on `hardhatqrlvm`:

~~~sh
npx hardhat run scripts/deploy.js --network hardhatqrlvm
~~~

Run it on an HTTP network:

~~~sh
QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.js --network qrl
~~~

`deploy` takes transaction overrides first and constructor arguments second.
The second argument is either constructor arguments or pre-encoded constructor
data. For a constructor with arguments:

~~~js
const token = await Token.deploy(
  { gas: 15000000 },
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

  const name = await token.name();
  const balance = await token.balanceOf(from);

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

Read-only method aliases perform a call and unwrap a single output to a
scalar. The explicit `callStatic` map remains the low-level simulation layer;
it always returns a decoded array and must not persist state changes.

## Sending a transaction

Call state-changing methods directly on the contract wrapper. They send a
transaction and return a transaction response with a receipt-polling `wait()`:

~~~js
async function main() {
  const token = await qrl.getContractAt("Token", process.env.TOKEN_ADDRESS);

  const tx = await token.transfer(process.env.RECIPIENT, 100, {
    gas: 15000000,
  });

  const receipt = await tx.wait(300000);
  console.log("Transfer mined in transaction:", receipt.transactionHash);
}
~~~

Aliases accept the ABI arguments followed by an optional transaction overrides
object, and resolve a default sender from the network's `from` config or the
first `qrl_accounts` account.

The explicit maps remain the low-level layer and do not resolve a default
sender. Use `contract.functions` for hash-returning state-changing calls,
`contract.send` if you always want to send a transaction, even for ABI
functions that look read-only, and `contract.callStatic` if you always want a
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

  const Sample = await hre.qrl.getContractFactory("Sample");
  const sample = await Sample.deploy();

  console.log(sample.address);
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
- `QRLJS_MONOREPO_PATH`: optional development override — a built
  `qrljs-monorepo` checkout replacing the runtime bundled with the package.
- `HYPERION_HYPC_PATH`: local Hyperion compiler binary.
- `HYPERION_COMPILER_REPOSITORY_URL`: optional HTTP(S) Hyperion compiler
  repository.
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

HTTP/private QRL networks can be slower than `hardhatqrlvm`. Pass a larger timeout
when waiting for deployment or transaction receipts:

~~~js
const sample = await Sample.deploy({}, [], { timeoutMs: 300000 });
const receipt = await tx.wait(300000);
const rawReceipt = await qrl.waitForTransaction(txHash, 300000);
~~~

Mocha tests use `mocha.timeout` from config, but scripts should pass explicit
wait timeouts where needed.

## What not to use

Old upstream Buidler examples often use Ethers.js, Web3.js, Waffle, Truffle,
Ganache, Solidity contracts, Ethereum addresses, and `eth_*` JSON-RPC methods.
Those examples are not the QRL Hardhat scripting surface.

Use Hyperion `.hyp` contracts, QRL addresses, QRL extended seeds, `hre.qrl`, and
`qrl_*` JSON-RPC methods instead.
