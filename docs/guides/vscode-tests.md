# VS Code test and script debugging

VS Code can debug QRL Hardhat tests and scripts by launching the local Hardhat
CLI with Node.js. This guide uses plain VS Code Node launch configurations; it
does not require Ethereum-specific extensions, Ethers, Waffle, Truffle, or
Solidity tooling.

## Prerequisites

Install QRL Hardhat in the project and make sure normal CLI commands work first:

~~~sh
npx hardhat test --network qrlLocal
npx hardhat run scripts/deploy.js --network qrlLocal
~~~

For TypeScript projects, also install `typescript` and `ts-node`; see
[typescript.md](typescript.md).

Installed packages run `qrlLocal` out of the box. To override the bundled
runtime for development, configure a built `qrljs-monorepo` checkout with either
`QRLJS_MONOREPO_PATH` or `networks.qrlLocal.qrlJsMonorepoPath`.

## Environment files

Do not put real account seeds in `.vscode/launch.json`. Use an ignored env file
for machine-local values:

~~~text
# .env.local
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
QRL_RPC_URL=http://127.0.0.1:33462
QRL_ACCOUNT_SEED=<qrl-extended-seed>
~~~

Add it to `.gitignore`:

~~~text
.env.local
~~~

## Launch configuration

Create `.vscode/launch.json` in the project:

~~~json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Hardhat: test qrlLocal",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/node_modules/@theqrl/hardhat/internal/cli/cli.js",
      "args": [
        "test",
        "--network",
        "qrlLocal",
        "--show-stack-traces"
      ],
      "envFile": "${workspaceFolder}/.env.local",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Hardhat: test current file",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/node_modules/@theqrl/hardhat/internal/cli/cli.js",
      "args": [
        "test",
        "${file}",
        "--network",
        "qrlLocal",
        "--show-stack-traces"
      ],
      "envFile": "${workspaceFolder}/.env.local",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Hardhat: run script qrlLocal",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/node_modules/@theqrl/hardhat/internal/cli/cli.js",
      "args": [
        "run",
        "scripts/deploy.js",
        "--network",
        "qrlLocal",
        "--show-stack-traces"
      ],
      "envFile": "${workspaceFolder}/.env.local",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Hardhat: test HTTP qrl",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/node_modules/@theqrl/hardhat/internal/cli/cli.js",
      "args": [
        "test",
        "--network",
        "qrl",
        "--show-stack-traces"
      ],
      "envFile": "${workspaceFolder}/.env.local",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
~~~

Change `scripts/deploy.js` to `scripts/deploy.ts` in TypeScript projects.
QRL Hardhat loads `ts-node` when TypeScript support is available.

## Breakpoints

Set breakpoints in test files, scripts, tasks, or `hardhat.config.js` /
`hardhat.config.ts`. Then start one of the launch configurations from VS Code's
Run and Debug panel.

For tests, the selected file must be under the configured `paths.tests`
directory, unless you pass the file explicitly as shown in `Hardhat: test
current file`.

## Debugging child scripts

`hardhat run` executes the target script in a child Node process with
`hardhat/register` loaded. QRL Hardhat adjusts inherited `--inspect-brk=<port>`
arguments to `--inspect` for child scripts, which avoids a debugger port conflict
between the CLI process and the script process.

If VS Code stops in the Hardhat CLI but not in your script, enable auto attach in
VS Code or attach to the child process that appears in the JavaScript debug
terminal.

## Verbose logs

Add `--verbose` to `args` when debugging Hardhat internals:

~~~json
"args": ["test", "--network", "qrlLocal", "--verbose", "--show-stack-traces"]
~~~

For narrower logs, set `DEBUG` in `.env.local`:

~~~text
DEBUG=hardhat:core:*
~~~

See [../troubleshooting/verbose-logging.md](../troubleshooting/verbose-logging.md)
for the logging details.

## Common issues

If VS Code reports that it cannot find the program path, run `npm install` in
the project and confirm this file exists:

~~~text
node_modules/@theqrl/hardhat/internal/cli/cli.js
~~~

If `qrlLocal` fails with `BDLR123`, the configured override is invalid —
build the `qrljs-monorepo` checkout it points to (or unset it) and check
`QRLJS_MONOREPO_PATH`.

If an HTTP network fails with `BDLR109`, check that `QRL_RPC_URL` points at a
running go-qrl JSON-RPC endpoint.

If TypeScript files are not loaded, confirm that `typescript` and `ts-node` are
installed locally in the project.
