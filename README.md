# QRL Hardhat

QRL Hardhat is a QRL-only smart contract development toolchain based on
Hardhat/Buidler `v1.3.3`.

This repository is intentionally a new project, not a GitHub fork. The first
commit imports the exact upstream `v1.3.3` source tree, and QRL support is added
on top as focused commits.

## Getting Started

Start with [docs/getting-started.md](docs/getting-started.md). It covers
installation, `qrlLocal`, HTTP go-qrl networks, Hyperion `.hyp` contracts, tests,
scripts, and the `hre.qrl` runtime helpers. For the full configuration reference,
see [docs/config/README.md](docs/config/README.md). For compile details, see
[docs/guides/compile-contracts.md](docs/guides/compile-contracts.md). For deployment, see
[docs/guides/deploying.md](docs/guides/deploying.md). For scripts, see
[docs/guides/scripts.md](docs/guides/scripts.md). For TypeScript projects, see
[docs/guides/typescript.md](docs/guides/typescript.md). For task automation, see
[docs/guides/create-task.md](docs/guides/create-task.md). For troubleshooting, see
[docs/troubleshooting/common-problems.md](docs/troubleshooting/common-problems.md).
For verbose logging, see
[docs/troubleshooting/verbose-logging.md](docs/troubleshooting/verbose-logging.md).
For runtime details, see [docs/advanced/hardhat-runtime-environment.md](docs/advanced/hardhat-runtime-environment.md).

## Direction

- Target QRL/Zond, not Ethereum compatibility.
- Prefer direct `qrl_*` JSON-RPC methods over `eth_*` compatibility fallbacks.
- Use QRL addresses (`Q` + 128 hex characters) as the native address format.
- Use ML-DSA-87 wallet signing for local accounts.
- Keep external-library compatibility shims only where avoiding them would
  require forking that external dependency.

## Current State

This branch contains the QRL-specific runtime, Hyperion compilation flow,
QRL address handling, ML-DSA-87 signing, `qrlLocal` in-process testing, and live
go-qrl HTTP provider support. Legacy Ethereum/EVM/Solidity surfaces have been
removed where they are not needed, or rejected explicitly where preserving the
old input boundary makes configuration errors clearer.
