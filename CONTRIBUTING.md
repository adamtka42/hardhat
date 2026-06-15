# Contributing to QRL Hardhat

This repository contains the QRL-only Hardhat port based on the upstream
Hardhat/Buidler v1.3.3 codebase.

## Project Structure

The active package is `packages/buidler-core`, published as `@theqrl/hardhat`.
The fork intentionally targets QRL/Zond only. Do not add dual Ethereum/QRL
paths unless the boundary is an unmodified external dependency.

## Install

Run this from the repository root:

```sh
npm install
```

## Build And Test

For the active core package:

```sh
cd packages/buidler-core
npm run build-test
npm run lint
npm test
```

The root scripts still delegate through the workspace, but most day-to-day work
should be verified directly in `packages/buidler-core`.

## Development Rules

- Keep commits functional and reviewable.
- Prefer QRL-native names, RPC methods, address handling, and signing paths.
- Avoid reintroducing legacy in-memory EVM support; live go-qrl HTTP networks
  are the supported execution target for now.
- Keep temporary local package workarounds out of commits.
