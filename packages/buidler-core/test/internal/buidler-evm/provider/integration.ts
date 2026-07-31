import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import { HardhatQrlvmProvider } from "../../../../src/internal/buidler-evm/provider/provider";
import { QRL_CONSOLE_LOG_ADDRESS } from "../../../../src/internal/buidler-evm/stack-traces/consoleLogger";
import { ERRORS } from "../../../../src/internal/core/errors-list";
import { createProvider } from "../../../../src/internal/core/providers/construction";
import { expectHardhatErrorAsync } from "../../../helpers/errors";

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
  return new HardhatQrlvmProvider({
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
    allowUnlimitedContractSize: boolean;
  }> = {}
) {
  return new HardhatQrlvmProvider({
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

// Runtime: MSTORE(0, 42); STATICCALL(gas, CONSOLE, args=[0..64), ret=[]); STOP.
const CONSOLE_PROBE_RUNTIME = [
  0x60,
  0x2a,
  0x5f,
  0x52,
  0x5f,
  0x5f,
  0x60,
  0x40,
  0x5f,
  0x9f,
  ...Buffer.from(QRL_CONSOLE_LOG_ADDRESS.slice(1), "hex"),
  0x61,
  0x10,
  0x00,
  0xfa,
  0x00,
];

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
  provider: HardhatQrlvmProvider,
  runtime: number[]
): Promise<string> {
  const data = runtimeDeploymentData(runtime);

  const txHash = await provider.send("qrl_sendTransaction", [
    { from: SENDER, data, gas: "0x30d40" },
  ]);
  const receipt = await provider.send("qrl_getTransactionReceipt", [txHash]);
  assert.equal(receipt.status, "0x1");
  return receipt.contractAddress;
}

function runtimeDeploymentData(runtime: number[]): string {
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
  return `0x${[...init, ...runtime]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function createConsoleProvider(
  automine: boolean = true
): {
  provider: HardhatQrlvmProvider;
  received: Uint8Array[];
} {
  const provider = new HardhatQrlvmProvider({
    chainId: 1337,
    blockGasLimit: 30000000,
    qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
    accounts: [{ address: SENDER, balance: "1000000000000" }],
    automine,
    loggingEnabled: true,
  });
  const received: Uint8Array[] = [];
  (provider as any)._logConsoleLog = (data: Uint8Array) => {
    received.push(new Uint8Array(data));
  };
  return { provider, received };
}

async function captureConsoleLogs(
  action: () => Promise<void>
): Promise<string[]> {
  const output: string[] = [];
  const originalLog = console.log;
  (console as any).log = (...args: any[]) => {
    output.push(args.map(String).join(" "));
  };

  try {
    await action();
    return output;
  } finally {
    console.log = originalLog;
  }
}

async function deployReverter(provider: HardhatQrlvmProvider): Promise<string> {
  return deployRuntime(provider, REVERTER_RUNTIME);
}

describe("Hardhat QRLVM provider", function () {
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

  it("serializes concurrent requests and releases the lock after errors", async () => {
    const provider = createLocalProvider();
    let activeRequests = 0;
    let maximumActiveRequests = 0;

    (provider as any)._send = async (method: string) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;

      if (method === "qrl_fail") {
        throw new Error("expected failure");
      }

      return method;
    };

    const results = await Promise.all([
      provider.send("qrl_first"),
      provider.send("qrl_second"),
    ]);

    assert.deepEqual(results, ["qrl_first", "qrl_second"]);
    assert.equal(maximumActiveRequests, 1);

    try {
      await provider.send("qrl_fail");
      assert.fail("the delegated request should fail");
    } catch (error) {
      assert.equal((error as Error).message, "expected failure");
    }

    assert.equal(await provider.send("qrl_after_failure"), "qrl_after_failure");
  });

  it("initializes the node and modules lazily exactly once", async () => {
    const provider = createLocalProvider();
    const internalProvider = provider as any;

    for (const field of [
      "_node",
      "_qrlModule",
      "_netModule",
      "_web3Module",
      "_evmModule",
      "_buidlerModule",
      "_debugModule",
    ]) {
      assert.isUndefined(internalProvider[field]);
    }

    await provider.send("qrl_chainId");

    const initialized = [
      internalProvider._node,
      internalProvider._qrlModule,
      internalProvider._netModule,
      internalProvider._web3Module,
      internalProvider._evmModule,
      internalProvider._buidlerModule,
      internalProvider._debugModule,
    ];
    initialized.forEach((value) => assert.isDefined(value));
    assert.deepEqual(
      await internalProvider._qrlModule.processRequest("qrl_accounts"),
      [SENDER]
    );
    assert.equal(
      await internalProvider._qrlModule.processRequest("qrl_chainId"),
      "0x539"
    );

    await provider.send("qrl_chainId");

    assert.deepEqual(
      [
        internalProvider._node,
        internalProvider._qrlModule,
        internalProvider._netModule,
        internalProvider._web3Module,
        internalProvider._evmModule,
        internalProvider._buidlerModule,
        internalProvider._debugModule,
      ],
      initialized
    );
  });

  it("routes supported namespaces and rejects unknown methods", async () => {
    const provider = createLocalProvider();

    assert.equal(await provider.send("net_version"), "1337");
    assert.equal(
      await provider.send("web3_clientVersion"),
      "QRLLocalProvider/qrljs"
    );

    for (const method of ["qrl_unknown", "unknown_method"]) {
      try {
        await provider.send(method);
        assert.fail("unknown method should be rejected");
      } catch (error) {
        assert.equal((error as any).code, -32601);
      }
    }
  });

  it("does not log methods when provider logging is disabled", async () => {
    const output = await captureConsoleLogs(async () => {
      await createLocalProvider().send("qrl_chainId");
    });

    assert.deepEqual(output, []);
  });

  it("logs QRL calls, transactions, and method errors", async () => {
    const provider = new HardhatQrlvmProvider({
      chainId: 1337,
      blockGasLimit: 30000,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      loggingEnabled: true,
      accounts: [{ address: SENDER, balance: "1000" }],
    });

    const transactionOutput = await captureConsoleLogs(async () => {
      await provider.send("qrl_sendTransaction", [
        {
          from: SENDER,
          to: RECEIVER,
          gas: "0x5208",
          maxFeePerGas: "0x0",
          maxPriorityFeePerGas: "0x0",
          value: "0x2a",
        },
      ]);
    });
    const transactionLog = transactionOutput.join("\n");
    assert.include(transactionLog, "qrl_sendTransaction");
    assert.include(transactionLog, "Transaction:");
    assert.include(transactionLog, "From:");
    assert.include(transactionLog, "To:");
    assert.include(transactionLog, "Value:");
    assert.include(transactionLog, "Gas used:");
    assert.include(transactionLog, "Block #1:");

    const callOutput = await captureConsoleLogs(async () => {
      await provider.send("qrl_call", [
        { from: SENDER, to: RECEIVER, gas: "0x5208" },
      ]);
    });
    const callLog = callOutput.join("\n");
    assert.include(callLog, "qrl_call");
    assert.include(callLog, "Contract call:");
    assert.include(callLog, "Gas limit:");

    const privateOutput = await captureConsoleLogs(async () => {
      await provider.send("qrl_getStackTraceFailuresCount");
    });
    assert.deepEqual(privateOutput, []);

    const errorOutput = await captureConsoleLogs(async () => {
      try {
        await provider.send("unknown_method");
        assert.fail("unknown method should be rejected");
      } catch (error) {
        assert.equal((error as any).code, -32601);
      }
    });
    assert.include(
      errorOutput.join("\n"),
      "unknown_method - Method not supported"
    );
  });

  it("owns console logging for transactions and calls, but not estimation", async () => {
    const { provider, received } = createConsoleProvider();

    await captureConsoleLogs(async () => {
      const contractAddress = await deployRuntime(
        provider,
        CONSOLE_PROBE_RUNTIME
      );
      received.length = 0;

      await provider.send("qrl_sendTransaction", [
        { from: SENDER, to: contractAddress, gas: "0x186a0" },
      ]);
      assert.lengthOf(received, 1);

      await provider.send("qrl_call", [
        { from: SENDER, to: contractAddress, gas: "0x186a0" },
      ]);
      assert.lengthOf(received, 2);

      await provider.send("qrl_estimateGas", [
        { from: SENDER, to: contractAddress },
      ]);
      assert.lengthOf(received, 2);
    });

    for (const payload of received) {
      assert.lengthOf(payload, 64);
      assert.equal(payload[63], 0x2a);
    }
  });

  it("emits pending console logs once across mining and snapshot revert", async () => {
    const { provider, received } = createConsoleProvider(false);

    await captureConsoleLogs(async () => {
      const deployHash = await provider.send("qrl_sendTransaction", [
        {
          from: SENDER,
          data: runtimeDeploymentData(CONSOLE_PROBE_RUNTIME),
          gas: "0x30d40",
        },
      ]);
      await provider.send("qrl_mine");
      const deployReceipt = await provider.send("qrl_getTransactionReceipt", [
        deployHash,
      ]);
      assert.equal(deployReceipt.status, "0x1");
      received.length = 0;

      const snapshot = await provider.send("qrl_snapshot");
      await provider.send("qrl_sendTransaction", [
        {
          from: SENDER,
          to: deployReceipt.contractAddress,
          gas: "0x186a0",
        },
      ]);
      assert.lengthOf(received, 1);

      await provider.send("qrl_mine");
      assert.lengthOf(received, 1);
      assert.isTrue(await provider.send("qrl_revert", [snapshot]));
      assert.lengthOf(received, 1);

      await provider.send("qrl_sendTransaction", [
        {
          from: SENDER,
          to: deployReceipt.contractAddress,
          gas: "0x186a0",
        },
      ]);
      assert.lengthOf(received, 2);
    });
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

  it("keeps direct provider quantities strict", async () => {
    const provider = createProvider("hardhatqrlvm", {
      chainId: 1337,
      blockGasLimit: 30000,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      accounts: [{ address: SENDER, balance: "1000" }],
    });

    try {
      await provider.send("qrl_call", [
        { from: SENDER, to: RECEIVER, value: 1 },
      ]);
      assert.fail("numeric JSON-RPC quantity should be rejected");
    } catch (error) {
      assert.equal((error as any).code, -32602);
    }
  });

  it("supports snapshots and reverts", async () => {
    const provider = createLocalProvider();
    const snapshot = await provider.send("qrl_snapshot");

    await provider.send("qrl_mine");
    assert.equal(await provider.send("qrl_blockNumber"), "0x1");

    assert.equal(await provider.send("qrl_revert", [snapshot]), true);
    assert.equal(await provider.send("qrl_blockNumber"), "0x0");
  });

  it("rejects legacy eth methods and malformed raw transactions", async () => {
    const provider = createLocalProvider();

    try {
      await provider.send("eth_blockNumber");
      assert.fail("legacy method should not be routed");
    } catch (error) {
      assert.equal((error as any).code, -32601);
    }
    // Raw transactions are supported now; junk payloads fail parsing.
    try {
      await provider.send("qrl_sendRawTransaction", ["0x00"]);
      assert.fail("junk raw transaction should be rejected");
    } catch (error) {
      assert.equal((error as any).code, -32602);
    }
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

  it("counts collector failures without masking the contract error", async () => {
    const provider = createLocalProviderWithReverter();
    const contractAddress = await deployReverter(provider);
    const runtimeNode = (provider as any)._node;
    runtimeNode.traceTransactionFrames = async () => {
      runtimeNode._failedStackTraces += 1;
      return {
        kind: "call",
        depth: 0,
        input: new Uint8Array(0),
        value: (global as any).BigInt(0),
        gasLimit: (global as any).BigInt(0),
        steps: [],
        children: [],
        errorMessage: "revert",
        traceError: "collector failed",
      };
    };

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
    assert.equal(await provider.send("qrl_getStackTraceFailuresCount"), 1);
  });

  it("traces transactions and calls through the debug namespace", async () => {
    const provider = createLocalProviderWithReverter({
      throwOnTransactionFailures: false,
    });
    const contractAddress = await deployReverter(provider);
    const txHash = await provider.send("qrl_sendTransaction", [
      { from: SENDER, to: contractAddress, gas: "0x186a0" },
    ]);

    const transactionTrace = await provider.send("debug_traceTransaction", [
      txHash,
      { disableStack: true },
    ]);
    assert.isTrue(transactionTrace.failed);
    assert.equal(
      transactionTrace.structLogs[transactionTrace.structLogs.length - 1].op,
      "REVERT"
    );
    assert.notProperty(transactionTrace.structLogs[0], "stack");

    const callTrace = await provider.send("debug_traceCall", [
      { from: SENDER, to: contractAddress, gas: "0x186a0" },
      "latest",
      { limit: "0x2" },
    ]);
    assert.isTrue(callTrace.failed);
    assert.lengthOf(callTrace.structLogs, 2);
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

  it("decodes Panic codes with their standard names", async () => {
    const provider = createLocalProviderWithReverter();
    const panicData = `4e487b71${"11".padStart(128, "0")}`;
    const contractAddress = await deployRuntime(
      provider,
      revertWithPayloadRuntime(panicData)
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
    assert.include(caught.message, "panic code: 0x11");
    assert.include(caught.message, "arithmetic underflow or overflow");
  });

  it("serves the RPC compatibility surface with go-qrl shapes", async () => {
    const provider = createLocalProviderWithReverter();

    assert.equal(await provider.send("net_version"), "1337");
    assert.equal(await provider.send("net_listening"), true);
    assert.equal(await provider.send("net_peerCount"), "0x0");
    assert.equal(
      await provider.send("web3_clientVersion"),
      "QRLLocalProvider/qrljs"
    );
    // keccak-256("") — the well-known empty-input hash, like go-qrl returns.
    assert.equal(
      await provider.send("web3_sha3", ["0x"]),
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
    assert.equal(await provider.send("qrl_mining"), false);
    assert.equal(await provider.send("qrl_syncing"), false);
    assert.match(await provider.send("qrl_coinbase"), /^Q[0-9a-fA-F]{128}$/);

    await deployReverter(provider);
    assert.equal(
      await provider.send("qrl_getBlockTransactionCountByNumber", ["latest"]),
      "0x1"
    );
    const block = await provider.send("qrl_getBlockByNumber", [
      "latest",
      false,
    ]);
    assert.equal(
      await provider.send("qrl_getBlockTransactionCountByHash", [block.hash]),
      "0x1"
    );
    const tx = await provider.send("qrl_getTransactionByBlockHashAndIndex", [
      block.hash,
      "0x0",
    ]);
    assert.equal(tx.from, SENDER);
  });

  it("deploys oversized contracts with allowUnlimitedContractSize", async () => {
    const provider = createLocalProviderWithReverter({
      allowUnlimitedContractSize: true,
    });

    // Init code returning 24577 zeroed bytes: PUSH3 size, PUSH0, RETURN.
    const size = 24577;
    const init = [
      0x62,
      Math.floor(size / 65536) % 256,
      Math.floor(size / 256) % 256,
      size % 256,
      0x5f,
      0xf3,
    ];
    const data = `0x${init
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;

    const txHash = await provider.send("qrl_sendTransaction", [
      { from: SENDER, data, gas: "0x989680" },
    ]);
    const receipt = await provider.send("qrl_getTransactionReceipt", [txHash]);
    assert.equal(receipt.status, "0x1");

    const code = await provider.send("qrl_getCode", [
      receipt.contractAddress,
      "latest",
    ]);
    assert.equal((code.length - 2) / 2, size);
  });

  it("submits an offline-signed ML-DSA-87 transaction end to end", async function () {
    this.timeout(60000);
    const seed = `0x010000${"01".repeat(48)}`;
    const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
    const accountsEntry = require.resolve("@theqrl/web3-qrl-accounts");
    const { newMLDSA87WalletFromExtendedSeed } = require(path.join(
      path.dirname(accountsEntry),
      "qrl_wallet.js"
    ));
    const signerAddress = seedToAccount(seed).address;

    const provider = new HardhatQrlvmProvider({
      chainId: 1337,
      blockGasLimit: 30000000,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      accounts: [{ address: signerAddress, balance: "1000000000000" }],
    });

    // Build and sign the transaction fully offline with qrljs + the ML-DSA
    // wallet — the same flow an external signer uses.
    const txQrl = require(path.join(
      QRLJS_MONOREPO_PATH,
      "packages",
      "tx",
      "dist",
      "cjs",
      "index.js"
    )).qrl;
    const wallet = newMLDSA87WalletFromExtendedSeed(
      Uint8Array.from(Buffer.from(seed.slice(2), "hex"))
    );
    // The signer embeds ITS OWN descriptor (encoded in the extended seed);
    // verification and sender derivation read it back from the payload.
    const descriptor = wallet.descriptor.toBytes();
    const unsigned = new txQrl.QRLDynamicFeeTransaction({
      chainId: (global as any).BigInt(1337),
      nonce: (global as any).BigInt(0),
      gasTipCap: (global as any).BigInt(0),
      gasFeeCap: (global as any).BigInt(0),
      gasLimit: (global as any).BigInt(21000),
      to: RECEIVER,
      value: (global as any).BigInt(7),
      data: new Uint8Array(0),
      descriptor,
      extraParams: new Uint8Array(),
    });
    const signed = new txQrl.QRLDynamicFeeTransaction({
      chainId: (global as any).BigInt(1337),
      nonce: (global as any).BigInt(0),
      gasTipCap: (global as any).BigInt(0),
      gasFeeCap: (global as any).BigInt(0),
      gasLimit: (global as any).BigInt(21000),
      to: RECEIVER,
      value: (global as any).BigInt(7),
      data: new Uint8Array(0),
      descriptor,
      extraParams: new Uint8Array(),
      signature: wallet.sign(unsigned.getMessageToSign()),
      publicKey: wallet.getPK(),
    });
    const raw = `0x${Buffer.from(signed.serialize()).toString("hex")}`;

    const txHash = await provider.send("qrl_sendRawTransaction", [raw]);
    const receipt = await provider.send("qrl_getTransactionReceipt", [txHash]);
    assert.equal(receipt.status, "0x1");
    assert.equal(receipt.from.toLowerCase(), signerAddress.toLowerCase());
    assert.equal(await provider.send("qrl_getBalance", [RECEIVER]), "0x7");

    // Tampered signature must be rejected.
    const tampered = new txQrl.QRLDynamicFeeTransaction({
      chainId: (global as any).BigInt(1337),
      nonce: (global as any).BigInt(1),
      gasTipCap: (global as any).BigInt(0),
      gasFeeCap: (global as any).BigInt(0),
      gasLimit: (global as any).BigInt(21000),
      to: RECEIVER,
      value: (global as any).BigInt(7),
      data: new Uint8Array(0),
      descriptor,
      extraParams: new Uint8Array(),
      signature: wallet.sign(unsigned.getMessageToSign()),
      publicKey: wallet.getPK(),
    });
    const rawTampered = `0x${Buffer.from(tampered.serialize()).toString(
      "hex"
    )}`;
    try {
      await provider.send("qrl_sendRawTransaction", [rawTampered]);
      assert.fail("tampered raw transaction should be rejected");
    } catch (error) {
      assert.match((error as any).message, /Invalid transaction signature/);
    }
  });

  it("signs messages with qrl_sign for seeded local accounts", async function () {
    this.timeout(60000);
    const seed = `0x010000${"03".repeat(48)}`;
    const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
    const account = seedToAccount(seed);

    const provider = new HardhatQrlvmProvider({
      chainId: 1337,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      accounts: [
        { address: account.address, balance: "1000", seed },
        { address: SENDER, balance: "1000" },
      ],
    });

    const data = "0xdeadbeef";
    const signature = await provider.send("qrl_sign", [account.address, data]);
    const expected = account.sign(data);
    assert.equal(signature, expected.signature);

    const accountsEntry = require.resolve("@theqrl/web3-qrl-accounts");
    const {
      newMLDSA87WalletFromExtendedSeed,
      verifyMLDSA87Signature,
    } = require(path.join(path.dirname(accountsEntry), "qrl_wallet.js"));
    const wallet = newMLDSA87WalletFromExtendedSeed(
      Uint8Array.from(Buffer.from(seed.slice(2), "hex"))
    );
    assert.isTrue(
      verifyMLDSA87Signature(
        Uint8Array.from(Buffer.from(signature.slice(2), "hex")),
        Uint8Array.from(Buffer.from(expected.messageHash.slice(2), "hex")),
        wallet.getPK(),
        wallet.getDescriptor()
      )
    );

    // Accounts without a seed cannot sign.
    await expectHardhatErrorAsync(
      () => provider.send("qrl_sign", [SENDER, "0xdeadbeef"]),
      ERRORS.NETWORK.NOT_LOCAL_ACCOUNT
    );
  });

  it("validates qrl_sign data and seed/address consistency", async () => {
    const seed = `0x010000${"04".repeat(48)}`;
    const provider = new HardhatQrlvmProvider({
      chainId: 1337,
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      accounts: [{ address: SENDER, balance: "1000", seed }],
    });

    await expectHardhatErrorAsync(
      () => provider.send("qrl_sign", [SENDER, "0x1"]),
      ERRORS.NETWORK.INVALID_HEX_DATA
    );
    await expectHardhatErrorAsync(
      () => provider.send("qrl_sign", ["0x1234", "0x00"]),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS
    );
    await expectHardhatErrorAsync(
      () => provider.send("qrl_sign", [SENDER, "0x00"]),
      ERRORS.NETWORK.NOT_LOCAL_ACCOUNT
    );
  });

  it("exposes filters and the pending pool through the wrapper", async () => {
    const provider = createLocalProvider();

    const filterId = await provider.send("qrl_newBlockFilter");
    await provider.send("qrl_mine");
    const changes = await provider.send("qrl_getFilterChanges", [filterId]);
    assert.lengthOf(changes, 1);
    assert.isTrue(await provider.send("qrl_uninstallFilter", [filterId]));

    assert.deepEqual(await provider.send("qrl_pendingTransactions"), []);
  });

  it("forwards node subscription events through the provider", async () => {
    const provider = createLocalProvider();
    const notifications: any[] = [];
    provider.on("notification", (notification) => {
      notifications.push(notification);
    });

    const subscriptionId = await provider.send("qrl_subscribe", ["newHeads"]);
    assert.equal(subscriptionId, "0x1");

    await provider.send("qrl_mine");
    assert.lengthOf(notifications, 1);
    assert.equal(notifications[0].subscription, subscriptionId);
    assert.equal(notifications[0].result.number, "0x1");

    assert.isTrue(await provider.send("qrl_unsubscribe", [subscriptionId]));
    await provider.send("qrl_mine");
    assert.lengthOf(notifications, 1);
  });

  it("applies initialDate to the genesis block and supports time controls", async () => {
    const provider = new HardhatQrlvmProvider({
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

  it("fails with a Hardhat error for an invalid initialDate", async function () {
    if (!hasQrlJsMonorepoDist()) {
      this.skip();
      return;
    }

    const provider = new HardhatQrlvmProvider({
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      initialDate: "not-a-date",
    });
    await expectHardhatErrorAsync(
      () => provider.send("qrl_chainId"),
      ERRORS.NETWORK.INVALID_INITIAL_DATE
    );
  });

  it("uses an explicit qrljs-monorepo path from the network config", async () => {
    const provider = new HardhatQrlvmProvider({
      qrlJsMonorepoPath: QRLJS_MONOREPO_PATH,
      chainId: 1337,
      accounts: [{ address: SENDER, balance: "1000" }],
    });

    assert.equal(
      await provider.send("qrl_getBalance", [SENDER, "latest"]),
      "0x3e8"
    );
  });

  it("fails with a Hardhat error when qrljs-monorepo cannot be loaded", async () => {
    const missingQrlJsMonorepoPath = path.resolve("missing-qrljs-monorepo");
    const provider = new HardhatQrlvmProvider({
      qrlJsMonorepoPath: missingQrlJsMonorepoPath,
    });
    await expectHardhatErrorAsync(
      () => provider.send("qrl_chainId"),
      ERRORS.NETWORK.QRLJS_MONOREPO_UNAVAILABLE,
      missingQrlJsMonorepoPath
    );
  });

  it("without an override uses the bundled runtime or explains how to configure one", async function () {
    const previousQrlJsMonorepoPath = process.env.QRLJS_MONOREPO_PATH;
    delete process.env.QRLJS_MONOREPO_PATH;

    const bundlePresent = fsExtra.pathExistsSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "qrljs-runtime",
        "runtime.cjs"
      )
    );

    try {
      if (bundlePresent) {
        // With a bundled runtime present, no override is required at all.
        const provider = new HardhatQrlvmProvider({});
        assert.instanceOf(provider, HardhatQrlvmProvider);
        await provider.send("qrl_chainId");
        return;
      }

      const unavailableProvider = new HardhatQrlvmProvider({});
      await expectHardhatErrorAsync(
        () => unavailableProvider.send("qrl_chainId"),
        ERRORS.NETWORK.QRLJS_MONOREPO_UNAVAILABLE,
        /QRLJS_MONOREPO_PATH/s
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
    const provider = createProvider("hardhatqrlvm", {
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
