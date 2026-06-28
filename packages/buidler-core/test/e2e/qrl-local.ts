import { assert } from "chai";
import { execFile } from "child_process";
import fsExtra from "fs-extra";
import path from "path";
import { promisify } from "util";

import { useTmpDir } from "../helpers/fs";

const execFileAsync = promisify(execFile);

const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const HARDHAT_ROOT = path.join(PACKAGE_ROOT, "..", "..");
const ZOND_ROOT = path.dirname(HARDHAT_ROOT);
const LOCAL_HYPC_PATH = path.join(
  ZOND_ROOT,
  "hyperion",
  "build",
  "hypc",
  "hypc"
);
const LOCAL_QRLJS_MONOREPO_PATH = path.join(
  path.dirname(ZOND_ROOT),
  "qrljs-monorepo"
);

describe("QRL local e2e", function () {
  useTmpDir("qrl-local-e2e");

  it("runs scripts and tests against the in-memory qrlLocal provider", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (hypcPath === undefined) {
      this.skip();
      return;
    }

    if (qrlJsMonorepoPath === undefined) {
      this.skip();
      return;
    }

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath!,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath!,
    };

    const accountsResult = await runHardhat(this.tmpDir, env, ["accounts"]);
    assert.include(accountsResult.stdout, "Q010101");

    const runResult = await runHardhat(this.tmpDir, env, [
      "run",
      "scripts/qrl-local-e2e.js",
    ]);
    assert.include(runResult.stdout, "Stored value: 42");

    const explicitRunResult = await runHardhat(this.tmpDir, env, [
      "run",
      "scripts/qrl-local-e2e.js",
      "--network",
      "qrlLocal",
    ]);
    assert.include(explicitRunResult.stdout, "Stored value: 42");

    const testResult = await runHardhat(this.tmpDir, env, [
      "test",
      "test/qrl-local-e2e.js",
    ]);
    assert.include(testResult.stdout, "1 passing");

    const pendingTestResult = await runHardhat(this.tmpDir, env, [
      "test",
      "test/qrl-local-pending.js",
      "--network",
      "qrlManual",
    ]);
    assert.include(pendingTestResult.stdout, "1 passing");

    const badRuntimeResult = await expectHardhatFailure(
      this.tmpDir,
      {
        ...env,
        QRLJS_MONOREPO_PATH: "/tmp/missing-qrljs-monorepo",
      },
      ["accounts"]
    );
    assert.include(badRuntimeResult.output, "Cannot load local qrljs-monorepo");
    assert.include(badRuntimeResult.output, "/tmp/missing-qrljs-monorepo");

    const badCompilerResult = await expectHardhatFailure(
      this.tmpDir,
      {
        ...env,
        HYPERION_HYPC_PATH: "/tmp/missing-hypc",
      },
      ["compile", "--force"]
    );
    assert.include(badCompilerResult.output, "Compilation failed");
    assert.include(badCompilerResult.output, "missing-hypc");
  });
});

async function prepareProject(projectRoot: string) {
  await fsExtra.ensureDir(path.join(projectRoot, "contracts"));
  await fsExtra.ensureDir(path.join(projectRoot, "scripts"));
  await fsExtra.ensureDir(path.join(projectRoot, "test"));
  await fsExtra.ensureDir(path.join(projectRoot, "node_modules", "@theqrl"));

  await symlinkPackage(
    PACKAGE_ROOT,
    path.join(projectRoot, "node_modules", "@theqrl", "hardhat")
  );

  await fsExtra.writeFile(
    path.join(projectRoot, "contracts", "Storage.hyp"),
    getStorageContractSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "hardhat.config.js"),
    getConfigSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "scripts", "qrl-local-e2e.js"),
    getScriptSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "test", "qrl-local-e2e.js"),
    getTestSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "test", "qrl-local-pending.js"),
    getPendingTestSource()
  );
}

async function symlinkPackage(target: string, linkPath: string) {
  await fsExtra.remove(linkPath);
  await fsExtra.ensureDir(path.dirname(linkPath));
  await fsExtra.symlink(target, linkPath, "dir");
}

function runHardhat(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  args: string[]
) {
  return execFileAsync(
    "node",
    ["node_modules/@theqrl/hardhat/internal/cli/cli.js", ...args],
    {
      cwd: projectRoot,
      env,
      maxBuffer: 1024 * 1024 * 20,
    }
  );
}

async function expectHardhatFailure(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  args: string[]
): Promise<{ output: string }> {
  try {
    await runHardhat(projectRoot, env, args);
  } catch (error) {
    const childError = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      output: [childError.stdout, childError.stderr, childError.message]
        .filter((part) => part !== undefined)
        .join("\n"),
    };
  }

  throw new Error(`Expected hardhat ${args.join(" ")} to fail`);
}

function resolveHypcPath(): string | undefined {
  if (process.env.HYPERION_HYPC_PATH !== undefined) {
    return process.env.HYPERION_HYPC_PATH;
  }

  if (process.env.HYPC_PATH !== undefined) {
    return process.env.HYPC_PATH;
  }

  if (fsExtra.pathExistsSync(LOCAL_HYPC_PATH)) {
    return LOCAL_HYPC_PATH;
  }

  return findExecutableOnPath("hypc");
}

function resolveQrlJsMonorepoPath(): string | undefined {
  const configuredPath =
    process.env.QRLJS_MONOREPO_PATH ?? LOCAL_QRLJS_MONOREPO_PATH;
  const providerPath = path.join(
    configuredPath,
    "packages",
    "vm",
    "dist",
    "cjs",
    "index.js"
  );

  return fsExtra.pathExistsSync(providerPath) ? configuredPath : undefined;
}

function findExecutableOnPath(executable: string): string | undefined {
  const pathValue = process.env.PATH;
  const pathDirs =
    pathValue === undefined ? [] : pathValue.split(path.delimiter);

  for (const pathDir of pathDirs) {
    const candidate = path.join(pathDir, executable);
    if (fsExtra.pathExistsSync(candidate)) {
      return candidate;
    }
  }
}

function getConfigSource(): string {
  return `
task("accounts", "Prints the list of QRL accounts", async (_, { network }) => {
  const accounts = await network.provider.send("qrl_accounts");

  for (const address of accounts) {
    console.log(address);
  }
});

const localAccountAddress = \`Q\${"01".repeat(64)}\`;

module.exports = {
  defaultNetwork: "qrlLocal",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      blockGasLimit: 30000000,
    },
    qrlManual: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      automine: false,
      blockGasLimit: 30000000,
    },
  },
};
`;
}

function getStorageContractSource(): string {
  return `
// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

contract Storage {
    uint256 private value;

    function store(uint256 newValue) public {
        value = newValue;
    }

    function retrieve() public view returns (uint256) {
        return value;
    }
}
`;
}

function getScriptSource(): string {
  return `
const hre = require("@theqrl/hardhat");

async function main() {
  const [from] = await hre.network.provider.send("qrl_accounts");
  const Storage = await hre.qrl.getContractFactory("Storage");
  const deployment = await Storage.deploy({ from });
  const storage = await hre.qrl.getContractAt("Storage", deployment.address);

  const txHash = await storage.functions.store(42, { from });
  await hre.qrl.waitForTransaction(txHash);
  const [stored] = await storage.callStatic.retrieve();

  console.log("Stored value:", stored.toString(10));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

function getTestSource(): string {
  return `
const assert = require("assert");
const hre = require("@theqrl/hardhat");

const RECEIVER = "Q" + "02".repeat(64);

describe("QRL local", function () {
  it("deploys and calls a contract", async function () {
    const [from] = await hre.network.provider.send("qrl_accounts");
    const Storage = await hre.qrl.getContractFactory("Storage");
    assert.strictEqual(await hre.network.provider.send("qrl_chainId"), "0x1");
    assert.strictEqual(await hre.network.provider.send("qrl_blockNumber"), "0x0");
    assert.strictEqual(
      await hre.network.provider.send("qrl_getBalance", [RECEIVER, "latest"]),
      "0x0"
    );

    const deployment = await Storage.deploy({ from });
    const storage = await hre.qrl.getContractAt("Storage", deployment.address);
    const deploymentReceipt = await hre.network.provider.send(
      "qrl_getTransactionReceipt",
      [deployment.hash]
    );
    assert.strictEqual(deploymentReceipt.status, "0x1");
    assert.strictEqual(deploymentReceipt.transactionHash, deployment.hash);
    assert.strictEqual(deploymentReceipt.contractAddress, deployment.address);
    assert.strictEqual(await hre.network.provider.send("qrl_blockNumber"), "0x1");

    const txHash = await storage.functions.store(42, { from });
    const receipt = await hre.qrl.waitForTransaction(txHash);
    const [stored] = await storage.callStatic.retrieve();

    assert.strictEqual(receipt.status, "0x1");
    assert.strictEqual(receipt.transactionHash, txHash);
    assert.strictEqual(receipt.blockNumber, "0x2");
    assert.ok(BigInt(receipt.gasUsed) > 0n);
    assert.strictEqual(await hre.network.provider.send("qrl_blockNumber"), "0x2");
    assert.strictEqual(stored.toString(10), "42");

    const block = await hre.network.provider.send("qrl_getBlockByNumber", [
      "latest",
      true,
    ]);
    assert.strictEqual(block.number, "0x2");
    assert.strictEqual(block.transactions.length, 1);
    assert.strictEqual(block.transactions[0].hash, txHash);

    const transferHash = await hre.qrl.sendTransaction({
      from,
      to: RECEIVER,
      value: "0x2a",
      gas: "0x5208",
    });
    const transferReceipt = await hre.qrl.waitForTransaction(transferHash);
    assert.strictEqual(transferReceipt.status, "0x1");
    assert.strictEqual(await hre.network.provider.send("qrl_blockNumber"), "0x3");
    assert.strictEqual(
      await hre.network.provider.send("qrl_getBalance", [RECEIVER, "latest"]),
      "0x2a"
    );

    await assert.rejects(
      () => hre.network.provider.send("eth_blockNumber"),
      /Legacy eth_/
    );
    await assert.rejects(
      () => hre.network.provider.send("qrl_sendRawTransaction", ["0x00"]),
      /qrl_sendRawTransaction on qrlLocal is not supported/
    );
    await assert.rejects(
      () =>
        hre.network.provider.send("qrl_sendTransaction", [
          {
            from,
            to: RECEIVER,
            gas: "0x1",
            value: "0x0",
          },
        ]),
      /intrinsic gas/i
    );
  });
});
`;
}

function getPendingTestSource(): string {
  return `
const assert = require("assert");
const hre = require("@theqrl/hardhat");

const RECEIVER = "Q" + "02".repeat(64);
const LOG_TOPIC = "0x" + "00".repeat(63) + "7b";
const LOG_DATA = "0x" + "00".repeat(63) + "2a";
const LOGGING_INIT_CODE = "0x602a5f52607b60405fc100";

describe("QRL local pending", function () {
  it("exposes pending state, pending blocks, mining, gas estimation, and logs", async function () {
    const [from] = await hre.network.provider.send("qrl_accounts");

    assert.strictEqual(await hre.network.provider.send("qrl_blockNumber"), "0x0");
    assert.strictEqual(
      await hre.network.provider.send("qrl_getTransactionCount", [from, "latest"]),
      "0x0"
    );
    assert.strictEqual(
      await hre.network.provider.send("qrl_getTransactionCount", [from, "pending"]),
      "0x0"
    );

    const estimatedGas = await hre.network.provider.send("qrl_estimateGas", [
      {
        from,
        to: RECEIVER,
        value: "0x2a",
        maxFeePerGas: "0x0",
        maxPriorityFeePerGas: "0x0",
      },
    ]);
    assert.strictEqual(estimatedGas, "0x5208");

    const transferHash = await hre.network.provider.send("qrl_sendTransaction", [
      {
        from,
        to: RECEIVER,
        value: "0x2a",
        gas: estimatedGas,
        maxFeePerGas: "0x0",
        maxPriorityFeePerGas: "0x0",
      },
    ]);

    assert.strictEqual(await hre.network.provider.send("qrl_blockNumber"), "0x0");
    assert.strictEqual(
      await hre.network.provider.send("qrl_getTransactionCount", [from, "latest"]),
      "0x0"
    );
    assert.strictEqual(
      await hre.network.provider.send("qrl_getTransactionCount", [from, "pending"]),
      "0x1"
    );
    assert.strictEqual(
      await hre.network.provider.send("qrl_getBalance", [RECEIVER, "latest"]),
      "0x0"
    );
    assert.strictEqual(
      await hre.network.provider.send("qrl_getBalance", [RECEIVER, "pending"]),
      "0x2a"
    );
    assert.strictEqual(
      await hre.network.provider.send("qrl_getTransactionReceipt", [transferHash]),
      null
    );

    const pendingBlock = await hre.network.provider.send("qrl_getBlockByNumber", [
      "pending",
      true,
    ]);
    assert.strictEqual(pendingBlock.number, "0x1");
    assert.strictEqual(pendingBlock.transactions.length, 1);
    assert.strictEqual(pendingBlock.transactions[0].hash, transferHash);
    assert.strictEqual(pendingBlock.transactions[0].from, from);
    assert.strictEqual(pendingBlock.transactions[0].to, RECEIVER);
    assert.strictEqual(pendingBlock.receipts[0].status, "0x1");

    await hre.network.provider.send("qrl_mine");
    const transferReceipt = await hre.network.provider.send("qrl_getTransactionReceipt", [
      transferHash,
    ]);
    assert.strictEqual(transferReceipt.status, "0x1");
    assert.strictEqual(
      await hre.network.provider.send("qrl_getBalance", [RECEIVER, "latest"]),
      "0x2a"
    );

    const logTxHash = await hre.network.provider.send("qrl_sendTransaction", [
      {
        from,
        data: LOGGING_INIT_CODE,
        gas: "0x186a0",
        maxFeePerGas: "0x0",
        maxPriorityFeePerGas: "0x0",
      },
    ]);
    const logPendingBlock = await hre.network.provider.send("qrl_getBlockByNumber", [
      "pending",
      false,
    ]);
    assert.strictEqual(logPendingBlock.number, "0x2");
    assert.strictEqual(logPendingBlock.transactions[0], logTxHash);
    assert.strictEqual(logPendingBlock.receipts[0].logs.length, 1);
    assert.strictEqual(logPendingBlock.receipts[0].logs[0].topics[0], LOG_TOPIC);
    assert.strictEqual(logPendingBlock.receipts[0].logs[0].data, LOG_DATA);
    assert.deepStrictEqual(
      await hre.network.provider.send("qrl_getLogs", [{ fromBlock: "0x2", toBlock: "latest" }]),
      []
    );

    await hre.network.provider.send("qrl_mine");
    const logs = await hre.network.provider.send("qrl_getLogs", [
      { fromBlock: "0x2", toBlock: "latest", topics: [LOG_TOPIC] },
    ]);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].transactionHash, logTxHash);
    assert.strictEqual(logs[0].topics[0], LOG_TOPIC);
    assert.strictEqual(logs[0].data, LOG_DATA);
  });
});
`;
}
