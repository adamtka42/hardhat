import { assert } from "chai";
import { execFile } from "child_process";
import fsExtra from "fs-extra";
import path from "path";
import { promisify } from "util";

import { QRL_CONSOLE_LOG_ADDRESS } from "../../src/internal/qrl/console-log";
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

describe("Hardhat QRLVM e2e", function () {
  useTmpDir("hardhat-qrlvm-e2e");

  it("runs scripts and tests against the in-memory hardhatqrlvm provider", async function () {
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
      "scripts/hardhat-qrlvm-e2e.js",
    ]);
    assert.include(runResult.stdout, "Stored value: 42");

    const explicitRunResult = await runHardhat(this.tmpDir, env, [
      "run",
      "scripts/hardhat-qrlvm-e2e.js",
      "--network",
      "hardhatqrlvm",
    ]);
    assert.include(explicitRunResult.stdout, "Stored value: 42");

    const testResult = await runHardhat(this.tmpDir, env, [
      "test",
      "test/hardhat-qrlvm-e2e.js",
    ]);
    assert.include(testResult.stdout, "1 passing");

    const pendingTestResult = await runHardhat(this.tmpDir, env, [
      "test",
      "test/hardhat-qrlvm-pending.js",
      "--config",
      "hardhat.manual.config.js",
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
    assert.include(badRuntimeResult.output, "Cannot load the QRL runtime");
    assert.include(badRuntimeResult.output, "/tmp/missing-qrljs-monorepo");

    const badCompilerResult = await expectHardhatFailure(
      this.tmpDir,
      {
        ...env,
        HYPERION_HYPC_PATH: "/tmp/missing-hypc",
      },
      ["compile", "--force"]
    );
    assert.include(
      badCompilerResult.output,
      "Hyperion compiler /tmp/missing-hypc couldn't be resolved"
    );
  });

  it("prints contract console logs on hardhatqrlvm", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (hypcPath === undefined || qrlJsMonorepoPath === undefined) {
      this.skip();
      return;
    }

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await fsExtra.writeFile(
      path.join(this.tmpDir, "contracts", "ConsoleProbe.hyp"),
      getConsoleProbeSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "scripts", "console-e2e.js"),
      getConsoleScriptSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "hardhat.console-off.config.js"),
      getConsoleOffConfigSource()
    );

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath!,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath!,
    };

    // Cross-repo constant drift guard: the hardhat-side console address must
    // stay byte-identical to the qrljs-monorepo one. This is the only place
    // both runtimes are guaranteed loaded.
    const utilQrl = require(path.join(
      qrlJsMonorepoPath!,
      "packages",
      "util",
      "dist",
      "cjs",
      "index.js"
    )).qrl;
    assert.equal(
      utilQrl.QRL_CONSOLE_LOG_ADDRESS.toString().toLowerCase(),
      QRL_CONSOLE_LOG_ADDRESS.toLowerCase()
    );

    const result = await runHardhat(this.tmpDir, env, [
      "run",
      "scripts/console-e2e.js",
    ]);
    const output = result.stdout.toString();
    const senderLine = `set called by Q${"01".repeat(64)}`;
    assert.equal(countOccurrences(output, senderLine), 1);
    assert.equal(countOccurrences(output, "\nold 0\n"), 1);
    assert.equal(countOccurrences(output, "\nnew 42\n"), 1);
    assert.equal(countOccurrences(output, "\npeek 42\n"), 1);
    assert.include(output, "value after: 42");

    // consoleLog: false disables the output without any behavior change.
    const offResult = await runHardhat(this.tmpDir, env, [
      "--config",
      "hardhat.console-off.config.js",
      "run",
      "scripts/console-e2e.js",
    ]);
    const offOutput = offResult.stdout.toString();
    assert.equal(countOccurrences(offOutput, "\nnew 42\n"), 0);
    assert.notInclude(offOutput, senderLine);
    assert.include(offOutput, "value after: 42");
  });

  it("manipulates local chain time for timelock-style contracts", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (hypcPath === undefined || qrlJsMonorepoPath === undefined) {
      this.skip();
      return;
    }

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await fsExtra.writeFile(
      path.join(this.tmpDir, "contracts", "Timelock.hyp"),
      getTimelockSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "hardhat.initialdate.config.js"),
      getInitialDateConfigSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "scripts", "time-e2e.js"),
      getTimeScriptSource()
    );

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath!,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath!,
    };

    const result = await runHardhat(this.tmpDir, env, [
      "--config",
      "hardhat.initialdate.config.js",
      "run",
      "scripts/time-e2e.js",
    ]);
    const output = result.stdout.toString();
    assert.include(output, "genesis timestamp: 1767225600");
    assert.include(output, "locked before increase: true");
    assert.include(output, "poke throw decoded: true");
    assert.include(output, "poke receipt status: 0x0");
    assert.include(output, "increaseTime returned: 10000");
    assert.include(output, "withdraw after increase: true");
  });

  it("prints Hyperion stack traces for nested reverts", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (hypcPath === undefined || qrlJsMonorepoPath === undefined) {
      this.skip();
      return;
    }

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await fsExtra.writeFile(
      path.join(this.tmpDir, "contracts", "Nested.hyp"),
      getNestedSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "scripts", "trace-e2e.js"),
      getTraceScriptSource()
    );

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath!,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath!,
    };

    const result = await runHardhat(this.tmpDir, env, [
      "run",
      "scripts/trace-e2e.js",
    ]);
    const output = result.stdout.toString();

    // Call path: nested revert shows both frames, innermost first.
    assert.include(output, "reason: 'too small'");
    const innerAt = output.indexOf("at Inner.fail (contracts/Nested.hyp:6)");
    const outerAt = output.indexOf("at Outer.callInner (contracts/Nested.hyp:");
    assert.isAbove(innerAt, -1, `missing Inner frame in:\n${output}`);
    assert.isAbove(outerAt, innerAt, `missing Outer frame in:\n${output}`);

    // Transaction path: traced through the replay of the mined tx.
    assert.include(output, "at Inner.poke (contracts/Nested.hyp:");
    assert.include(output, "at Outer.pokeInner (contracts/Nested.hyp:");

    // A HANDLED nested failure must not be blamed: the trace points at the
    // outer contract's own revert, without an Inner frame.
    const handledSection = output.slice(
      output.indexOf("HANDLED TRACE:"),
      output.indexOf("HANDLED TRACE END")
    );
    assert.include(handledSection, "reason: 'own reason'");
    assert.include(
      handledSection,
      "at Outer.handledThenOwnRevert (contracts/Nested.hyp:"
    );
    assert.notInclude(handledSection, "at Inner.fail");

    const emptySection = output.slice(
      output.indexOf("EMPTY TRACE:"),
      output.indexOf("EMPTY TRACE END")
    );
    assert.include(emptySection, "at Inner.failEmpty");
    assert.include(emptySection, "at Outer.callEmpty");

    const identicalHandledSection = output.slice(
      output.indexOf("IDENTICAL HANDLED TRACE:"),
      output.indexOf("IDENTICAL HANDLED TRACE END")
    );
    assert.include(identicalHandledSection, "same reason");
    assert.include(
      identicalHandledSection,
      "at Outer.handledSameReasonThenOwnRevert"
    );
    assert.notInclude(identicalHandledSection, "at Inner.failSame");

    const ephemeralSection = output.slice(
      output.indexOf("EPHEMERAL TRACE:"),
      output.indexOf("EPHEMERAL TRACE END")
    );
    assert.include(ephemeralSection, "at Ephemeral.fail");
    assert.include(ephemeralSection, "at Outer.createAndFail");

    const internalSection = output.slice(
      output.indexOf("INTERNAL TRACE:"),
      output.indexOf("INTERNAL TRACE END")
    );
    const internalOrigin = internalSection.indexOf("at Outer._internalFailure");
    const internalCaller = internalSection.indexOf("at Outer.internalFailure");
    assert.isAbove(internalOrigin, -1, internalSection);
    assert.isAbove(internalCaller, internalOrigin, internalSection);

    const constructorEstimateSection = output.slice(
      output.indexOf("CONSTRUCTOR ESTIMATE TRACE:"),
      output.indexOf("CONSTRUCTOR ESTIMATE TRACE END")
    );
    assert.include(
      constructorEstimateSection,
      "at NonPayableConstructor.constructor"
    );

    const constructorTxSection = output.slice(
      output.indexOf("CONSTRUCTOR TX TRACE:"),
      output.indexOf("CONSTRUCTOR TX TRACE END")
    );
    assert.include(
      constructorTxSection,
      "at NonPayableConstructor.constructor"
    );

    // Opt-out restores the plain message.
    await fsExtra.writeFile(
      path.join(this.tmpDir, "hardhat.notrace.config.js"),
      getNoTraceConfigSource()
    );
    const offResult = await runHardhat(this.tmpDir, env, [
      "--config",
      "hardhat.notrace.config.js",
      "run",
      "scripts/trace-e2e.js",
    ]);
    const offOutput = offResult.stdout.toString();
    assert.include(offOutput, "reason: 'too small'");
    assert.notInclude(offOutput, "at Inner.fail");
  });

  it("deploys contracts with external libraries on hardhatqrlvm", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (hypcPath === undefined || qrlJsMonorepoPath === undefined) {
      this.skip();
      return;
    }

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await fsExtra.writeFile(
      path.join(this.tmpDir, "contracts", "MathLib.hyp"),
      getMathLibSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "contracts", "UsesMathLib.hyp"),
      getUsesMathLibSource()
    );
    await fsExtra.writeFile(
      path.join(this.tmpDir, "scripts", "library-e2e.js"),
      getLibraryScriptSource()
    );

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath!,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath!,
    };

    const result = await runHardhat(this.tmpDir, env, [
      "run",
      "scripts/library-e2e.js",
    ]);
    const output = result.stdout.toString();
    assert.include(output, "library address ok: true");
    assert.include(output, "calc result: 42");
    assert.include(output, "deployContract calc result: 84");
    assert.include(output, "unlinked deploy failed: true");
    assert.include(output, "unresolved library references");
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
    path.join(projectRoot, "hardhat.manual.config.js"),
    getManualConfigSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "scripts", "hardhat-qrlvm-e2e.js"),
    getScriptSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "test", "hardhat-qrlvm-e2e.js"),
    getTestSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "test", "hardhat-qrlvm-pending.js"),
    getPendingTestSource()
  );
}

async function symlinkPackage(target: string, linkPath: string) {
  await fsExtra.remove(linkPath);
  await fsExtra.ensureDir(path.dirname(linkPath));
  await fsExtra.symlink(target, linkPath, "dir");
}

async function runHardhat(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  args: string[]
) {
  const result = await execFileAsync(
    "node",
    ["node_modules/@theqrl/hardhat/internal/cli/cli.js", ...args],
    {
      cwd: projectRoot,
      env,
      maxBuffer: 1024 * 1024 * 20,
    }
  );
  // The root test runner forces colors (FORCE_COLOR); assertions below
  // expect plain text, so strip ANSI escapes from the captured output.
  return {
    ...result,
    stdout: stripAnsi(result.stdout.toString()),
    stderr: stripAnsi(result.stderr.toString()),
  };
}

function stripAnsi(text: string): string {
  // tslint:disable-next-line: tsr-detect-unsafe-regexp
  return text.replace(/\u001b\[[0-9;]*m/g, "");
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
  defaultNetwork: "hardhatqrlvm",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    hardhatqrlvm: {
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      blockGasLimit: 30000000,
    },
  },
};
`;
}

function getManualConfigSource(): string {
  return getConfigSource().replace(
    "      blockGasLimit: 30000000,",
    "      automine: false,\n      blockGasLimit: 30000000,"
  );
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

describe("Hardhat QRLVM", function () {
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
      /invalid raw transaction/i
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

describe("Hardhat QRLVM pending", function () {
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

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function getConsoleProbeSource(): string {
  return `// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

import "@theqrl/hardhat/console.hyp";

contract ConsoleProbe {
    uint256 public value;

    function set(uint256 v) public {
        console.log("set called by", msg.sender);
        console.log("old", value);
        console.log("new", v);
        value = v;
    }

    function peek() public view returns (uint256) {
        console.log("peek", value);
        return value;
    }
}
`;
}

function getNoTraceConfigSource(): string {
  return `const localAccountAddress = \`Q\${"01".repeat(64)}\`;

module.exports = {
  defaultNetwork: "hardhatqrlvm",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    hardhatqrlvm: {
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      blockGasLimit: 30000000,
      stackTraces: false,
    },
  },
};
`;
}

function getNestedSource(): string {
  return `// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

contract Inner {
    function fail(uint256 x) public pure returns (uint256) {
        require(x > 10, "too small");
        return x - 10;
    }

    function failEmpty() public pure {
        revert();
    }

    function failSame() public pure {
        revert("same reason");
    }

    function poke(uint256 x) public {
        require(x > 10, "too small");
        counter += x;
    }

    uint256 public counter;
}

contract Ephemeral {
    function fail() public pure {
        revert("ephemeral failure");
    }
}

contract NonPayableConstructor {
    constructor(uint256 value) {
        value;
    }
}

contract Outer {
    Inner public inner;

    constructor() {
        inner = new Inner();
    }

    function callInner(uint256 x) public view returns (uint256) {
        return inner.fail(x);
    }

    function callEmpty() public view {
        inner.failEmpty();
    }

    function pokeInner(uint256 x) public {
        inner.poke(x);
    }

    function handledThenOwnRevert() public view returns (uint256) {
        (bool ok, ) = address(inner).staticcall(
            abi.encodeWithSignature("fail(uint256)", uint256(1))
        );
        ok;
        require(false, "own reason");
        return 0;
    }

    function handledSameReasonThenOwnRevert() public view {
        (bool ok, ) = address(inner).staticcall(
            abi.encodeWithSignature("failSame()")
        );
        ok;
        require(false, "same reason");
    }

    function createAndFail() public {
        Ephemeral ephemeral = new Ephemeral();
        ephemeral.fail();
    }

    function internalFailure() public pure {
        _internalFailure();
    }

    function _internalFailure() internal pure {
        revert("internal failure");
    }
}
`;
}

function getTraceScriptSource(): string {
  return `async function printFailure(label, action) {
  try {
    await action();
    console.log(label + " unexpectedly succeeded");
  } catch (error) {
    console.log(label + ":");
    console.log(error.message);
    console.log(label + " END");
  }
}

async function main() {
  const Outer = await qrl.getContractFactory("Outer");
  const outer = await Outer.deploy();

  await printFailure("CALL TRACE", () => outer.callInner(5));
  await printFailure("TX TRACE", () => outer.pokeInner(5, { gas: 300000 }));
  await printFailure("EMPTY TRACE", () => outer.callEmpty());
  await printFailure("HANDLED TRACE", () => outer.handledThenOwnRevert());
  await printFailure("IDENTICAL HANDLED TRACE", () =>
    outer.handledSameReasonThenOwnRevert()
  );
  await printFailure("EPHEMERAL TRACE", () =>
    outer.createAndFail({ gas: 1000000 })
  );
  await printFailure("INTERNAL TRACE", () => outer.internalFailure());

  const NonPayableConstructor = await qrl.getContractFactory(
    "NonPayableConstructor"
  );
  const constructorBytecode = NonPayableConstructor.bytecode;
  const [from] = await network.provider.send("qrl_accounts");
  await printFailure("CONSTRUCTOR ESTIMATE TRACE", () =>
    network.provider.send("qrl_estimateGas", [{ from, data: constructorBytecode }])
  );
  await printFailure("CONSTRUCTOR TX TRACE", () =>
    network.provider.send("qrl_sendTransaction", [
      { from, data: constructorBytecode, gas: "0xf4240" },
    ])
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;
}

function getTimelockSource(): string {
  return `// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

contract Timelock {
    uint256 public unlockTime;

    constructor(uint256 _unlockTime) {
        unlockTime = _unlockTime;
    }

    function withdraw() public view returns (bool) {
        require(block.timestamp >= unlockTime, "locked");
        return true;
    }

    function poke() public {
        require(block.timestamp >= unlockTime, "locked");
        unlockTime = 0;
    }
}
`;
}

function getInitialDateConfigSource(): string {
  return `const localAccountAddress = \`Q\${"01".repeat(64)}\`;

module.exports = {
  defaultNetwork: "hardhatqrlvm",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    hardhatqrlvm: {
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      blockGasLimit: 30000000,
      initialDate: "2026-01-01T00:00:00Z",
    },
  },
};
`;
}

function getTimeScriptSource(): string {
  return `async function main() {
  const genesis = await network.provider.send("qrl_getBlockByNumber", ["latest", false]);
  const genesisTimestamp = parseInt(genesis.timestamp, 16);
  console.log("genesis timestamp:", genesisTimestamp);

  const Timelock = await qrl.getContractFactory("Timelock");
  const timelock = await Timelock.deploy({}, [genesisTimestamp + 5000]);

  let locked = false;
  try {
    await timelock.withdraw();
    console.log("withdraw before increase unexpectedly succeeded");
  } catch (error) {
    // The Error("locked") reason is decoded into the provider error message.
    locked = error.message.includes("reason: 'locked'");
    if (!locked) {
      console.log("unexpected withdraw error: " + error.message);
    }
  }
  console.log("locked before increase: " + locked);

  // A reverting TRANSACTION throws too, and the mined receipt stays
  // queryable through the hash carried on the error. Explicit gas skips
  // estimation, which would reject the reverting tx before it is sent.
  try {
    await timelock.poke({ gas: 100000 });
    console.log("poke before increase unexpectedly succeeded");
  } catch (error) {
    console.log(
      "poke throw decoded: " + error.message.includes("reason: 'locked'")
    );
    const receipt = await network.provider.send("qrl_getTransactionReceipt", [
      error.transactionHash,
    ]);
    console.log("poke receipt status: " + receipt.status);
  }

  const total = await network.provider.send("qrl_increaseTime", [10000]);
  console.log("increaseTime returned: " + total);
  await network.provider.send("qrl_mine", []);

  console.log("withdraw after increase: " + (await timelock.withdraw()));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;
}

function getMathLibSource(): string {
  return `// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

library MathLib {
    function double(uint256 x) external pure returns (uint256) {
        return x * 2;
    }
}
`;
}

function getUsesMathLibSource(): string {
  return `// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

import "./MathLib.hyp";

contract UsesMathLib {
    function calc(uint256 x) public pure returns (uint256) {
        return MathLib.double(x);
    }
}
`;
}

function getLibraryScriptSource(): string {
  return `async function main() {
  const MathLib = await qrl.getContractFactory("MathLib");
  const mathLib = await MathLib.deploy();
  console.log("library address ok:", /^Q[0-9a-fA-F]{128}$/.test(mathLib.address));

  const UsesMathLib = await qrl.getContractFactory("UsesMathLib", {
    libraries: { MathLib: mathLib.address },
  });
  const usesMathLib = await UsesMathLib.deploy();
  const result = await usesMathLib.calc(21);
  console.log("calc result:", result.toString());

  const deployment = await qrl.deployContract("UsesMathLib", {}, [], {
    libraries: { MathLib: mathLib.address },
  });
  const attached = UsesMathLib.attach(deployment.address);
  const attachedResult = await attached.calc(42);
  console.log("deployContract calc result:", attachedResult.toString());

  let unlinkedFailed = false;
  let unlinkedMessage = "";
  try {
    await qrl.deployContract("UsesMathLib");
  } catch (error) {
    unlinkedFailed = true;
    unlinkedMessage = error.message;
  }
  console.log("unlinked deploy failed:", unlinkedFailed);
  console.log(unlinkedMessage.split("\\n")[0]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;
}

function getConsoleScriptSource(): string {
  return `async function main() {
  const Probe = await qrl.getContractFactory("ConsoleProbe");
  const probe = await Probe.deploy();

  const tx = await probe.set(42);
  await tx.wait();
  const v = await probe.peek();

  console.log("value after:", v.toString(10));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;
}

function getConsoleOffConfigSource(): string {
  return getConfigSource().replace(
    "    hardhatqrlvm: {",
    "    hardhatqrlvm: {\n      consoleLog: false,"
  );
}
