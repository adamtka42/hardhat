# QRL Hardhat

QRL Hardhat is a QRL-only smart contract development tool based on the upstream
v1.3.3 codebase.

This fork targets live go-qrl HTTP networks and Hyperion `.hyp` contracts only.
The legacy in-memory development network is intentionally unsupported.

## Installation

```sh
npm install --save-dev @theqrl/hardhat
```

## Usage

Create a `hardhat.config.js` file and configure a live go-qrl network:

```js
module.exports = {
  defaultNetwork: "localhost",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: "remote",
    },
  },
};
```

Run tasks with:

```sh
npx hardhat compile
npx hardhat test
npx hardhat run scripts/sample-script.js --network localhost
```

Local signing uses QRL extended seeds and ML-DSA-87 via
`@theqrl/web3-qrl-accounts`. Legacy mnemonic and raw-key account configs are
intentionally unsupported.
