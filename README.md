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

This branch is the clean QRL integration base. The imported upstream code still
contains the original Buidler package names, Ethereum JSON-RPC namespace,
Ethereum address handling, ECDSA signing, and Solidity-first workflow. These
will be replaced incrementally with QRL-specific behavior.

See `QRL_PORT_PLAN.md` for the migration sequence.
