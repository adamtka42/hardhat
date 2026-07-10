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

function createLocalProviderWithReverter(
  overrides: Partial<{
    throwOnTransactionFailures: boolean;
    throwOnCallFailures: boolean;
  }> = {}
) {
  return new QrlLocalHardhatProvider({
    type: "qrl-local",
    chainId: 1337,
    blockGasLimit: 30000000,
    qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
    accounts: [{ address: SENDER, balance: "1000000000000" }],
    ...overrides,
  });
}

// Runtime: MSTORE(0, 42); REVERT(args=[0..64)) — reverts with a 64-byte
// payload ending in 0x2a.
const REVERTER_RUNTIME = [0x60, 0x2a, 0x5f, 0x52, 0x60, 0x40, 0x5f, 0xfd];

// Runtime: CODECOPY the trailing payload into memory, then REVERT with it.
function revertWithPayloadRuntime(payloadHex: string): number[] {
  const payload = Buffer.from(payloadHex, "hex");
  const lengthHi = Math.floor(payload.length / 256);
  const lengthLo = payload.length % 256;
  return [
    0x61,
    lengthHi,
    lengthLo,
    0x60,
    0x0c,
    0x5f,
    0x39,
    0x61,
    lengthHi,
    lengthLo,
    0x5f,
    0xfd,
    ...payload,
  ];
}

// Init code: CODECOPY the trailing runtime into memory and RETURN it.
async function deployRuntime(
  provider: QrlLocalHardhatProvider,
  runtime: number[]
): Promise<string> {
  const lengthHi = Math.floor(runtime.length / 256);
  const lengthLo = runtime.length % 256;
  const init = [
    0x61,
    lengthHi,
    lengthLo,
    0x60,
    0x0c,
    0x5f,
    0x39,
    0x61,
    lengthHi,
    lengthLo,
    0x5f,
    0xf3,
  ];
  const data = `0x${[...init, ...runtime]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

  const txHash = await provider.send("qrl_sendTransaction", [
    { from: SENDER, data, gas: "0x30d40" },
  ]);
  const receipt = await provider.send("qrl_getTransactionReceipt", [txHash]);
  assert.equal(receipt.status, "0x1");
  return receipt.contractAddress;
}

async function deployReverter(
  provider: QrlLocalHardhatProvider
): Promise<string> {
  return deployRuntime(provider, REVERTER_RUNTIME);
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

  it("throws on reverting transactions and keeps the receipt queryable", async () => {
    const provider = createLocalProviderWithReverter();
    const contractAddress = await deployReverter(provider);

    let caught: any;
    try {
      await provider.send("qrl_sendTransaction", [
        { from: SENDER, to: contractAddress, gas: "0x186a0" },
      ]);
    } catch (error) {
      caught = error;
    }

    assert.isDefined(caught);
    assert.match(caught.message, /revert/i);
    // The failed tx hash is part of the message and a field on the error.
    assert.match(caught.transactionHash, /^0x[0-9a-f]{64}$/);
    assert.include(caught.message, `tx: ${caught.transactionHash}`);
    // Raw revert data stays decodable for custom errors.
    assert.isTrue(caught.data.endsWith("2a"));

    const receipt = await provider.send("qrl_getTransactionReceipt", [
      caught.transactionHash,
    ]);
    assert.equal(receipt.status, "0x0");
  });

  it("returns silent status-0 receipts when throwOnTransactionFailures is false", async () => {
    const provider = createLocalProviderWithReverter({
      throwOnTransactionFailures: false,
    });
    const contractAddress = await deployReverter(provider);

    const txHash = await provider.send("qrl_sendTransaction", [
      { from: SENDER, to: contractAddress, gas: "0x186a0" },
    ]);

    const receipt = await provider.send("qrl_getTransactionReceipt", [txHash]);
    assert.equal(receipt.status, "0x0");
  });

  it("decodes Error(string) revert reasons in provider error messages", async () => {
    const provider = createLocalProviderWithReverter();
    // Runtime returning the canonical Error("locked") payload observed from
    // hypc: selector + 64-byte offset/length words + padded string.
    const errorStringData = `08c379a0${"40".padStart(128, "0")}${"6".padStart(
      128,
      "0"
    )}${Buffer.from("locked").toString("hex").padEnd(128, "0")}`;
    const contractAddress = await deployRuntime(
      provider,
      revertWithPayloadRuntime(errorStringData)
    );

    let caught: any;
    try {
      await provider.send("qrl_call", [
        { from: SENDER, to: contractAddress, gas: "0x186a0" },
      ]);
    } catch (error) {
      caught = error;
    }

    assert.isDefined(caught);
    assert.include(caught.message, "reason: 'locked'");
  });

  it("applies initialDate to the genesis block and supports time controls", async () => {
    const provider = new QrlLocalHardhatProvider({
      type: "qrl-local",
      chainId: 1337,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      initialDate: "2026-01-01T00:00:00Z",
      accounts: [{ address: SENDER, balance: "1000" }],
    });
    const genesisTimestamp = 1767225600;

    const genesis = await provider.send("qrl_getBlockByNumber", [
      "latest",
      false,
    ]);
    assert.equal(parseInt(genesis.timestamp, 16), genesisTimestamp);

    // Deliberate upstream-parity exception: decimal string, NOT a 0x quantity.
    const total = await provider.send("qrl_increaseTime", [3600]);
    assert.strictEqual(total, "3600");

    await provider.send("qrl_mine", []);
    const shifted = await provider.send("qrl_getBlockByNumber", [
      "latest",
      false,
    ]);
    assert.equal(parseInt(shifted.timestamp, 16), genesisTimestamp + 3601);

    const next = await provider.send("qrl_setNextBlockTimestamp", [
      genesisTimestamp + 10000,
    ]);
    assert.strictEqual(next, `${genesisTimestamp + 10000}`);

    await provider.send("qrl_mine", []);
    const overridden = await provider.send("qrl_getBlockByNumber", [
      "latest",
      false,
    ]);
    assert.equal(parseInt(overridden.timestamp, 16), genesisTimestamp + 10000);
  });

  it("fails with a Hardhat error for an invalid initialDate", function () {
    if (!hasQrlJsMonorepoDist()) {
      this.skip();
      return;
    }

    expectHardhatError(
      () =>
        new QrlLocalHardhatProvider({
          type: "qrl-local",
          qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
          initialDate: "not-a-date",
        }),
      ERRORS.NETWORK.INVALID_INITIAL_DATE
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
