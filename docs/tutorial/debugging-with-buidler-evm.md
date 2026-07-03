# 6. Debugging with qrlLocal

QRL Hardhat includes **qrlLocal**, an in-process QRL VM network designed for
development. It lets you deploy contracts and run tests without starting a
go-qrl node.

## Running focused tests

Mocha lets you run a single test file or focus a single test while debugging:

```sh
npx hardhat test test/Token.js --network qrlLocal
```

You can also temporarily use `.only` in a test:

```js
it.only("Should transfer tokens between accounts", async function () {
  // ...
});
```

Remove `.only` before committing.

## Verbose logging

Use verbose Hardhat logging when you need to see more detail from task and
provider execution:

```sh
HARDHAT_VERBOSE=true npx hardhat test --network qrlLocal
```

For more details, see
[Verbose logging](../troubleshooting/verbose-logging.md).

## Inspecting transactions

State-changing contract methods return a transaction hash. You can wait for the
receipt and print it from your test or script:

```js
const txHash = await token.functions.transfer(addr1, 50, { from: owner });
const receipt = await qrl.waitForTransaction(txHash);

console.log("Transaction:", txHash);
console.log("Status:", receipt.status);
console.log("Gas used:", receipt.gasUsed.toString());
```

This is the QRL equivalent of checking whether a transaction was mined
successfully.

## Debugging scripts in VS Code

QRL Hardhat tests and scripts can be debugged with Node.js launch
configurations. See [VS Code tests and scripts](../guides/vscode-tests.md) for
ready-to-use launch configuration examples.

## Common qrlLocal failures

If qrlLocal cannot load the local VM packages, build `qrljs-monorepo` and set
`QRLJS_MONOREPO_PATH`:

```sh
cd /path/to/qrljs-monorepo
npm run build --workspaces --if-present
npm run tsc

export QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
npx hardhat test --network qrlLocal
```

If you see invalid address errors, check that all addresses use the QRL format:
`Q` followed by 128 hexadecimal characters.

