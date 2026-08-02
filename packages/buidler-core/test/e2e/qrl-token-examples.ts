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
const QRL_TOKEN_EXAMPLES_ROOT = path.join(ZOND_ROOT, "qrl-token-examples");
const QRL_CONTRACTS_ROOT = path.join(ZOND_ROOT, "qrl-contracts");
const LOCAL_HYPC_PATH = path.join(
  ZOND_ROOT,
  "hyperion",
  "build",
  "hypc",
  "hypc"
);

describe("QRL token examples e2e", function () {
  useTmpDir("qrl-token-examples-e2e");

  before(function () {
    if (process.env.QRL_HARDHAT_E2E !== "1") {
      this.skip();
      return;
    }
  });

  it("deploys and exercises QRL20 and QrlNFT on a live QRL network", async function () {
    this.timeout(600000);

    const hypcPath = resolveHypcPath();
    assert.isDefined(hypcPath, "hypc must be available for QRL e2e tests");

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);
    await execFileAsync("node", ["scripts/qrl-token-e2e.js"], {
      cwd: this.tmpDir,
      env: {
        ...process.env,
        HYPERION_HYPC_PATH: hypcPath!,
        QRL_HARDHAT_E2E_ACCOUNT_SEED:
          process.env.QRL_HARDHAT_E2E_ACCOUNT_SEED ?? LOCAL_ACCOUNT_SEED,
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
  await fsExtra.ensureDir(path.join(projectRoot, "@theqrl"));
  await fsExtra.ensureDir(path.join(projectRoot, "node_modules", "@theqrl"));

  await fsExtra.copy(
    path.join(QRL_TOKEN_EXAMPLES_ROOT, "contracts", "QRL20.hyp"),
    path.join(projectRoot, "contracts", "QRL20.hyp")
  );
  await fsExtra.copy(
    path.join(QRL_TOKEN_EXAMPLES_ROOT, "contracts", "QrlNFT.hyp"),
    path.join(projectRoot, "contracts", "QrlNFT.hyp")
  );

  await symlinkPackage(
    PACKAGE_ROOT,
    path.join(projectRoot, "node_modules", "@theqrl", "hardhat")
  );
  await symlinkPackage(
    QRL_CONTRACTS_ROOT,
    path.join(projectRoot, "node_modules", "@theqrl", "qrl-contracts")
  );
  await fsExtra.copy(
    QRL_CONTRACTS_ROOT,
    path.join(projectRoot, "@theqrl", "qrl-contracts")
  );

  await fsExtra.writeFile(
    path.join(projectRoot, "hardhat.config.js"),
    getConfigSource()
  );
  await fsExtra.writeFile(
    path.join(projectRoot, "scripts", "qrl-token-e2e.js"),
    getScriptSource()
  );
}

async function symlinkPackage(target: string, linkPath: string) {
  await fsExtra.remove(linkPath);
  await fsExtra.ensureDir(path.dirname(linkPath));
  await fsExtra.symlink(target, linkPath, "dir");
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
  defaultNetwork: "qrlE2E",
  networks: {
    qrlE2E: {
      url: process.env.QRL_HARDHAT_E2E_RPC_URL,
      accounts: [process.env.QRL_HARDHAT_E2E_ACCOUNT_SEED],
    },
  },
};
`;
}

function getScriptSource(): string {
  return `
const hre = require("@theqrl/hardhat");

const WAIT_OPTIONS = { timeoutMs: 300000 };

async function wait(hash) {
  const receipt = await hre.qrl.waitForTransaction(
    hash,
    WAIT_OPTIONS.timeoutMs
  );
  if (receipt.status !== "0x1" && receipt.status !== 1 && receipt.status !== true) {
    throw new Error(\`Transaction \${hash} failed with status \${receipt.status}\`);
  }
  return receipt;
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(\`\${label}: expected \${expected}, got \${actual}\`);
  }
}

async function runQRL20(from) {
  const QRL20 = await hre.qrl.getContractFactory("QRL20");
  const deployment = await QRL20.deploy({ from }, [
    "Hardhat QRL20",
    "HQ20",
    8,
    1000,
    0,
  ], WAIT_OPTIONS);
  const token = await hre.qrl.getContractAt("QRL20", deployment.address);

  const [name] = await token.callStatic.name();
  const [symbol] = await token.callStatic.symbol();
  const [decimals] = await token.callStatic.decimals();
  const [initialBalance] = await token.callStatic.balanceOf(from);
  assertEqual(name, "Hardhat QRL20", "QRL20 name");
  assertEqual(symbol, "HQ20", "QRL20 symbol");
  assertEqual(decimals.toString(10), "8", "QRL20 decimals");
  assertEqual(initialBalance.toString(10), "1000", "QRL20 initial balance");

  const transferReceipt = await wait(
    await token.functions.transfer(from, 125, { from })
  );
  const decodedTransfers = token
    .decodeReceiptLogs(transferReceipt)
    .filter((log) => log.eventName === "Transfer");
  if (decodedTransfers.length !== 1) {
    throw new Error(\`Expected one QRL20 Transfer event, got \${decodedTransfers.length}\`);
  }
  assertEqual(decodedTransfers[0].args.value.toString(10), "125", "QRL20 transfer event value");

  await wait(await token.functions.mint(from, 250, { from }));
  const [mintedBalance] = await token.callStatic.balanceOf(from);
  assertEqual(mintedBalance.toString(10), "1250", "QRL20 minted balance");
}

async function runQrlNFT(from) {
  const QrlNFT = await hre.qrl.getContractFactory("QrlNFT");
  const deployment = await QrlNFT.deploy({ from }, [
    "Hardhat NFT",
    "HNFT",
    "ipfs://base/",
    10,
    from,
    500,
  ], WAIT_OPTIONS);
  const nft = await hre.qrl.getContractAt("QrlNFT", deployment.address);

  const [name] = await nft.callStatic.name();
  const [symbol] = await nft.callStatic.symbol();
  assertEqual(name, "Hardhat NFT", "NFT name");
  assertEqual(symbol, "HNFT", "NFT symbol");

  const mintReceipt = await wait(await nft.functions.mint(from, "token-0", { from }));
  const decodedTransfers = nft
    .decodeReceiptLogs(mintReceipt)
    .filter((log) => log.eventName === "Transfer");
  if (decodedTransfers.length !== 1) {
    throw new Error(\`Expected one NFT Transfer event, got \${decodedTransfers.length}\`);
  }
  assertEqual(decodedTransfers[0].args.to.toLowerCase(), from.toLowerCase(), "NFT transfer to");
  assertEqual(decodedTransfers[0].args.tokenId.toString(10), "0", "NFT token id");

  const [owner] = await nft.callStatic.ownerOf(0);
  const [uri] = await nft.callStatic.tokenURI(0);
  const [totalMinted] = await nft.callStatic.totalMinted();
  assertEqual(owner.toLowerCase(), from.toLowerCase(), "NFT owner");
  assertEqual(uri, "ipfs://base/token-0", "NFT token URI");
  assertEqual(totalMinted.toString(10), "1", "NFT total minted");
}

async function main() {
  await hre.run("compile");
  const [from] = await hre.network.provider.send("qrl_accounts");
  await runQRL20(from);
  await runQrlNFT(from);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}
