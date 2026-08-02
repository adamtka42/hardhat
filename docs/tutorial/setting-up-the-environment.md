---
prev: false
---

# 1. Setting up the environment

Most smart contract development tooling is written in JavaScript, and so is QRL
Hardhat. If you are not familiar with Node.js, it is a JavaScript runtime used
to run JavaScript outside of a web browser.

## Installing Node.js

You can skip this section if you already have a working Node.js 20 or later
installation. If not, install Node.js with your operating system package
manager or with a version manager such as `nvm`.

### Linux

On Ubuntu, install the basic development tools first:

```sh
sudo apt update
sudo apt install curl git build-essential
```

Then install Node.js 20 or later using your preferred distribution package or
NodeSource setup.

### MacOS

Make sure you have git installed. You can install Node.js with `nvm`:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
nvm alias default 20
npm install npm --global
```

If native dependencies fail to build, install the Xcode command-line tools:

```sh
xcode-select --install
```

### Windows

Install Git for Windows and Node.js 20 or later from the official Node.js
download page. Use PowerShell, Windows Terminal, or WSL for the commands in
this tutorial.

## Checking your environment

To make sure your development environment is ready, run:

```sh
node --version
npm --version
git --version
```

Node.js should report version 20 or later.

QRL Hardhat compiles Hyperion `.hyp` contracts. Make sure the Hyperion compiler
required by your checkout is available before compiling a project.

Installed packages include the QRL VM runtime, so local in-process tests need
no extra setup. Only when developing qrljs itself, build a checkout and expose
it as an override:

```sh
cd /path/to/qrljs-monorepo
npm install
npm run build --workspaces --if-present
npm run tsc
```

Then expose it to QRL Hardhat:

```sh
export QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo
```

For HTTP/private-network tests you need a running go-qrl JSON-RPC endpoint and,
when using local signing, a QRL extended seed in `QRL_ACCOUNT_SEED`.

## Upgrading your Node.js installation

If your Node.js version is older than 20, upgrade it before continuing. With
`nvm`, this is:

```sh
nvm install 20
nvm use 20
nvm alias default 20
```

After upgrading, go back to [Checking your environment](#checking-your-environment).

