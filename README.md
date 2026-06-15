# QRL Hardhat

QRL Hardhat is a QRL-only smart contract development toolchain based on
Hardhat/Buidler `v1.3.3`.

This repository is intentionally a new project, not a GitHub fork. The first
commit imports the exact upstream `v1.3.3` source tree, and QRL support is added
on top as focused commits.

## Direction

- Target QRL/Zond, not Ethereum compatibility.
- Prefer direct `qrl_*` JSON-RPC methods over `eth_*` compatibility fallbacks.
- Use QRL addresses (`Q` + 128 hex characters) as the native address format.
- Use ML-DSA-87 wallet signing for local accounts.
- Keep external-library compatibility shims only where avoiding them would
  require forking that external dependency.

## Current State

This branch contains the QRL-specific runtime, Hyperion compilation flow,
QRL address handling, ML-DSA-87 signing, and live go-qrl HTTP provider support.
Legacy Ethereum/EVM/Solidity surfaces have been removed where they are not
needed, or rejected explicitly where preserving the old input boundary makes
configuration errors clearer.
