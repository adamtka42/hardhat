import { assert } from "chai";
import { execFile } from "child_process";
import fsExtra from "fs-extra";
import path from "path";
import { promisify } from "util";

import { useTmpDir } from "../helpers/fs";

const execFileAsync = promisify(execFile);

const DEFAULT_RPC_URL = "http://127.0.0.1:33462";
const LOCAL_ACCOUNT_SEED =
  "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401";
const RECIPIENT_ACCOUNT_SEED =
  "0x010000111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111";

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

interface ParityResult {
  network: string;
  chainId: string;
  blockDelta: string;
  transferDelta: string;
  storedBefore: string;
  storedAfter: string;
  eventValue: string;
  deploymentStatus: string;
  storeStatus: string;
  transferStatus: string;
  deploymentReceiptMatches: boolean;
  storeReceiptMatches: boolean;
  transferReceiptMatches: boolean;
  transactionLookupMatches: boolean;
  codeAvailable: boolean;
  latestBlockHasTransaction: boolean;
  ethRpcRejected: boolean;
  rawTransactionRejected: boolean;
  deployGasUsedPositive: boolean;
  storeGasUsedPositive: boolean;
  transferGasUsedPositive: boolean;
}

type ComparableParityResult = Omit<
  ParityResult,
  "network" | "rawTransactionRejected" | "blockDelta"
> & {
  blockDeltaAtLeastThree: boolean;
};

describe("QRL parity e2e", function () {
  useTmpDir("qrl-parity-e2e");

  before(function () {
    if (process.env.QRL_HARDHAT_PARITY_E2E !== "1") {
      this.skip();
      return;
    }
  });

  it("matches private-network and hardhatqrlvm behavior for core workflows", async function () {
    this.timeout(600000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    assert.isDefined(hypcPath, "hypc must be available for QRL parity e2e");
    assert.isDefined(
      qrlJsMonorepoPath,
      "qrljs-monorepo dist must be available for QRL parity e2e"
    );

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath!,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath!,
      QRL_PARITY_RPC_URL:
        process.env.QRL_HARDHAT_E2E_RPC_URL ?? DEFAULT_RPC_URL,
      QRL_PARITY_ACCOUNT_SEED:
        process.env.QRL_HARDHAT_E2E_ACCOUNT_SEED ?? LOCAL_ACCOUNT_SEED,
      QRL_PARITY_RECIPIENT_SEED:
        process.env.QRL_HARDHAT_E2E_RECIPIENT_SEED ?? RECIPIENT_ACCOUNT_SEED,
      QRL_PARITY_CHAIN_ID: process.env.QRL_HARDHAT_E2E_CHAIN_ID ?? "1",
    };

    await runHardhat(this.tmpDir, env, ["compile", "--force"]);

    const privateResult = await runParityScenario(
      this.tmpDir,
      env,
      "qrlPrivate"
    );
    const localResult = await runParityScenario(
      this.tmpDir,
      env,
      "hardhatqrlvm"
    );

    assert.deepEqual(
      normalizeResult(localResult),
      normalizeResult(privateResult)
    );
    assert.isTrue(
      localResult.rawTransactionRejected,
      "hardhatqrlvm should reject raw transactions until QRL raw tx signing is wired"
    );
  });
});

async function prepareProject(projectRoot: string) {
  await fsExtra.ensureDir(path.join(projectRoot, "contracts"));
  await fsExtra.ensureDir(path.join(projectRoot, "scripts"));
  await fsExtra.ensureDir(path.join(projectRoot, "node_modules", "@theqrl"));

  await symlinkPackage(
    PACKAGE_ROOT,
    path.join(projectRoot, "node_modules", "@theqrl", "hardhat")
  );
  await symlinkPackage(
    path.join(PACKAGE_ROOT, "node_modules", "@theqrl", "web3-qrl-accounts"),
    path.join(projectRoot, "node_modules", "@theqrl", "web3-qrl-accounts")
  );

  await fsExtra.writeFile(
    path.join(projectRoot, "contracts", "ParityStorage.hyp"),
    getStorageContractSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "hardhat.config.js"),
    getConfigSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "scripts", "qrl-parity.js"),
    getScriptSource()
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

async function runParityScenario(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  network: "qrlPrivate" | "hardhatqrlvm"
): Promise<ParityResult> {
  const { stdout } = await runHardhat(projectRoot, env, [
    "run",
    "scripts/qrl-parity.js",
    "--network",
    network,
    "--no-compile",
  ]);
  const line = stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("QRL_PARITY_RESULT="));
  if (line === undefined) {
    throw new Error(`Missing QRL parity result for ${network}:\n${stdout}`);
  }
  return JSON.parse(line.slice("QRL_PARITY_RESULT=".length));
}

function normalizeResult(result: ParityResult): ComparableParityResult {
  return {
    chainId: result.chainId,
    blockDeltaAtLeastThree: Number.parseInt(result.blockDelta, 10) >= 3,
    transferDelta: result.transferDelta,
    storedBefore: result.storedBefore,
    storedAfter: result.storedAfter,
    eventValue: result.eventValue,
    deploymentStatus: result.deploymentStatus,
    storeStatus: result.storeStatus,
    transferStatus: result.transferStatus,
    deploymentReceiptMatches: result.deploymentReceiptMatches,
    storeReceiptMatches: result.storeReceiptMatches,
    transferReceiptMatches: result.transferReceiptMatches,
    transactionLookupMatches: result.transactionLookupMatches,
    codeAvailable: result.codeAvailable,
    latestBlockHasTransaction: result.latestBlockHasTransaction,
    ethRpcRejected: result.ethRpcRejected,
    deployGasUsedPositive: result.deployGasUsedPositive,
    storeGasUsedPositive: result.storeGasUsedPositive,
    transferGasUsedPositive: result.transferGasUsedPositive,
  };
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
const localAccountAddress = \`Q\${"01".repeat(64)}\`;

module.exports = {
  defaultNetwork: "hardhatqrlvm",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    qrlPrivate: {
      url: process.env.QRL_PARITY_RPC_URL,
      accounts: [process.env.QRL_PARITY_ACCOUNT_SEED],
    },
    hardhatqrlvm: {
      chainId: Number(process.env.QRL_PARITY_CHAIN_ID),
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000000000000000" }],
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

contract ParityStorage {
    uint256 private value;

    event ValueChanged(uint256 newValue);

    function store(uint256 newValue) public {
        value = newValue;
        emit ValueChanged(newValue);
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
const { seedToAccount } = require("@theqrl/web3-qrl-accounts");

const WAIT_TIMEOUT_MS = 300000;
const TRANSFER_VALUE = 42n;
const EMPTY_TRIE_ROOT = "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";

async function rpc(method, params = []) {
  return hre.network.provider.send(method, params);
}

async function wait(hash) {
  const receipt = await hre.qrl.waitForTransaction(hash, WAIT_TIMEOUT_MS);
  if (receipt.status !== "0x1" && receipt.status !== 1 && receipt.status !== true) {
    throw new Error(\`Transaction \${hash} failed with status \${receipt.status}\`);
  }
  return receipt;
}

function isHardhatQrlvm() {
  return hre.network.name === "hardhatqrlvm";
}

function txOptions(from, gas) {
  if (isHardhatQrlvm()) {
    return { from, gas };
  }
  return {
    from,
    gas,
    maxFeePerGas: "0xba43b7400",
    maxPriorityFeePerGas: "0xba43b7400",
  };
}

function normalizeStatus(status) {
  return status === true ? "0x1" : String(status);
}

function normalizeReceiptHash(receipt, expectedHash) {
  return String(receipt.transactionHash).toLowerCase() === expectedHash.toLowerCase();
}

async function expectRejects(method, params) {
  try {
    await rpc(method, params);
  } catch (_error) {
    return true;
  }
  return false;
}

async function main() {
  const [from] = await rpc("qrl_accounts");
  const recipient = isHardhatQrlvm()
    ? "Q" + "02".repeat(64)
    : seedToAccount(process.env.QRL_PARITY_RECIPIENT_SEED).address;
  const blockBefore = BigInt(await rpc("qrl_blockNumber"));
  const recipientBefore = BigInt(await rpc("qrl_getBalance", [recipient, "latest"]));

  const Storage = await hre.qrl.getContractFactory("ParityStorage");
  const deployment = await Storage.deploy(
    txOptions(from, "0x300000"),
    "0x",
    { timeoutMs: WAIT_TIMEOUT_MS }
  );
  const deploymentReceipt = await wait(deployment.hash);
  const storage = await hre.qrl.getContractAt("ParityStorage", deployment.address);
  const [storedBefore] = await storage.callStatic.retrieve();

  const storeHash = await storage.functions.store(42, txOptions(from, "0x200000"));
  const storeReceipt = await wait(storeHash);
  const [storedAfter] = await storage.callStatic.retrieve();
  const decodedLogs = storage
    .decodeReceiptLogs(storeReceipt)
    .filter((log) => log.eventName === "ValueChanged");
  if (decodedLogs.length !== 1) {
    throw new Error(\`Expected one ValueChanged event, got \${decodedLogs.length}\`);
  }

  const transferHash = await hre.qrl.sendTransaction({
    ...txOptions(from, "0x5208"),
    to: recipient,
    value: "0x" + TRANSFER_VALUE.toString(16),
  });
  const transferReceipt = await wait(transferHash);

  const blockAfter = BigInt(await rpc("qrl_blockNumber"));
  const recipientAfter = BigInt(await rpc("qrl_getBalance", [recipient, "latest"]));
  const lookup = await rpc("qrl_getTransactionByHash", [storeHash]);
  const latestBlock = await rpc("qrl_getBlockByNumber", ["latest", true]);
  const code = await rpc("qrl_getCode", [deployment.address, "latest"]);

  const result = {
    network: hre.network.name,
    chainId: await rpc("qrl_chainId"),
    blockDelta: (blockAfter - blockBefore).toString(10),
    transferDelta: (recipientAfter - recipientBefore).toString(10),
    storedBefore: storedBefore.toString(10),
    storedAfter: storedAfter.toString(10),
    eventValue: decodedLogs[0].args.newValue.toString(10),
    deploymentStatus: normalizeStatus(deploymentReceipt.status),
    storeStatus: normalizeStatus(storeReceipt.status),
    transferStatus: normalizeStatus(transferReceipt.status),
    deploymentReceiptMatches: normalizeReceiptHash(deploymentReceipt, deployment.hash),
    storeReceiptMatches: normalizeReceiptHash(storeReceipt, storeHash),
    transferReceiptMatches: normalizeReceiptHash(transferReceipt, transferHash),
    transactionLookupMatches:
      lookup !== null && String(lookup.hash).toLowerCase() === storeHash.toLowerCase(),
    codeAvailable: typeof code === "string" && code !== "0x",
    latestBlockHasTransaction:
      Array.isArray(latestBlock.transactions) && latestBlock.transactions.length === 1,
    ethRpcRejected: await expectRejects("eth_blockNumber", []),
    rawTransactionRejected: await expectRejects("qrl_sendRawTransaction", ["0x00"]),
    deployGasUsedPositive: BigInt(deploymentReceipt.gasUsed) > 0n,
    storeGasUsedPositive: BigInt(storeReceipt.gasUsed) > 0n,
    transferGasUsedPositive: BigInt(transferReceipt.gasUsed) > 0n,
  };

  if (latestBlock.transactionsRoot !== undefined) {
    result.latestTransactionsRootNonEmpty = latestBlock.transactionsRoot !== EMPTY_TRIE_ROOT;
  }
  if (latestBlock.receiptsRoot !== undefined) {
    result.latestReceiptsRootNonEmpty = latestBlock.receiptsRoot !== EMPTY_TRIE_ROOT;
  }

  console.log("QRL_PARITY_RESULT=" + JSON.stringify(result));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}
