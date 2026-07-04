# Using the Hardhat console

QRL Hardhat includes an interactive JavaScript console. It starts a Node.js REPL
with the Hardhat Runtime Environment loaded, so you can inspect configuration,
query QRL JSON-RPC methods, and interact with deployed Hyperion contracts.

Run it with:

~~~sh
npx hardhat console --network qrlLocal
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
npx hardhat console --network qrlLocal --no-compile
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
'qrlLocal'
> config.defaultNetwork
'qrlLocal'
~~~

If you prefer explicit imports, require the runtime:

~~~js
> const hre = require("@theqrl/hardhat")
undefined
> hre.network.name
'qrlLocal'
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
> const [name] = await token.callStatic.name()
undefined
> name
'My QRL Token'
~~~

Use `callStatic` for simulated calls that do not persist state:

~~~js
> const [balance] = await token.callStatic.balanceOf(from)
undefined
> balance.toString(10)
'1000000'
~~~

Use `functions` for state-changing calls:

~~~js
> const txHash = await token.functions.transfer(process.env.RECIPIENT, 1, { from })
undefined
> await qrl.waitForTransaction(txHash, 300000)
{
  transactionHash: '0x...',
  status: '0x1',
  ...
}
~~~

For overloaded ABI functions, use the full signature:

~~~js
> await resolver.callStatic["addr(bytes32)"](node)
> await resolver.functions["setAddr(bytes32,address)"](node, recipient, { from })
~~~

## Deploying from the console

You can deploy contracts directly from the console while experimenting:

~~~js
> const [from] = await network.provider.send("qrl_accounts")
undefined
> const Token = await qrl.getContractFactory("Token")
undefined
> const deployment = await Token.deploy({ from }, [], { timeoutMs: 300000 })
undefined
> deployment.address
'Q...'
~~~

For repeatable deployments, prefer a script in `scripts/` and run it with
`npx hardhat run`. See [Writing scripts](scripts.md).

## Console history

The console stores command history in:

~~~text
cache/console-history.txt
~~~

The file is local development state and should not be committed.

## Troubleshooting

If `qrlLocal` cannot start, build `qrljs-monorepo` and set
`QRLJS_MONOREPO_PATH`:

~~~sh
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo \
npx hardhat console --network qrlLocal
~~~

If an HTTP network cannot connect, verify `QRL_RPC_URL` with `qrl_chainId`:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

For more common failures, see
[Common problems](../troubleshooting/common-problems.md).

