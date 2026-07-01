import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import { ERRORS } from "../../../../src/internal/core/errors-list";
import { createProvider } from "../../../../src/internal/core/providers/construction";
import { QrlLocalHardhatProvider } from "../../../../src/internal/core/providers/qrl-local";
import {
  expectHardhatError,
  expectHardhatErrorAsync,
} from "../../../helpers/errors";

const SENDER = `Q${"01".repeat(64)}`;
const RECEIVER = `Q${"02".repeat(64)}`;
const PACKAGE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const HARDHAT_ROOT = path.join(PACKAGE_ROOT, "..", "..");
const ZOND_ROOT = path.dirname(HARDHAT_ROOT);
const LOCAL_QRLJS_MONOREPO_PATH = path.join(
  path.dirname(ZOND_ROOT),
  "qrljs-monorepo"
);
const QRLJS_MONOREPO_PATH =
  process.env.QRLJS_MONOREPO_PATH ?? LOCAL_QRLJS_MONOREPO_PATH;

function hasQrlJsMonorepoDist(): boolean {
  return fsExtra.pathExistsSync(
    path.join(QRLJS_MONOREPO_PATH, "packages", "vm", "dist", "cjs", "index.js")
  );
}

function createLocalProvider() {
  return new QrlLocalHardhatProvider({
    type: "qrl-local",
    chainId: 1337,
    blockGasLimit: 30000,
    qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
    accounts: [
      {
        address: SENDER,
        balance: "1000",
      },
    ],
  });
}

describe("QRL local Hardhat provider", function () {
  beforeEach(function () {
    const testTitle =
      this.currentTest === undefined ? "" : this.currentTest.title;

    if (testTitle.includes("fails with a Hardhat error")) {
      return;
    }

    if (!hasQrlJsMonorepoDist()) {
      this.skip();
    }
  });

  it("exposes local chain, account, gas, and transaction methods", async () => {
    const provider = createLocalProvider();

    assert.equal(await provider.send("qrl_chainId"), "0x539");
    assert.deepEqual(await provider.send("qrl_accounts"), [SENDER]);
    assert.deepEqual(await provider.send("qrl_requestAccounts"), [SENDER]);
    assert.equal(await provider.send("qrl_gasPrice"), "0x0");
    assert.equal(
      await provider.send("qrl_estimateGas", [
        {
          from: SENDER,
          to: RECEIVER,
          value: "0x1",
          maxFeePerGas: "0x0",
          maxPriorityFeePerGas: "0x0",
        },
      ]),
      "0x5208"
    );
    assert.equal(
      await provider.send("qrl_getBalance", [SENDER, "latest"]),
      "0x3e8"
    );
    assert.equal(await provider.send("qrl_blockNumber"), "0x0");

    const txHash = await provider.send("qrl_sendTransaction", [
      {
        from: SENDER,
        to: RECEIVER,
        gas: "0x5208",
        maxFeePerGas: "0x0",
        maxPriorityFeePerGas: "0x0",
        value: "0x2a",
      },
    ]);

    assert.match(txHash, /^0x[0-9a-f]{64}$/i);
    assert.equal(await provider.send("qrl_blockNumber"), "0x1");
    assert.equal(await provider.send("qrl_getBalance", [RECEIVER]), "0x2a");

    const receipt = await provider.send("qrl_getTransactionReceipt", [txHash]);
    assert.equal(receipt.status, "0x1");
    assert.equal(receipt.blockNumber, "0x1");
  });

  it("supports snapshots and reverts", async () => {
    const provider = createLocalProvider();
    const snapshot = await provider.send("qrl_snapshot");

    await provider.send("qrl_mine");
    assert.equal(await provider.send("qrl_blockNumber"), "0x1");

    assert.equal(await provider.send("qrl_revert", [snapshot]), true);
    assert.equal(await provider.send("qrl_blockNumber"), "0x0");
  });

  it("rejects legacy eth methods and raw local transactions", async () => {
    const provider = createLocalProvider();

    await expectHardhatErrorAsync(
      () => provider.send("eth_blockNumber"),
      ERRORS.NETWORK.LEGACY_ETH_RPC_UNSUPPORTED
    );
    await expectHardhatErrorAsync(
      () => provider.send("qrl_sendRawTransaction", ["0x00"]),
      ERRORS.GENERAL.UNSUPPORTED_OPERATION
    );
  });

  it("uses an explicit qrljs-monorepo path from the network config", async () => {
    const provider = new QrlLocalHardhatProvider({
      type: "qrl-local",
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      chainId: 1337,
      accounts: [{ address: SENDER, balance: "1000" }],
    });

    assert.equal(
      await provider.send("qrl_getBalance", [SENDER, "latest"]),
      "0x3e8"
    );
  });

  it("fails with a Hardhat error when qrljs-monorepo cannot be loaded", () => {
    const missingQrlJsMonorepoPath = path.resolve("missing-qrljs-monorepo");
    expectHardhatError(
      () =>
        new QrlLocalHardhatProvider({
          type: "qrl-local",
          qrlJsMonorepoPath: missingQrlJsMonorepoPath,
        }),
      ERRORS.NETWORK.QRLJS_MONOREPO_UNAVAILABLE,
      missingQrlJsMonorepoPath
    );
  });

  it("explains how to configure qrlLocal when qrljs-monorepo path is unset", () => {
    const previousQrlJsMonorepoPath = process.env.QRLJS_MONOREPO_PATH;
    delete process.env.QRLJS_MONOREPO_PATH;

    try {
      expectHardhatError(
        () =>
          new QrlLocalHardhatProvider({
            type: "qrl-local",
          }),
        ERRORS.NETWORK.QRLJS_MONOREPO_UNAVAILABLE,
        /QRLJS_MONOREPO_PATH.*--network qrl/s
      );
    } finally {
      if (previousQrlJsMonorepoPath === undefined) {
        delete process.env.QRLJS_MONOREPO_PATH;
      } else {
        process.env.QRLJS_MONOREPO_PATH = previousQrlJsMonorepoPath;
      }
    }
  });

  it("can be created through the standard provider factory", async () => {
    const provider = createProvider("qrlLocal", {
      type: "qrl-local",
      chainId: 1,
      from: SENDER,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      accounts: [{ address: SENDER, balance: "1000" }],
      blockGasLimit: 30000,
    });

    const txHash = await provider.send("qrl_sendTransaction", [
      {
        to: RECEIVER,
        value: "0x1",
      },
    ]);

    assert.match(txHash, /^0x[0-9a-f]{64}$/i);
    assert.equal(await provider.send("qrl_blockNumber"), "0x1");
  });
});
