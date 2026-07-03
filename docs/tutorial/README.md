---
prev: false
---

# QRL Hardhat tutorial for beginners

Welcome to this beginner guide to QRL smart contract development. This
tutorial is aimed at developers who want to get a small Hyperion contract
compiled, tested, and deployed with QRL Hardhat.

To orchestrate this process we are going to use **QRL Hardhat**, a QRL-only
smart contract development toolchain based on the upstream Hardhat/Buidler
codebase. It helps developers manage recurring tasks like compiling contracts,
running tests, writing deployment scripts, and connecting to local or remote QRL
networks.

QRL Hardhat also includes **qrlLocal**, an in-process QRL VM network designed
for development. It lets you deploy contracts, run tests, and call contracts
without starting a go-qrl node.

In this tutorial we will guide you through:

- Setting up your Node.js environment for QRL development
- Creating and configuring a QRL Hardhat project
- The basics of a Hyperion smart contract that implements a simple token
- Writing automated tests for your contract using `hre.qrl` and Mocha
- Debugging tests and scripts with qrlLocal and verbose logging
- Deploying your contract to qrlLocal and an HTTP go-qrl network

To follow this tutorial you should be able to:

- Write code in JavaScript
- Operate a terminal
- Use git
- Understand the basics of how smart contracts work
- Run or connect to a QRL development network when deploying outside qrlLocal

If you cannot do any of the above, take some time to learn the basics first.

