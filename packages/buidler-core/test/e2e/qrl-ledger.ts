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
const LEDGER_DEFAULT_PATH_APDU =
  "e005000015058000002c800000ee800000000000000000000000";
const MIN_LEDGER_BALANCE_HEX = "0xde0b6b3a7640000";
const LEDGER_FUND_AMOUNT_HEX = "0x4563918244f40000";

describe("QRL Ledger e2e", function () {
  useTmpDir("qrl-ledger-e2e");

  before(function () {
    if (process.env.QRL_HARDHAT_LEDGER_E2E !== "1") {
      this.skip();
      return;
    }

    if (
      process.env.QRL_HARDHAT_LEDGER_E2E_ACCOUNT === undefined &&
      process.env.QRL_HARDHAT_LEDGER_SPECULOS_URL === undefined
    ) {
      throw new Error(
        "QRL_HARDHAT_LEDGER_E2E_ACCOUNT or QRL_HARDHAT_LEDGER_SPECULOS_URL must be set"
      );
    }
  });

  it("signs QRL transfers and contract transactions from a Ledger account", async function () {
    this.timeout(600000);

    const hypcPath = resolveHypcPath();
    assert.isDefined(hypcPath, "hypc must be available for QRL Ledger e2e");

    const rpcUrl =
      process.env.QRL_HARDHAT_LEDGER_E2E_RPC_URL ?? DEFAULT_RPC_URL;
    const ledgerAccount = await resolveLedgerAccount();
    assert.match(
      ledgerAccount,
      /^Q[0-9a-fA-F]{128}$/,
      "QRL Ledger e2e account must be a 64-byte QRL address"
    );

    await fundLedgerAccountIfNeeded(ledgerAccount, rpcUrl);

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await execFileAsync("node", ["scripts/qrl-ledger-e2e.js"], {
      cwd: this.tmpDir,
      env: {
        ...process.env,
        HYPERION_HYPC_PATH: hypcPath!,
        QRL_HARDHAT_LEDGER_E2E_ACCOUNT: ledgerAccount,
        QRL_HARDHAT_LEDGER_E2E_RPC_URL: rpcUrl,
      },
      maxBuffer: 1024 * 1024 * 20,
    });
  });
});

async function prepareProject(projectRoot: string) {
  await fsExtra.ensureDir(path.join(projectRoot, "contracts"));
  await fsExtra.ensureDir(path.join(projectRoot, "scripts"));
  await fsExtra.ensureDir(path.join(projectRoot, "node_modules", "@theqrl"));

  await fsExtra.remove(
    path.join(projectRoot, "node_modules", "@theqrl", "hardhat")
  );
  await fsExtra.symlink(
    PACKAGE_ROOT,
    path.join(projectRoot, "node_modules", "@theqrl", "hardhat"),
    "dir"
  );
  await fsExtra.symlink(
    path.join(PACKAGE_ROOT, "node_modules", "@theqrl", "web3-qrl-accounts"),
    path.join(projectRoot, "node_modules", "@theqrl", "web3-qrl-accounts"),
    "dir"
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
    path.join(projectRoot, "scripts", "qrl-ledger-e2e.js"),
    getScriptSource()
  );
}

function getConfigSource(): string {
  return `
module.exports = {
  defaultNetwork: "qrlLedgerE2E",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    qrlLedgerE2E: {
      url: process.env.QRL_HARDHAT_LEDGER_E2E_RPC_URL,
      accounts: {
        type: "ledger",
        accounts: [process.env.QRL_HARDHAT_LEDGER_E2E_ACCOUNT],
        maxDerivationAccounts: Number(process.env.QRL_HARDHAT_LEDGER_E2E_MAX_DERIVATION_ACCOUNTS || 20),
      },
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
const {
  FeeMarketEIP1559Transaction,
  seedToAccount,
  signTransaction,
} = require("@theqrl/web3-qrl-accounts");

const WAIT_TIMEOUT_MS = 300000;
const LOCAL_DEPLOYER_SEED =
  process.env.QRL_HARDHAT_LEDGER_E2E_DEPLOYER_SEED ||
  "${LOCAL_ACCOUNT_SEED}";

async function wait(hash) {
  const receipt = await hre.qrl.waitForTransaction(hash, WAIT_TIMEOUT_MS);
  if (receipt.status !== "0x1" && receipt.status !== 1 && receipt.status !== true) {
    throw new Error(\`Transaction \${hash} failed with status \${receipt.status}\`);
  }
  return receipt;
}

async function rpc(method, params = []) {
  return hre.network.provider.send(method, params);
}

async function getChainId() {
  try {
    return parseInt(await rpc("qrl_chainId"), 16);
  } catch (_error) {
    const netVersion = await rpc("net_version");
    return netVersion.startsWith("0x")
      ? parseInt(netVersion, 16)
      : parseInt(netVersion, 10);
  }
}

async function sendLocalTransaction(tx, seed) {
  const account = seedToAccount(seed);
  const nonce = await rpc("qrl_getTransactionCount", [account.address, "pending"]);
  const chainId = await getChainId();
  const transaction = FeeMarketEIP1559Transaction.fromTxData({
    type: "0x2",
    chainId,
    nonce,
    gasLimit: tx.gas || tx.gasLimit || "0x300000",
    maxFeePerGas: tx.maxFeePerGas || "0xba43b7400",
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas || "0xba43b7400",
    to: tx.to,
    value: tx.value || "0x0",
    data: tx.data || "0x",
    accessList: [],
  });
  const signed = await signTransaction(transaction, seed);
  return rpc("qrl_sendRawTransaction", [signed.rawTransaction]);
}

async function deployStorageWithLocalSeed() {
  const artifact = await hre.qrl.readArtifact("Storage");
  const hash = await sendLocalTransaction({ data: artifact.bytecode }, LOCAL_DEPLOYER_SEED);
  const receipt = await wait(hash);
  if (!receipt.contractAddress) {
    throw new Error("Storage deployment did not return a contract address");
  }
  return receipt.contractAddress;
}

async function main() {
  await hre.run("compile");

  const expectedAccount = process.env.QRL_HARDHAT_LEDGER_E2E_ACCOUNT;
  const accounts = await hre.network.provider.send("qrl_accounts");
  if (!accounts.some((account) => account.toLowerCase() === expectedAccount.toLowerCase())) {
    throw new Error(\`Ledger account \${expectedAccount} was not returned by qrl_accounts\`);
  }

  const txHash = await hre.network.provider.send("qrl_sendTransaction", [
    {
      from: expectedAccount,
      to: expectedAccount,
      value: "0x0",
      gas: "0x5208",
      maxFeePerGas: "0x861c4687",
      maxPriorityFeePerGas: "0x861c4680",
    },
  ]);

  await wait(txHash);

  const storageAddress = await deployStorageWithLocalSeed();
  const storage = await hre.qrl.getContractAt("Storage", storageAddress);

  const storeReceipt = await wait(
    await storage.functions.store(42, {
      from: expectedAccount,
      gas: "0x200000",
      maxFeePerGas: "0xba43b7400",
      maxPriorityFeePerGas: "0xba43b7400",
    })
  );
  const decodedLogs = storage
    .decodeReceiptLogs(storeReceipt)
    .filter((log) => log.eventName === "ValueChanged");
  if (decodedLogs.length !== 1) {
    throw new Error(\`Expected one ValueChanged event, got \${decodedLogs.length}\`);
  }
  if (decodedLogs[0].args.newValue.toString(10) !== "42") {
    throw new Error(\`Expected ValueChanged(42), got \${decodedLogs[0].args.newValue}\`);
  }

  const [stored] = await storage.callStatic.retrieve();
  if (stored.toString(10) !== "42") {
    throw new Error(\`Expected stored value 42, got \${stored}\`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}

async function resolveLedgerAccount(): Promise<string> {
  if (process.env.QRL_HARDHAT_LEDGER_E2E_ACCOUNT !== undefined) {
    return process.env.QRL_HARDHAT_LEDGER_E2E_ACCOUNT;
  }

  const speculosUrl = process.env.QRL_HARDHAT_LEDGER_SPECULOS_URL!;
  const response = await postJson(`${speculosUrl.replace(/\/$/, "")}/apdu`, {
    data: LEDGER_DEFAULT_PATH_APDU,
  });
  const data = response.data;
  if (
    typeof data !== "string" ||
    !data.endsWith("9000") ||
    data.length !== 2 + 128 + 4
  ) {
    throw new Error(`Unexpected Speculos address response: ${data}`);
  }

  return `Q${data.slice(2, -4)}`;
}

async function fundLedgerAccountIfNeeded(account: string, rpcUrl: string) {
  const balance = await rpc(rpcUrl, "qrl_getBalance", [account, "latest"]);
  if (isRpcQuantityAtLeast(balance, MIN_LEDGER_BALANCE_HEX)) {
    return;
  }

  const {
    FeeMarketEIP1559Transaction,
    seedToAccount,
    signTransaction,
  } = require("@theqrl/web3-qrl-accounts");
  const funder = seedToAccount(
    process.env.QRL_HARDHAT_LEDGER_E2E_FUNDING_SEED ?? LOCAL_ACCOUNT_SEED
  );
  const nonce = await rpc(rpcUrl, "qrl_getTransactionCount", [
    funder.address,
    "pending",
  ]);
  const chainId = await getChainId(rpcUrl);
  const transaction = FeeMarketEIP1559Transaction.fromTxData({
    type: "0x2",
    chainId,
    nonce,
    gasLimit: "0x5208",
    maxFeePerGas: "0xba43b7400",
    maxPriorityFeePerGas: "0xba43b7400",
    to: account,
    value: LEDGER_FUND_AMOUNT_HEX,
    data: "0x",
    accessList: [],
  });
  const signed = await signTransaction(
    transaction,
    process.env.QRL_HARDHAT_LEDGER_E2E_FUNDING_SEED ?? LOCAL_ACCOUNT_SEED
  );
  const hash = await rpc(rpcUrl, "qrl_sendRawTransaction", [
    signed.rawTransaction,
  ]);
  await waitForReceipt(rpcUrl, hash, 120000);
}

async function getChainId(rpcUrl: string): Promise<number> {
  try {
    return parseInt(await rpc(rpcUrl, "qrl_chainId"), 16);
  } catch (_error) {
    const netVersion = await rpc(rpcUrl, "net_version");
    return netVersion.startsWith("0x")
      ? parseInt(netVersion, 16)
      : parseInt(netVersion, 10);
  }
}

async function waitForReceipt(rpcUrl: string, hash: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const receipt = await rpc(rpcUrl, "qrl_getTransactionReceipt", [hash]);
    if (receipt !== null && receipt !== undefined) {
      if (
        receipt.status === false ||
        receipt.status === "0x0" ||
        receipt.status === 0
      ) {
        throw new Error(`Funding transaction ${hash} failed`);
      }
      return receipt;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for funding transaction ${hash}`);
}

async function rpc(rpcUrl: string, method: string, params: any[] = []) {
  const result = await postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  if (result.error !== undefined) {
    throw new Error(`${method}: ${result.error.message}`);
  }
  return result.result;
}

async function postJson(url: string, body: any) {
  const fetch = require("node-fetch");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url} responded with status ${response.status}`);
  }
  return response.json();
}

function isRpcQuantityAtLeast(actual: string, minimum: string): boolean {
  const normalizedActual = normalizeRpcQuantity(actual);
  const normalizedMinimum = normalizeRpcQuantity(minimum);

  return (
    normalizedActual.length > normalizedMinimum.length ||
    (normalizedActual.length === normalizedMinimum.length &&
      normalizedActual.localeCompare(normalizedMinimum) >= 0)
  );
}

function normalizeRpcQuantity(value: string): string {
  const normalized = value.replace(/^0x0*/i, "").toLowerCase();
  return normalized === "" ? "0" : normalized;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
