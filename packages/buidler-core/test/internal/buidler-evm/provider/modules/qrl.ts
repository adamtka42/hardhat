import { assert } from "chai";

import {
  InvalidArgumentsError,
  InvalidInputError,
  MethodNotFoundError,
  QrlExecutionError,
} from "../../../../../src/internal/buidler-evm/provider/errors";
import {
  QrlModule,
  QrlModuleConfig,
} from "../../../../../src/internal/buidler-evm/provider/modules/qrl";
import { HardhatNode } from "../../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

const ADDRESS = `Q${"01".repeat(64)}`;
const COINBASE = `Q${"02".repeat(64)}`;
const BLOCK_HASH = "0x".concat("08".repeat(32));
const TRANSACTION_HASH = "0x".concat("04".repeat(32));
const UNKNOWN_HASH = "0x".concat("ff".repeat(32));
const STORAGE_KEY = "0x".concat("03".repeat(32));
const TOPIC = "0x".concat("07".repeat(64));

const bytes = (byte: number, length: number = 32): Uint8Array =>
  new Uint8Array(length).fill(byte);
const qrlAddress = (byte: number) => ({
  toString: () => "Q".concat(byte.toString(16).padStart(2, "0").repeat(64)),
});

function fixture() {
  const transaction = {
    hash: () => bytes(4),
    type: 2,
    chainId: bigint(1337),
    nonce: bigint(1),
    to: qrlAddress(2),
    gasLimit: bigint(100),
    gasFeeCap: bigint(0),
    gasTipCap: bigint(0),
    value: bigint(5),
    data: new Uint8Array([0x60, 0x00]),
  };
  const receipt = {
    txHash: transaction.hash(),
    blockHash: bytes(8),
    blockNumber: bigint(7),
    transactionIndex: 0,
    from: qrlAddress(1),
    to: qrlAddress(2),
    status: 1 as 0 | 1,
    gasUsed: bigint(21),
    cumulativeGasUsed: bigint(21),
    effectiveGasPrice: bigint(0),
    logs: [],
    logsBloom: bytes(0, 256),
  };
  const block = {
    hash: () => bytes(8),
    header: {
      parentHash: bytes(7),
      number: bigint(7),
      timestamp: bigint(10),
      gasLimit: bigint(1000),
      gasUsed: bigint(21),
      baseFee: bigint(0),
      coinbase: qrlAddress(2),
      stateRoot: bytes(5),
      transactionsRoot: bytes(6),
      receiptsRoot: bytes(7),
      logsBloom: bytes(0, 256),
    },
    transactions: [transaction],
    receipts: [receipt],
  };
  const pendingBlock = {
    ...block,
    hash: () => bytes(9),
    header: { ...block.header, number: bigint(8) },
  };
  return { block, pendingBlock, receipt, transaction };
}

describe("QRL module", function () {
  it("serves basic network and account methods", async function () {
    const module = createModule();

    assert.deepEqual(await module.processRequest("qrl_accounts"), [ADDRESS]);
    assert.equal(await module.processRequest("qrl_blockNumber"), "0x7");
    assert.equal(await module.processRequest("qrl_chainId"), "0x539");
    assert.equal(await module.processRequest("qrl_coinbase"), COINBASE);
    assert.equal(await module.processRequest("qrl_gasPrice"), "0x0");
    assert.isFalse(await module.processRequest("qrl_mining"));
    assert.isFalse(await module.processRequest("qrl_syncing"));
  });

  it("reads latest and pending account state separately", async function () {
    const seenAddresses: string[] = [];
    const module = createModule({ seenAddresses });

    assert.equal(
      await module.processRequest("qrl_getBalance", [ADDRESS]),
      "0xa"
    );
    assert.equal(
      await module.processRequest("qrl_getBalance", [ADDRESS, "pending"]),
      "0x14"
    );
    assert.equal(
      await module.processRequest("qrl_getTransactionCount", [
        ADDRESS,
        "latest",
      ]),
      "0x2"
    );
    assert.equal(
      await module.processRequest("qrl_getTransactionCount", [
        ADDRESS,
        "pending",
      ]),
      "0x3"
    );
    assert.deepEqual(seenAddresses, [ADDRESS, ADDRESS, ADDRESS, ADDRESS]);
  });

  it("reads latest and pending code and storage", async function () {
    const module = createModule();

    assert.equal(
      await module.processRequest("qrl_getCode", [ADDRESS]),
      "0x6001"
    );
    assert.equal(
      await module.processRequest("qrl_getCode", [ADDRESS, "pending"]),
      "0x6002"
    );
    assert.equal(
      await module.processRequest("qrl_getStorageAt", [ADDRESS, STORAGE_KEY]),
      "0x".concat("05".repeat(64))
    );
    assert.equal(
      await module.processRequest("qrl_getStorageAt", [
        ADDRESS,
        STORAGE_KEY,
        "pending",
      ]),
      "0x".concat("06".repeat(64))
    );
    await assertRejects(
      () => module.processRequest("qrl_getStorageAt", [ADDRESS, "0x01"]),
      InvalidArgumentsError
    );
  });

  it("formats blocks and block transaction counts", async function () {
    const module = createModule();
    const latest = await module.processRequest("qrl_getBlockByNumber", [
      "latest",
    ]);
    const expanded = await module.processRequest("qrl_getBlockByHash", [
      BLOCK_HASH,
      true,
    ]);

    assert.equal(latest.number, "0x7");
    assert.deepEqual(latest.transactions, [TRANSACTION_HASH]);
    assert.equal(expanded.transactions[0].hash, TRANSACTION_HASH);
    assert.equal(
      (await module.processRequest("qrl_getBlockByNumber", ["pending"])).number,
      "0x8"
    );
    assert.equal(
      await module.processRequest("qrl_getBlockTransactionCountByNumber", [
        "latest",
      ]),
      "0x1"
    );
    assert.equal(
      await module.processRequest("qrl_getBlockTransactionCountByHash", [
        BLOCK_HASH,
      ]),
      "0x1"
    );
    assert.isNull(
      await module.processRequest("qrl_getBlockByHash", [UNKNOWN_HASH])
    );
  });

  it("formats transaction lookups and receipts", async function () {
    const module = createModule();
    const byHash = await module.processRequest("qrl_getTransactionByHash", [
      TRANSACTION_HASH,
    ]);
    const byNumber = await module.processRequest(
      "qrl_getTransactionByBlockNumberAndIndex",
      ["latest", "0x0"]
    );
    const byBlockHash = await module.processRequest(
      "qrl_getTransactionByBlockHashAndIndex",
      [BLOCK_HASH, "0x0"]
    );
    const receipt = await module.processRequest("qrl_getTransactionReceipt", [
      TRANSACTION_HASH,
    ]);

    assert.equal(byHash.hash, TRANSACTION_HASH);
    assert.equal(byHash.from, ADDRESS);
    assert.equal(byNumber.hash, TRANSACTION_HASH);
    assert.equal(byBlockHash.hash, TRANSACTION_HASH);
    assert.equal(receipt.transactionHash, TRANSACTION_HASH);
    assert.equal(receipt.status, "0x1");
    assert.isNull(
      await module.processRequest("qrl_getTransactionByBlockNumberAndIndex", [
        "latest",
        "0x1",
      ])
    );
    assert.isNull(
      await module.processRequest("qrl_getTransactionByHash", [UNKNOWN_HASH])
    );
    assert.isNull(
      await module.processRequest("qrl_getTransactionReceipt", [UNKNOWN_HASH])
    );
  });

  it("calls contracts against the pending state", async function () {
    const createdTransactions: Array<Record<string, any>> = [];
    const calls: any[] = [];
    const module = createModule({ createdTransactions, calls });

    assert.equal(
      await module.processRequest("qrl_call", [
        {
          from: ADDRESS,
          to: COINBASE,
          gas: "0x64",
          maxFeePerGas: "0x5",
          maxPriorityFeePerGas: "0x1",
          value: "0x2",
          data: "0x1234",
        },
        "pending",
      ]),
      "0x2a"
    );
    assert.equal(createdTransactions[0].nonce, bigint(3));
    assert.equal(createdTransactions[0].gasLimit, bigint(100));
    assert.equal(createdTransactions[0].gasFeeCap, bigint(5));
    assert.equal(createdTransactions[0].gasTipCap, bigint(1));
    assert.equal(createdTransactions[0].value, bigint(2));
    assert.deepEqual(createdTransactions[0].data, new Uint8Array([0x12, 0x34]));
    assert.equal(calls[0].call.gasPrice, bigint(9));
    assert.isTrue(calls[0].options.usePendingState);
  });

  it("reports call failures with return data", async function () {
    const callResult = {
      returnValue: new Uint8Array([0xde, 0xad]),
      exceptionError: new Error("execution reverted"),
    };
    const error = await captureError(() =>
      createModule({ callResult }).processRequest("qrl_call", [
        { from: ADDRESS, to: COINBASE },
      ])
    );

    assert.instanceOf(error, QrlExecutionError);
    assert.equal(error.message, "execution reverted");
    assert.equal((error as QrlExecutionError).data, "0xdead");
    assert.equal(
      await createModule({
        callResult,
        throwOnCallFailures: false,
      }).processRequest("qrl_call", [{ from: ADDRESS, to: COINBASE }]),
      "0xdead"
    );
  });

  it("estimates gas against the selected state", async function () {
    const estimates: any[] = [];
    const module = createModule({ estimates });

    assert.equal(
      await module.processRequest("qrl_estimateGas", [
        { from: ADDRESS, to: COINBASE },
        "pending",
      ]),
      "0x2a"
    );
    assert.equal(estimates[0].tx.nonce, bigint(3));
    assert.equal(estimates[0].tx.gasLimit, bigint(1000));
    assert.equal(estimates[0].sender.toString(), ADDRESS);
    assert.isTrue(estimates[0].options.usePendingState);
  });

  it("reports gas estimation failures with return data", async function () {
    const error = await captureError(() =>
      createModule({
        estimateResult: {
          estimation: bigint(1000),
          runTxResult: {
            status: 0,
            executionError: new Error("out of gas"),
            returnValue: new Uint8Array([0x01]),
          },
        },
      }).processRequest("qrl_estimateGas", [{ from: ADDRESS, to: COINBASE }])
    );

    assert.instanceOf(error, QrlExecutionError);
    assert.equal((error as QrlExecutionError).data, "0x01");

    const preExecutionError = await captureError(() =>
      createModule({
        estimateResult: {
          estimation: bigint(1000),
          error: new Error("invalid transaction"),
        },
      }).processRequest("qrl_estimateGas", [{ from: ADDRESS, to: COINBASE }])
    );
    assert.instanceOf(preExecutionError, QrlExecutionError);
    assert.equal(preExecutionError.message, "invalid transaction");
  });

  it("attaches failure frames when stack traces are enabled", async function () {
    const traceFrames: any[] = [];
    const callError = await captureError(() =>
      createModule({
        callResult: {
          returnValue: new Uint8Array([0xde, 0xad]),
          exceptionError: new Error("execution reverted"),
        },
        stackTracesEnabled: true,
        traceFrames,
      }).processRequest("qrl_call", [
        { from: ADDRESS, to: COINBASE },
        "pending",
      ])
    );
    assert.strictEqual(
      (callError as QrlExecutionError).traceFrame,
      traceFrames[0]
    );
    assert.isTrue(traceFrames[0].options.usePendingState);

    const estimateError = await captureError(() =>
      createModule({
        estimateResult: {
          estimation: bigint(1000),
          runTxResult: {
            status: 0,
            executionError: new Error("out of gas"),
            returnValue: new Uint8Array([0x01]),
          },
        },
        stackTracesEnabled: true,
        traceFrames,
      }).processRequest("qrl_estimateGas", [{ from: ADDRESS, data: "0x6000" }])
    );
    assert.strictEqual(
      (estimateError as QrlExecutionError).traceFrame,
      traceFrames[1]
    );
    assert.equal(traceFrames[1].kind, "create");
  });

  it("creates and submits QRL transactions", async function () {
    const createdTransactions: Array<Record<string, any>> = [];
    const sentTransactions: any[] = [];
    const module = createModule({ createdTransactions, sentTransactions });

    assert.equal(
      await module.processRequest("qrl_sendTransaction", [
        { from: ADDRESS, to: COINBASE, value: "0x5", data: "0x1234" },
      ]),
      TRANSACTION_HASH
    );
    assert.equal(createdTransactions[0].nonce, bigint(3));
    assert.equal(createdTransactions[0].gasLimit, bigint(1000));
    assert.equal(createdTransactions[0].value, bigint(5));
    assert.equal(sentTransactions[0].sender.toString(), ADDRESS);
    assert.isFalse(sentTransactions[0].raw);

    await assertRejects(
      () =>
        module.processRequest("qrl_sendTransaction", [
          { from: ADDRESS, gas: "0x1", gasLimit: "0x2" },
        ]),
      InvalidArgumentsError
    );
  });

  it("deserializes and submits raw QRL transactions", async function () {
    const sentTransactions: any[] = [];
    const rawTransaction = { hash: () => bytes(4) };
    const module = createModule({ sentTransactions, rawTransaction });

    assert.equal(
      await module.processRequest("qrl_sendRawTransaction", ["0x0102"]),
      TRANSACTION_HASH
    );
    assert.strictEqual(sentTransactions[0].tx, rawTransaction);
    assert.isTrue(sentTransactions[0].raw);

    await assertRejects(
      () =>
        createModule({
          rawTransactionError: new Error("invalid encoding"),
        }).processRequest("qrl_sendRawTransaction", ["0x0102"]),
      InvalidArgumentsError
    );
  });

  it("reports mined transaction failures and preserves their hash", async function () {
    const failedTransaction = { hash: () => bytes(4) };
    const transactionResult = {
      transaction: failedTransaction,
      runTxResult: {
        status: 0,
        executionError: new Error("execution reverted"),
        returnValue: new Uint8Array([0xaa]),
      },
      block: {},
    };
    const error = await captureError(() =>
      createModule({ transactionResult }).processRequest(
        "qrl_sendTransaction",
        [{ from: ADDRESS }]
      )
    );

    assert.instanceOf(error, QrlExecutionError);
    assert.equal((error as QrlExecutionError).data, "0xaa");
    assert.equal(
      (error as QrlExecutionError).transactionHash,
      TRANSACTION_HASH
    );
    assert.equal(
      await createModule({
        transactionResult,
        throwOnTransactionFailures: false,
      }).processRequest("qrl_sendTransaction", [{ from: ADDRESS }]),
      TRANSACTION_HASH
    );
  });

  it("manages polling filters and normalizes log criteria", async function () {
    const filterOperations: any[] = [];
    const log = {
      address: ADDRESS,
      topics: [TOPIC],
      data: "0x2a",
      removed: false,
    };
    const module = createModule({
      filterOperations,
      filterChanges: [TRANSACTION_HASH],
      filterLogs: [log],
      logs: [log],
    });

    assert.equal(await module.processRequest("qrl_newBlockFilter"), "0xa");
    assert.equal(
      await module.processRequest("qrl_newFilter", [
        { fromBlock: "0x2", address: ADDRESS, topics: [TOPIC] },
      ]),
      "0xb"
    );
    assert.equal(
      await module.processRequest("qrl_newPendingTransactionFilter"),
      "0xc"
    );
    assert.deepEqual(
      await module.processRequest("qrl_getFilterChanges", ["0x1"]),
      [TRANSACTION_HASH]
    );
    assert.deepEqual(
      await module.processRequest("qrl_getFilterLogs", ["0x1"]),
      [log]
    );
    assert.deepEqual(
      await module.processRequest("qrl_getLogs", [
        { address: ADDRESS, topics: [TOPIC] },
      ]),
      [log]
    );
    assert.isTrue(await module.processRequest("qrl_uninstallFilter", ["0x1"]));

    assert.equal(filterOperations[1].type, "newFilter");
    assert.equal(filterOperations[1].criteria.fromBlock, bigint(2));
    assert.deepEqual(filterOperations[1].criteria.addresses, [ADDRESS]);
    assert.deepEqual(Array.from(filterOperations[1].criteria.topics[0]), [
      TOPIC,
    ]);
    assert.equal(filterOperations[5].type, "getLogs");

    await assertRejects(
      () => module.processRequest("qrl_getFilterChanges", ["0xff"]),
      InvalidInputError
    );
  });

  it("formats pending transactions with their sender and null block fields", async function () {
    const pendingTransaction = fixture().transaction;
    const pending = await createModule({
      pendingTransactions: [pendingTransaction],
    }).processRequest("qrl_pendingTransactions");

    assert.lengthOf(pending, 1);
    assert.equal(pending[0].hash, TRANSACTION_HASH);
    assert.equal(pending[0].from, ADDRESS);
    assert.isNull(pending[0].blockHash);
    assert.isNull(pending[0].blockNumber);
    assert.isNull(pending[0].transactionIndex);
  });

  it("registers and removes QRL subscriptions", async function () {
    const subscriptionOperations: any[] = [];
    const module = createModule({ subscriptionOperations });

    assert.equal(
      await module.processRequest("qrl_subscribe", ["newHeads"]),
      "0x14"
    );
    assert.equal(
      await module.processRequest("qrl_subscribe", [
        "newPendingTransactions",
        true,
      ]),
      "0x15"
    );
    assert.equal(
      await module.processRequest("qrl_subscribe", [
        "logs",
        { address: ADDRESS, topics: [TOPIC] },
      ]),
      "0x16"
    );
    assert.isTrue(await module.processRequest("qrl_unsubscribe", ["0x16"]));

    assert.deepInclude(subscriptionOperations[1], {
      type: "newPendingTransactions",
      fullObjects: true,
    });
    assert.deepEqual(subscriptionOperations[2].criteria.addresses, [ADDRESS]);

    await assertRejects(
      () => module.processRequest("qrl_subscribe", ["newHeads", true]),
      InvalidArgumentsError
    );
    await assertRejects(
      () =>
        module.processRequest("qrl_subscribe", ["newPendingTransactions", {}]),
      InvalidArgumentsError
    );
  });

  it("rejects historical state and malformed parameters", async function () {
    const module = createModule();

    await assertRejects(
      () => module.processRequest("qrl_getBalance", [ADDRESS, "earliest"]),
      InvalidInputError
    );
    await assertRejects(
      () => module.processRequest("qrl_getBalance", []),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("qrl_getBalance", ["Q1234"]),
      InvalidArgumentsError
    );
  });

  it("rejects unknown methods", async function () {
    await assertRejects(
      () => createModule().processRequest("qrl_unknown"),
      MethodNotFoundError
    );
  });
});

interface ModuleTestOptions {
  seenAddresses?: string[];
  createdTransactions?: Array<Record<string, any>>;
  calls?: any[];
  estimates?: any[];
  sentTransactions?: any[];
  filterOperations?: any[];
  filterChanges?: any[];
  filterLogs?: any[];
  logs?: any[];
  pendingTransactions?: any[];
  subscriptionOperations?: any[];
  callResult?: any;
  estimateResult?: any;
  transactionResult?: any;
  rawTransaction?: any;
  rawTransactionError?: Error;
  throwOnTransactionFailures?: boolean;
  throwOnCallFailures?: boolean;
  stackTracesEnabled?: boolean;
  traceFrames?: any[];
}

function createModule(options: ModuleTestOptions = {}): QrlModule {
  const { block, pendingBlock, receipt, transaction } = fixture();
  const node: HardhatNode = Object.assign(
    Object.create(HardhatNode.prototype),
    {
      getLocalAccountAddresses: async () => [ADDRESS],
      getLatestBlockNumber: async () => bigint(7),
      getLatestBlock: async () => block,
      getPendingBlock: async () => pendingBlock,
      getBlockByNumber: async (number: bigint) =>
        number === bigint(7) ? block : undefined,
      getBlockByHash: async (hash: Uint8Array) =>
        Buffer.from(hash).equals(Buffer.from(bytes(8))) ? block : undefined,
      getBlockByTransactionHash: async (hash: Uint8Array) =>
        Buffer.from(hash).equals(Buffer.from(bytes(4))) ? block : undefined,
      getIndexedTransactionByHash: async (hash: Uint8Array) =>
        Buffer.from(hash).equals(Buffer.from(bytes(4)))
          ? { transaction, sender: qrlAddress(1) }
          : undefined,
      getTransactionReceipt: async (hash: Uint8Array) =>
        Buffer.from(hash).equals(Buffer.from(bytes(4))) ? receipt : undefined,
      getCoinbaseAddress: async () => ({ toString: () => COINBASE }),
      getGasPrice: async () => bigint(0),
      getBlockGasLimit: async () => bigint(1000),
      getCode: async () => new Uint8Array([0x60, 0x01]),
      getPendingCode: async () => new Uint8Array([0x60, 0x02]),
      getStorageAt: async () => bytes(5, 64),
      getPendingStorageAt: async () => bytes(6, 64),
      newBlockFilter: async () => {
        options.filterOperations?.push({ type: "newBlockFilter" });
        return bigint(10);
      },
      newFilter: async (criteria: any) => {
        options.filterOperations?.push({ type: "newFilter", criteria });
        return bigint(11);
      },
      newPendingTransactionFilter: async () => {
        options.filterOperations?.push({
          type: "newPendingTransactionFilter",
        });
        return bigint(12);
      },
      getFilterChanges: async (filterId: bigint) => {
        options.filterOperations?.push({ type: "getFilterChanges", filterId });
        return filterId === bigint(255)
          ? undefined
          : options.filterChanges ?? [];
      },
      getFilterLogs: async (filterId: bigint) => {
        options.filterOperations?.push({ type: "getFilterLogs", filterId });
        return filterId === bigint(255) ? undefined : options.filterLogs ?? [];
      },
      getLogs: async (criteria: any) => {
        options.filterOperations?.push({ type: "getLogs", criteria });
        return options.logs ?? [];
      },
      uninstallFilter: (filterId: bigint) => {
        options.filterOperations?.push({ type: "uninstallFilter", filterId });
        return filterId === bigint(1);
      },
      getPendingTransactions: async () => options.pendingTransactions ?? [],
      newHeadsSubscription: () => {
        options.subscriptionOperations?.push({ type: "newHeads" });
        return bigint(20);
      },
      newPendingTransactionsSubscription: (fullObjects: boolean) => {
        options.subscriptionOperations?.push({
          type: "newPendingTransactions",
          fullObjects,
        });
        return bigint(21);
      },
      newLogsSubscription: (criteria: any) => {
        options.subscriptionOperations?.push({ type: "logs", criteria });
        return bigint(22);
      },
      unsubscribe: (subscriptionId: bigint) => {
        options.subscriptionOperations?.push({
          type: "unsubscribe",
          subscriptionId,
        });
        return subscriptionId === bigint(22);
      },
      traceCallFrames: async (call: any, traceOptions: any) => {
        const frame = { kind: "call", call, options: traceOptions };
        options.traceFrames?.push(frame);
        return frame;
      },
      traceEstimateGasFrames: async (
        tx: any,
        sender: any,
        traceOptions: any
      ) => {
        const frame = {
          kind: tx.to === undefined ? "create" : "call",
          tx,
          sender,
          options: traceOptions,
        };
        options.traceFrames?.push(frame);
        return frame;
      },
      recordStackTraceFailure: () => undefined,
      runCall: async (call: any, callOptions: any) => {
        options.calls?.push({ call, options: callOptions });
        return (
          options.callResult ?? {
            returnValue: new Uint8Array([0x2a]),
            gasUsed: bigint(1),
          }
        );
      },
      estimateGas: async (tx: any, sender: any, estimateOptions: any) => {
        options.estimates?.push({ tx, sender, options: estimateOptions });
        return options.estimateResult ?? { estimation: bigint(42) };
      },
      runTransaction: async (tx: any, sender: any) => {
        options.sentTransactions?.push({ tx, sender, raw: false });
        return (
          options.transactionResult ?? {
            transaction: tx,
            runTxResult: {
              status: 1,
              returnValue: new Uint8Array(0),
            },
            block,
          }
        );
      },
      runRawTransaction: async (tx: any) => {
        options.sentTransactions?.push({ tx, raw: true });
        return (
          options.transactionResult ?? {
            transaction: tx,
            runTxResult: {
              status: 1,
              returnValue: new Uint8Array(0),
            },
            block,
          }
        );
      },
      getAccountBalance: async (address: any) => {
        options.seenAddresses?.push(address.toString());
        return bigint(10);
      },
      getPendingAccountBalance: async (address: any) => {
        options.seenAddresses?.push(address.toString());
        return bigint(20);
      },
      getAccountNonce: async (address: any) => {
        options.seenAddresses?.push(address.toString());
        return bigint(2);
      },
      getPendingAccountNonce: async (address: any) => {
        options.seenAddresses?.push(address.toString());
        return bigint(3);
      },
    }
  );
  const config: QrlModuleConfig = {
    chainId: bigint(1337),
    addressFromBytes: (value) => ({
      toString: () => `Q${Buffer.from(value).toString("hex")}`,
    }),
    defaultGasLimit: bigint(1000),
    createTransaction: (data) => {
      options.createdTransactions?.push(data);
      return { ...data, hash: () => bytes(4) };
    },
    transactionFromSerialized: (_data) => {
      if (options.rawTransactionError !== undefined) {
        throw options.rawTransactionError;
      }
      return options.rawTransaction ?? { hash: () => bytes(4) };
    },
    effectiveGasPrice: () => bigint(9),
  };
  return new QrlModule(
    config,
    node,
    options.throwOnTransactionFailures ?? true,
    options.throwOnCallFailures ?? true,
    undefined,
    options.stackTracesEnabled ?? false
  );
}

async function assertRejects(
  action: () => Promise<unknown>,
  errorType: new (...args: any[]) => Error
): Promise<void> {
  try {
    await action();
    assert.fail("Expected action to reject");
  } catch (error) {
    assert.instanceOf(error, errorType);
  }
}

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
    assert.fail("Expected action to reject");
  } catch (error) {
    return error as Error;
  }
}
