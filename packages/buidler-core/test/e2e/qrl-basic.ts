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

describe("QRL basic e2e", function () {
  useTmpDir("qrl-basic-e2e");

  before(function () {
    if (process.env.QRL_HARDHAT_E2E !== "1") {
      this.skip();
      return;
    }
  });

  it("sends native QRL and calls a contract with ABI arguments", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    assert.isDefined(hypcPath, "hypc must be available for QRL e2e tests");

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await execFileAsync("node", ["scripts/qrl-basic-e2e.js"], {
      cwd: this.tmpDir,
      env: {
        ...process.env,
        HYPERION_HYPC_PATH: hypcPath!,
        QRL_HARDHAT_E2E_ACCOUNT_SEED:
          process.env.QRL_HARDHAT_E2E_ACCOUNT_SEED ?? LOCAL_ACCOUNT_SEED,
        QRL_HARDHAT_E2E_RECIPIENT_SEED:
          process.env.QRL_HARDHAT_E2E_RECIPIENT_SEED ?? RECIPIENT_ACCOUNT_SEED,
        QRL_HARDHAT_E2E_RPC_URL:
          process.env.QRL_HARDHAT_E2E_RPC_URL ?? DEFAULT_RPC_URL,
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
    path.join(projectRoot, "scripts", "qrl-basic-e2e.js"),
    getScriptSource()
  );
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

function getConfigSource(): string {
  return `
module.exports = {
  defaultNetwork: "qrlBasicE2E",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    qrlBasicE2E: {
      url: process.env.QRL_HARDHAT_E2E_RPC_URL,
      accounts: [process.env.QRL_HARDHAT_E2E_ACCOUNT_SEED],
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
const { seedToAccount } = require("@theqrl/web3-qrl-accounts");

const WAIT_TIMEOUT_MS = 300000;
const TRANSFER_VALUE = 100000000000000000n;

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

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(\`\${label}: expected \${expected}, got \${actual}\`);
  }
}

async function checkNativeTransfer(from, recipient) {
  const beforeRecipientBalance = BigInt(
    await rpc("qrl_getBalance", [recipient, "latest"])
  );
  const txHash = await hre.qrl.sendTransaction({
    from,
    to: recipient,
    value: "0x" + TRANSFER_VALUE.toString(16),
    gas: "0x5208",
    maxFeePerGas: "0x861c4687",
    maxPriorityFeePerGas: "0x861c4680",
  });
  const receipt = await wait(txHash);
  if (receipt.transactionHash !== txHash) {
    throw new Error(\`Receipt hash mismatch: expected \${txHash}, got \${receipt.transactionHash}\`);
  }

  const afterRecipientBalance = BigInt(
    await rpc("qrl_getBalance", [recipient, "latest"])
  );
  assertEqual(
    afterRecipientBalance - beforeRecipientBalance,
    TRANSFER_VALUE,
    "native transfer recipient delta"
  );
}

async function checkStorageContract(from) {
  await hre.run("compile");

  const Storage = await hre.qrl.getContractFactory("Storage");
  const deployment = await Storage.deploy(
    {
      from,
      gas: "0x300000",
      maxFeePerGas: "0xba43b7400",
      maxPriorityFeePerGas: "0xba43b7400",
    },
    "0x",
    { timeoutMs: WAIT_TIMEOUT_MS }
  );
  const storage = await hre.qrl.getContractAt("Storage", deployment.address);

  const storeReceipt = await wait(
    await storage.functions.store(42, {
      from,
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
  assertEqual(decodedLogs[0].args.newValue.toString(10), "42", "ValueChanged event");

  const [stored] = await storage.callStatic.retrieve();
  assertEqual(stored.toString(10), "42", "stored value");
}

async function main() {
  const [from] = await rpc("qrl_accounts");
  const recipient = seedToAccount(process.env.QRL_HARDHAT_E2E_RECIPIENT_SEED).address;

  await checkNativeTransfer(from, recipient);
  await checkStorageContract(from);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}
