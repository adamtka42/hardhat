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
const LOCAL_QRLJS_MONOREPO_PATH = path.join(
  path.dirname(ZOND_ROOT),
  "qrljs-monorepo"
);

// Proves the packed @theqrl/hardhat artifact is self-contained for
// `qrlLocal`: npm pack (prepack bundles the qrljs runtime), install the
// tarball into a clean project, and run a transfer WITHOUT
// QRLJS_MONOREPO_PATH or any qrljs checkout on a resolvable path.
describe("QRL packed artifact e2e", function () {
  useTmpDir("qrl-packed-e2e");

  it("starts qrlLocal from the packed artifact without a qrljs checkout", async function () {
    this.timeout(420000);

    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (qrlJsMonorepoPath === undefined) {
      // Packing itself needs a built checkout to bundle from.
      this.skip();
      return;
    }

    // npm pack runs prepack (build + bundle-qrljs-runtime).
    const packResult = await execFileAsync("npm", ["pack", "--json"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, QRLJS_MONOREPO_PATH: qrlJsMonorepoPath },
      maxBuffer: 1024 * 1024 * 20,
    });
    const packInfo = JSON.parse(packResult.stdout);
    // Older npm versions report the scoped filename (@theqrl/hardhat-x.tgz)
    // while the file on disk is theqrl-hardhat-x.tgz.
    const reportedName: string = packInfo[0].filename;
    const normalizedName = reportedName.replace("@", "").replace("/", "-");
    const reportedPath = path.join(PACKAGE_ROOT, reportedName);
    const resolvedTarball = (await fsExtra.pathExists(reportedPath))
      ? reportedPath
      : path.join(PACKAGE_ROOT, normalizedName);

    try {
      // The tarball must carry the bundled runtime (files-field regression).
      const fileList = packInfo[0].files.map((f: any) => f.path);
      assert.include(fileList, "qrljs-runtime/runtime.cjs");
      assert.include(fileList, "qrljs-runtime/manifest.json");
      assert.include(fileList, "qrljs-runtime/THIRD_PARTY_LICENSES");

      // Extract the artifact and give it its npm dependency closure through
      // NODE_PATH (registry installation is exercised by normal npm
      // behavior; the assertion here is qrljs-checkout independence, not
      // registry availability).
      await execFileAsync("tar", ["-xzf", resolvedTarball, "-C", this.tmpDir]);
      const packageDir = path.join(this.tmpDir, "package");

      const projectDir = path.join(this.tmpDir, "project");
      await prepareProject(projectDir);

      // Scrub every path that could leak the developer's checkout.
      const env = { ...process.env };
      delete env.QRLJS_MONOREPO_PATH;
      delete env.HARDHAT_NETWORK;
      env.NODE_PATH = [
        path.join(PACKAGE_ROOT, "node_modules"),
        path.join(HARDHAT_ROOT, "node_modules"),
      ].join(path.delimiter);

      const result = await execFileAsync(
        process.execPath,
        [
          path.join(packageDir, "internal", "cli", "cli.js"),
          "run",
          "--no-compile",
          "scripts/transfer.js",
        ],
        { cwd: projectDir, env, maxBuffer: 1024 * 1024 * 20 }
      );

      assert.include(result.stdout, "TRANSFER-OK balance=0x64");
    } finally {
      await fsExtra.remove(resolvedTarball);
    }
  });
});

async function prepareProject(projectDir: string) {
  await fsExtra.ensureDir(path.join(projectDir, "scripts"));

  await fsExtra.writeFile(
    path.join(projectDir, "hardhat.config.js"),
    `module.exports = {
  defaultNetwork: "qrlLocal",
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      accounts: [
        { address: "Q${"01".repeat(64)}", balance: "1000000000000" },
      ],
    },
  },
};
`
  );

  await fsExtra.writeFile(
    path.join(projectDir, "scripts", "transfer.js"),
    `async function main() {
  const from = "Q${"01".repeat(64)}";
  const to = "Q${"02".repeat(64)}";
  const hash = await network.provider.send("qrl_sendTransaction", [
    { from, to, value: "0x64" },
  ]);
  const receipt = await network.provider.send("qrl_getTransactionReceipt", [
    hash,
  ]);
  if (receipt.status !== "0x1") {
    throw new Error("transfer failed");
  }
  const balance = await network.provider.send("qrl_getBalance", [
    to,
    "latest",
  ]);
  console.log("TRANSFER-OK balance=" + balance);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
`
  );
}

function resolveQrlJsMonorepoPath(): string | undefined {
  if (process.env.QRLJS_MONOREPO_PATH !== undefined) {
    return process.env.QRLJS_MONOREPO_PATH;
  }

  if (
    fsExtra.pathExistsSync(
      path.join(LOCAL_QRLJS_MONOREPO_PATH, "packages", "vm", "dist")
    )
  ) {
    return LOCAL_QRLJS_MONOREPO_PATH;
  }

  return undefined;
}
