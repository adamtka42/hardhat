# QRL Hardhat documentation

This directory contains the QRL Hardhat documentation. QRL Hardhat targets
Hyperion `.hyp` contracts, QRL addresses, `qrl_*` JSON-RPC methods, local
in-process tests through `qrlLocal`, and live go-qrl HTTP networks.

## Start here

- [Tutorial](tutorial/README.md): a step-by-step walkthrough for a new QRL
  Hardhat project.
- [Getting started](getting-started.md): a compact setup guide with one sample
  contract, test, and deployment script.
- [Project setup](guides/project-setup.md): project layout, sample project
  files, generated folders, and network choices.
- [Configuration](config/README.md): network, compiler, path, and account
  configuration.

## Core workflows

- [Compiling contracts](guides/compile-contracts.md): Hyperion `.hyp`
  compilation, artifacts, cache files, and compiler options.
- [Writing scripts](guides/scripts.md): deployment and maintenance scripts that
  use `hre.qrl`.
- [Deploying contracts](guides/deploying.md): qrlLocal and HTTP go-qrl
  deployment flows.
- [Using the Hardhat console](guides/buidler-console.md): interactive REPL
  usage with QRL helpers and direct `qrl_*` RPC calls.
- [Creating tasks](guides/create-task.md): custom CLI tasks for QRL projects.

## Networks and tooling

- [qrlLocal](qrl-local/README.md): in-process QRL VM network for local tests.
- [TypeScript projects](guides/typescript.md): TypeScript setup and runtime
  imports.
- [VS Code tests and scripts](guides/vscode-tests.md): debugging test and script
  runs from VS Code.
- [Hardhat Runtime Environment](advanced/hardhat-runtime-environment.md):
  runtime globals, `network.provider`, and `hre.qrl`.

## Troubleshooting

- [Common problems](troubleshooting/common-problems.md): common QRL Hardhat
  setup, network, account, ABI, and gas issues.
- [Verbose logging](troubleshooting/verbose-logging.md): collecting detailed
  logs from tasks, providers, and RPC calls.

## Removed upstream documentation

This fork intentionally does not include the old Ethereum-specific Buidler
documentation for Buidler EVM, Ganache, Truffle, Waffle, Web3.js, Ethers.js,
Infura, or Solidity-only workflows. Use the QRL-specific guides above instead.

