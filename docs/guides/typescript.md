# TypeScript projects

QRL Hardhat can load TypeScript config files, discover TypeScript tests, and run
TypeScript scripts when `typescript` and `ts-node` are installed in the project.
This support is for QRL and Hyperion workflows; it does not add Ethers, Waffle,
Truffle, Solidity, or Ethereum-specific plugins.

## Install TypeScript support

Install QRL Hardhat together with TypeScript and ts-node:

~~~sh
npm install --save-dev @theqrl/hardhat typescript ts-node
~~~

Add Node.js and Mocha types if your config, tests, or scripts use Node
globals such as `process`, or Mocha globals such as `describe` and `it`:

~~~sh
npm install --save-dev @types/node @types/mocha
~~~

TypeScript support is detected from the local project installation. Do not rely
on a global Hardhat installation for TypeScript projects.

## tsconfig.json

A small project config is enough for Hardhat config files, tests, and scripts:

~~~json
{
  "compilerOptions": {
    "target": "es2019",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "types": ["node", "mocha"]
  },
  "include": ["hardhat.config.ts", "scripts", "test"]
}
~~~

QRL Hardhat sets `TS_NODE_FILES=true` when it loads TypeScript support, so
`ts-node` reads files from `tsconfig.json` during config, task, and script
execution.

## hardhat.config.ts

Use `hardhat.config.ts` instead of `hardhat.config.js`:

~~~ts
import { task } from "@theqrl/hardhat/config";

const localAccountAddress = "Q" + "01".repeat(64);
const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

task("accounts", "Prints QRL accounts", async (_, { network }) => {
  const qrlAccounts = await network.provider.send("qrl_accounts");
  for (const address of qrlAccounts) {
    console.log(address);
  }
});

export default {
  defaultNetwork: process.env.HARDHAT_DEFAULT_NETWORK || "qrlLocal",
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [
        {
          address: localAccountAddress,
          balance: "1000000000000000000000000",
        },
      ],
      blockGasLimit: 30000000,
    },
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
    },
  },
};
~~~

QRL Hardhat looks for `hardhat.config.ts` before `hardhat.config.js` when
TypeScript support is available.

## TypeScript tests

The `test` task discovers both `.js` and `.ts` files under the configured tests
path:

~~~text
test/
  sample-test.ts
~~~

For type-checked tests, import the runtime object explicitly:

~~~ts
import { strict as assert } from "assert";
import hre from "@theqrl/hardhat";

describe("network", function () {
  it("returns QRL accounts", async function () {
    const accounts = await hre.network.provider.send("qrl_accounts");
    assert.ok(Array.isArray(accounts));
  });
});
~~~

Run it like any other QRL Hardhat test:

~~~sh
npx hardhat test --network qrlLocal
~~~

Hardhat also injects runtime globals such as `network` and `qrl` when tests
run, but explicit `hre` imports are easier to type-check in strict projects.

## TypeScript scripts

TypeScript scripts can be run with `hardhat run`:

~~~ts
import hre from "@theqrl/hardhat";

async function main() {
  const [from] = await hre.network.provider.send("qrl_accounts");
  const Sample = await hre.qrl.getContractFactory("Sample");

  const deployment = await Sample.deploy({ from }, [], {
    timeoutMs: 300000,
  });

  console.log("Contract:", deployment.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
~~~

Run the script with the selected QRL network:

~~~sh
npx hardhat run scripts/deploy.ts --network qrlLocal

QRL_RPC_URL=http://127.0.0.1:33462 \
QRL_ACCOUNT_SEED=<qrl-extended-seed> \
npx hardhat run scripts/deploy.ts --network qrl
~~~

## Limitations

- TypeScript support depends on local `typescript` and `ts-node` packages.
- The global Hardhat execution mode does not enable TypeScript project support.
- This fork does not provide Ethereum plugin type extensions such as Ethers or
  Waffle helpers.
- QRL contract helpers live under `hre.qrl` and use QRL addresses and `qrl_*`
  JSON-RPC methods.
