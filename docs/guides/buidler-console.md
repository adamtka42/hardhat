# Using the Hardhat console

QRL Hardhat includes an interactive JavaScript console. It starts a Node.js REPL
with the Hardhat Runtime Environment loaded, so you can inspect configuration,
query QRL JSON-RPC methods, and interact with deployed Hyperion contracts.

Run it with:

~~~sh
npx hardhat console --network hardhatqrlvm
~~~

or against an HTTP go-qrl network:

~~~sh
QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat console --network qrl
~~~

The console runs the `compile` task before opening the prompt. Skip compilation
with `--no-compile`:

~~~sh
npx hardhat console --network hardhatqrlvm --no-compile
~~~

## Runtime globals

The console has the same runtime globals as tasks, tests, and scripts:

- `config`
- `hardhatArguments`
- `network`
- `run`
- `tasks`
- `qrl`

For example:

~~~js
> network.name
'hardhatqrlvm'
> config.defaultNetwork
'hardhatqrlvm'
~~~

If you prefer explicit imports, require the runtime:

~~~js
> const hre = require("@theqrl/hardhat")
undefined
> hre.network.name
'hardhatqrlvm'
~~~

## Querying QRL JSON-RPC

Use `network.provider.send` for direct `qrl_*` JSON-RPC calls:

~~~js
> await network.provider.send("qrl_chainId")
'0x1'
> await network.provider.send("qrl_accounts")
[
  'Q01010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101'
]
~~~

Some go-qrl methods require the same parameters they require over HTTP. For
example, include a block tag when querying balances:

~~~js
> const [from] = await network.provider.send("qrl_accounts")
undefined
> await network.provider.send("qrl_getBalance", [from, "latest"])
['0x3635c9adc5dea00000']
~~~

## Interacting with contracts

Attach to a deployed contract with `qrl.getContractAt`:

~~~js
> const token = await qrl.getContractAt("Token", process.env.TOKEN_ADDRESS)
undefined
> await token.name()
'My QRL Token'
~~~

Read-only method aliases perform a call and unwrap a single output to a
scalar:

~~~js
> const balance = await token.balanceOf(from)
undefined
> balance.toString(10)
'1000000'
~~~

State-changing aliases send a transaction and return a transaction response
with a receipt-polling `wait()`:

~~~js
> const tx = await token.transfer(process.env.RECIPIENT, 1)
undefined
> await tx.wait(300000)
{
  transactionHash: '0x...',
  status: '0x1',
  ...
}
~~~

The explicit low-level maps are still available: `token.callStatic.name()`
always returns a decoded array, and `token.functions.transfer(...)` returns a
transaction hash string.

For overloaded ABI functions, use the full signature:

~~~js
> await resolver.callStatic["addr(bytes32)"](node)
> await resolver.functions["setAddr(bytes32,address)"](node, recipient, { from })
~~~

## Deploying from the console

You can deploy contracts directly from the console while experimenting:

~~~js
> const Token = await qrl.getContractFactory("Token")
undefined
> const token = await Token.deploy()
undefined
> token.address
'Q...'
> token.deployTransactionHash
'0x...'
~~~

`deploy()` waits for the deployment receipt and returns a ready-to-use
contract wrapper. The sender defaults to the network's `from` config or the
first `qrl_accounts` account.

For repeatable deployments, prefer a script in `scripts/` and run it with
`npx hardhat run`. See [Writing scripts](scripts.md).

## Console history

The console stores command history in:

~~~text
cache/console-history.txt
~~~

The file is local development state and should not be committed.

## Troubleshooting

If `hardhatqrlvm` cannot start, first check whether a development override
(`QRLJS_MONOREPO_PATH` / `qrlJsMonorepoPath`) is set but invalid — unset it or
build the checkout it points to. If no override is set, the bundled runtime in
the installed package may be corrupted; reinstall the package:

~~~sh
npm install @theqrl/hardhat --force
npx hardhat console --network hardhatqrlvm
~~~

If an HTTP network cannot connect, verify `QRL_RPC_URL` with `qrl_chainId`:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

For more common failures, see
[Common problems](../troubleshooting/common-problems.md).

