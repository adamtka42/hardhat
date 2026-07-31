import { assert } from "chai";
import sinon from "sinon";

import { QRL_FILTER_DEADLINE_MS } from "../../../../src/internal/buidler-evm/provider/filter";
import {
  HardhatNode,
  QrlNodeRuntime,
  QrlNodeSigner,
} from "../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRL node transactions", function () {
  it("Executes a transaction and stores its state, receipt, and block", async function () {
    let receivedOptions: any;
    const runtime = createRuntime(async (options, stateManager) => {
      receivedOptions = options;
      await stateManager.setBalance("receiver", bigint(25));
      return runTxResult();
    });
    const node = await HardhatNode.create(runtime, {
      context: { chainId: bigint(7) },
      accounts: [{ address: "sender" }],
      genesisHeader: {
        timestamp: bigint(10),
        gasLimit: bigint(1_000_000),
        baseFee: bigint(3),
        coinbase: "coinbase",
      },
    });
    const transaction = tx(bigint(7));

    const result = await node.runTransactionInNewBlock(transaction, "sender");

    assert.strictEqual(result.transaction, transaction);
    assert.deepEqual(result.runTxResult, runTxResult());
    assert.strictEqual(result.block.transactions[0], transaction);
    assert.strictEqual(result.block.receipts[0], result.receipt);
    assert.equal(result.block.header.number, bigint(1));
    assert.equal(result.block.header.timestamp, bigint(11));
    assert.deepEqual(
      result.block.header.parentHash,
      new Uint8Array(32).fill(1)
    );
    assert.deepEqual(
      result.block.header.transactionsRoot,
      new Uint8Array(32).fill(20)
    );
    assert.deepEqual(
      result.block.header.receiptsRoot,
      new Uint8Array(32).fill(21)
    );
    assert.deepEqual(result.receipt.blockHash, result.block.hash());
    assert.strictEqual(await node.getLatestBlock(), result.block);
    assert.equal(
      await (node as any)._stateManager.getBalance("receiver"),
      bigint(25)
    );

    const transactionHash = transaction.hash();
    assert.strictEqual(
      await node.getTransactionByHash(transactionHash),
      transaction
    );
    assert.deepEqual(await node.getIndexedTransactionByHash(transactionHash), {
      transaction,
      sender: "sender",
    });
    assert.strictEqual(
      await node.getTransactionReceipt(transactionHash),
      result.receipt
    );
    assert.strictEqual(
      await node.getBlockByTransactionHash(transactionHash),
      result.block
    );

    transactionHash.fill(0);
    assert.strictEqual(
      await node.getTransactionByHash(transaction.hash()),
      transaction
    );
    assert.strictEqual(receivedOptions.tx, transaction);
    assert.equal(receivedOptions.sender, "sender");
    assert.equal(receivedOptions.context.blockNumber, bigint(1));
    assert.equal(receivedOptions.context.timestamp, bigint(11));
    assert.equal(receivedOptions.context.chainId, bigint(7));
  });

  it("Executes transactions using the configured block time", async function () {
    const runtime = createRuntime(async () => runTxResult());
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
      genesisHeader: { timestamp: bigint(10) },
    });

    await node.increaseTime(bigint(100));
    const shifted = await node.runTransactionInNewBlock(tx(), "sender");
    assert.equal(shifted.block.header.timestamp, bigint(111));

    await node.setNextBlockTimestamp(bigint(500));
    const overridden = await node.runTransactionInNewBlock(tx(), "sender");
    const following = await node.runTransactionInNewBlock(tx(), "sender");

    assert.equal(overridden.block.header.timestamp, bigint(500));
    assert.equal(following.block.header.timestamp, bigint(501));
  });

  it("Removes the block and reverts state when final commit fails", async function () {
    const runtime = createRuntime(async (_options, stateManager) => {
      await stateManager.setBalance("receiver", bigint(25));
      return runTxResult();
    }, true);
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
    });

    const transaction = tx();
    await assertRejects(
      () => node.runTransactionInNewBlock(transaction, "sender"),
      "commit failed"
    );

    assert.equal(await node.getLatestBlockNumber(), bigint(0));
    assert.equal(
      await (node as any)._stateManager.getBalance("receiver"),
      bigint(0)
    );
    assert.isUndefined(await node.getTransactionByHash(transaction.hash()));
    assert.isUndefined(await node.getTransactionReceipt(transaction.hash()));
    assert.isUndefined(
      await node.getBlockByTransactionHash(transaction.hash())
    );
  });

  it("Rejects transactions from accounts not managed by the node", async function () {
    const runtime = createRuntime(async () => runTxResult());
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
    });

    await assertRejects(
      () => node.runTransactionInNewBlock(tx(), "unknown"),
      "unknown account unknown"
    );
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
  });

  it("Returns undefined for unknown transaction hashes", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult())
    );
    const unknownHash = new Uint8Array(32).fill(99);

    assert.isUndefined(await node.getTransactionByHash(unknownHash));
    assert.isUndefined(await node.getIndexedTransactionByHash(unknownHash));
    assert.isUndefined(await node.getTransactionReceipt(unknownHash));
    assert.isUndefined(await node.getBlockByTransactionHash(unknownHash));
  });

  it("Verifies a raw transaction and mines it with the derived sender", async function () {
    let receivedOptions: any;
    const runtime = createRuntime(async (options) => {
      receivedOptions = options;
      return runTxResult();
    });
    const node = await HardhatNode.create(runtime, {
      rawTransactionSigner: signer(),
    });

    const transaction = tx();
    const result = await node.runRawTransactionInNewBlock(transaction);

    assert.equal(receivedOptions.sender, "external");
    assert.equal(result.block.header.number, bigint(1));
    assert.equal(
      (await node.getIndexedTransactionByHash(transaction.hash()))!.sender,
      "external"
    );
  });

  it("Rejects raw transactions with an invalid signature", async function () {
    const runtime = createRuntime(async () => runTxResult());
    const node = await HardhatNode.create(runtime, {
      rawTransactionSigner: signer({ valid: false }),
    });

    await assertRejects(
      () => node.runRawTransactionInNewBlock(tx()),
      "Invalid transaction signature"
    );
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
  });

  it("Rejects raw transactions for another chain", async function () {
    const runtime = createRuntime(async () => runTxResult());
    const node = await HardhatNode.create(runtime, {
      context: { chainId: bigint(2) },
      rawTransactionSigner: signer(),
    });

    await assertRejects(
      () => node.runRawTransactionInNewBlock(tx()),
      "Invalid transaction chain id 1; expected 2"
    );
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
  });

  it("Rejects raw transactions when sender derivation fails", async function () {
    const runtime = createRuntime(async () => runTxResult());
    const node = await HardhatNode.create(runtime, {
      rawTransactionSigner: signer({ senderError: true }),
    });

    await assertRejects(
      () => node.runRawTransactionInNewBlock(tx()),
      "Invalid transaction sender"
    );
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
  });

  it("Rejects raw transactions when no signer is configured", async function () {
    const runtime = createRuntime(async () => runTxResult());
    const node = await HardhatNode.create(runtime);

    await assertRejects(
      () => node.runRawTransactionInNewBlock(tx()),
      "Raw transaction signer is not configured"
    );
  });

  it("Queues transactions without changing canonical state when automine is disabled", async function () {
    const runtime = createRuntime(async (options, stateManager) => {
      const currentBalance = await stateManager.getBalance("receiver");
      const value: bigint = options.tx.value;
      await stateManager.setBalance("receiver", currentBalance + value);
      return { ...runTxResult(), gasUsed: options.tx.gasUsed };
    });
    const node = await HardhatNode.create(runtime, {
      automine: false,
      accounts: [{ address: "sender" }],
      genesisHeader: { timestamp: bigint(10) },
    });
    const transaction = pendingTx(11, 25, 21_000);

    const result = await node.runTransaction(transaction, "sender");

    assert.isUndefined(result.block);
    assert.isUndefined(result.receipt);
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
    assert.equal(await node.getAccountBalance("receiver"), bigint(0));
    assert.equal(await node.getPendingAccountBalance("receiver"), bigint(25));
    assert.deepEqual(await node.getPendingTransactions(), [transaction]);
    assert.strictEqual(
      await node.getTransactionByHash(transaction.hash()),
      transaction
    );
    assert.isUndefined(await node.getTransactionReceipt(transaction.hash()));
    assert.isUndefined(
      await node.getBlockByTransactionHash(transaction.hash())
    );

    const pendingBlock = await node.getPendingBlock();
    assert.equal(pendingBlock.header.number, bigint(1));
    assert.equal(pendingBlock.header.timestamp, bigint(11));
    assert.deepEqual(pendingBlock.transactions, [transaction]);

    const block = await node.mineBlock();

    assert.equal(await node.getLatestBlockNumber(), bigint(1));
    assert.equal(await node.getAccountBalance("receiver"), bigint(25));
    assert.deepEqual(await node.getPendingTransactions(), []);
    assert.strictEqual(
      await node.getTransactionReceipt(transaction.hash()),
      block.receipts[0]
    );
    assert.strictEqual(
      await node.getBlockByTransactionHash(transaction.hash()),
      block
    );
  });

  it("Builds ordered pending receipts with cumulative gas", async function () {
    const runtime = createRuntime(async (options) => ({
      ...runTxResult(),
      gasUsed: options.tx.gasUsed,
    }));
    const node = await HardhatNode.create(runtime, {
      automine: false,
      accounts: [{ address: "sender" }],
    });
    const first = pendingTx(12, 0, 21_000);
    const second = pendingTx(13, 0, 30_000);

    await node.runTransaction(first, "sender");
    await node.runTransaction(second, "sender");

    const pendingBlock = await node.getPendingBlock();
    assert.deepEqual(pendingBlock.transactions, [first, second]);
    assert.equal(pendingBlock.receipts[0].options.transactionIndex, 0);
    assert.equal(pendingBlock.receipts[0].cumulativeGasUsed, bigint(21_000));
    assert.equal(pendingBlock.receipts[1].options.transactionIndex, 1);
    assert.equal(pendingBlock.receipts[1].cumulativeGasUsed, bigint(51_000));

    const block = await node.mineBlock();
    assert.equal(block.receipts[1].cumulativeGasUsed, bigint(51_000));
  });

  it("Freezes pending block time and applies later controls to the following block", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult()),
      {
        automine: false,
        accounts: [{ address: "sender" }],
        genesisHeader: { timestamp: bigint(10) },
      }
    );

    await node.increaseTime(bigint(100));
    await node.runTransaction(pendingTx(14), "sender");
    await assertRejects(
      () => node.mineBlock({ timestamp: bigint(200) }),
      "cannot override block options while pending transactions exist"
    );
    await assertRejects(
      () => node.setNextBlockTimestamp(bigint(100)),
      "timestamp 100 is not greater than the next block timestamp lower bound 111"
    );

    await node.setNextBlockTimestamp(bigint(500));
    const pendingBlock = await node.mineBlock();
    const followingBlock = await node.mineBlock();

    assert.equal(pendingBlock.header.timestamp, bigint(111));
    assert.equal(followingBlock.header.timestamp, bigint(500));
  });

  it("Restores pending transactions and state from a snapshot", async function () {
    const runtime = createRuntime(async (options, stateManager) => {
      const currentBalance = await stateManager.getBalance("receiver");
      const value: bigint = options.tx.value;
      await stateManager.setBalance("receiver", currentBalance + value);
      return runTxResult();
    });
    const node = await HardhatNode.create(runtime, {
      automine: false,
      accounts: [{ address: "sender" }],
    });
    const first = pendingTx(15, 10);
    const second = pendingTx(16, 20);

    await node.runTransaction(first, "sender");
    const snapshot = await node.takeSnapshot();
    await node.runTransaction(second, "sender");
    assert.equal(await node.getPendingAccountBalance("receiver"), bigint(30));

    assert.isTrue(await node.revertToSnapshot(snapshot));
    assert.equal(await node.getPendingAccountBalance("receiver"), bigint(10));
    assert.deepEqual(await node.getPendingTransactions(), [first]);
    assert.isUndefined(await node.getTransactionByHash(second.hash()));

    await node.mineBlock();
    assert.equal(await node.getAccountBalance("receiver"), bigint(10));
  });

  it("Keeps the existing pending state when a later transaction fails", async function () {
    const runtime = createRuntime(async (options, stateManager) => {
      const currentBalance = await stateManager.getBalance("receiver");
      const value: bigint = options.tx.value;
      await stateManager.setBalance("receiver", currentBalance + value);
      if (options.tx.shouldFail === true) {
        throw new Error("run failed");
      }
      return runTxResult();
    });
    const node = await HardhatNode.create(runtime, {
      automine: false,
      accounts: [{ address: "sender" }],
    });
    const first = pendingTx(18, 10);
    const failing = { ...pendingTx(19, 20), shouldFail: true };

    await node.runTransaction(first, "sender");
    await assertRejects(
      () => node.runTransaction(failing, "sender"),
      "run failed"
    );

    assert.equal(await node.getPendingAccountBalance("receiver"), bigint(10));
    assert.deepEqual(await node.getPendingTransactions(), [first]);
    assert.isUndefined(await node.getTransactionByHash(failing.hash()));

    await node.mineBlock();
    assert.equal(await node.getAccountBalance("receiver"), bigint(10));
  });

  it("Estimates gas without changing state or consuming time controls", async function () {
    const executionOptions: any[] = [];
    let consoleLogs = 0;
    const runtime = createRuntime(async (options, stateManager, evm) => {
      executionOptions.push(options);
      await stateManager.setBalance("receiver", options.tx.gasLimit);
      evm.options.traceListener?.enterFrame({
        kind: "staticcall",
        target: { toString: () => `Q${"0".repeat(128)}` },
        input: new Uint8Array([1]),
        value: bigint(0),
      });
      return { ...runTxResult(), gasUsed: bigint(21_000) };
    });
    const node = await HardhatNode.create(runtime, {
      context: { gasLimit: bigint(100_000) },
      consoleLogListener: () => consoleLogs++,
      genesisHeader: { timestamp: bigint(0), gasLimit: bigint(100_000) },
    });

    await node.increaseTime(bigint(100));
    const result = await node.estimateGas(estimationTx(100_000), "sender");

    assert.equal(result.estimation, bigint(21_000));
    assert.isUndefined(result.error);
    assert.equal(await node.getBlockGasLimit(), bigint(100_000));
    assert.equal(await node.getAccountBalance("receiver"), bigint(0));
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
    assert.equal(consoleLogs, 0);
    assert.isAtLeast(executionOptions.length, 2);
    for (const options of executionOptions) {
      assert.isTrue(options.skipBalance);
      assert.isTrue(options.skipNonce);
      assert.equal(options.context.blockNumber, bigint(1));
      assert.equal(options.context.timestamp, bigint(101));
    }

    const block = await node.mineEmptyBlock();
    assert.equal(block.header.timestamp, bigint(101));
  });

  it("Corrects an initial gas-used estimate that cannot execute", async function () {
    const requiredGas = bigint(30_000);
    const runtime = createRuntime(async (options) => {
      // tslint:disable-next-line:strict-comparisons
      if (options.tx.gasLimit < requiredGas) {
        return {
          ...runTxResult(),
          status: 0,
          gasUsed: options.tx.gasLimit,
          executionError: new Error("out of gas"),
        };
      }
      return { ...runTxResult(), gasUsed: bigint(21_000) };
    });
    const node = await HardhatNode.create(runtime, {
      genesisHeader: { gasLimit: bigint(100_000) },
    });

    const result = await node.estimateGas(estimationTx(100_000), "sender");

    assert.equal(result.estimation, bigint(30_102));
    assert.isUndefined(result.error);
  });

  it("Returns the upper-bound execution error when estimation cannot succeed", async function () {
    const runtime = createRuntime(async (options, stateManager) => {
      await stateManager.setBalance("receiver", bigint(99));
      return {
        ...runTxResult(),
        status: 0,
        gasUsed: options.tx.gasLimit,
        executionError: new Error("execution failed"),
      };
    });
    const node = await HardhatNode.create(runtime, {
      genesisHeader: { gasLimit: bigint(100_000) },
    });

    const result = await node.estimateGas(estimationTx(100_000), "sender");

    assert.equal(result.estimation, bigint(100_000));
    assert.equal(result.error!.message, "execution failed");
    assert.equal(await node.getAccountBalance("receiver"), bigint(0));
  });

  it("Can estimate against pending state without changing it", async function () {
    const runtime = createRuntime(async (options, stateManager) => {
      if (options.tx.to === "prepare") {
        await stateManager.setBalance("flag", bigint(1));
        return runTxResult();
      }

      const hasPendingState =
        (await stateManager.getBalance("flag")) === bigint(1);
      const requiredGas = hasPendingState ? bigint(21_000) : bigint(50_000);
      // tslint:disable-next-line:strict-comparisons
      if (options.tx.gasLimit < requiredGas) {
        return {
          ...runTxResult(),
          status: 0,
          gasUsed: options.tx.gasLimit,
          executionError: new Error("out of gas"),
        };
      }
      return { ...runTxResult(), gasUsed: requiredGas };
    });
    const node = await HardhatNode.create(runtime, {
      automine: false,
      accounts: [{ address: "sender" }],
      genesisHeader: { gasLimit: bigint(100_000) },
    });

    await node.runTransaction(estimationTx(100_000, "prepare"), "sender");
    const latestResult = await node.estimateGas(
      estimationTx(100_000),
      "sender"
    );
    const pendingResult = await node.estimateGas(
      estimationTx(100_000),
      "sender",
      { usePendingState: true }
    );

    assert.equal(latestResult.estimation, bigint(50_000));
    assert.equal(pendingResult.estimation, bigint(21_000));
    assert.equal(await node.getAccountBalance("flag"), bigint(0));
    assert.equal(await node.getPendingAccountBalance("flag"), bigint(1));
  });

  it("Rejects a zero gas upper bound", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult())
    );

    await assertRejects(
      () => node.estimateGas(estimationTx(0), "sender"),
      "gas estimation upper bound must be positive"
    );
  });

  it("Polls matching log deltas and the complete installed filter range", async function () {
    const logger = { toString: () => `Q${"31".repeat(64)}` };
    const other = { toString: () => `Q${"32".repeat(64)}` };
    const topic = new Uint8Array(64).fill(7);
    const runtime = createRuntime(async (options) => ({
      ...runTxResult(),
      logs: [
        {
          address: options.tx.to,
          topics: [topic],
          data: new Uint8Array([42]),
          removed: false,
        },
      ],
    }));
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
    });
    const filterId = await node.newFilter({
      addresses: [logger.toString()],
      topics: [new Set([`0x${Buffer.from(topic).toString("hex")}`])],
    });

    await node.runTransaction(estimationTx(100_000, logger), "sender");
    const first = await node.getFilterChanges(filterId);
    assert.lengthOf(first!, 1);
    assert.equal((first![0] as any).address, logger.toString());
    assert.equal((first![0] as any).data, "0x2a");
    assert.equal((first![0] as any).blockNumber, "0x1");
    assert.deepEqual(await node.getFilterChanges(filterId), []);

    await node.runTransaction(estimationTx(100_000, other), "sender");
    assert.deepEqual(await node.getFilterChanges(filterId), []);
    const all = await node.getFilterLogs(filterId);
    assert.lengthOf(all!, 1);
    assert.equal(all![0].address, logger.toString());
  });

  it("Polls new block hashes and resets the cursor after a revert", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult())
    );
    const filterId = await node.newBlockFilter();
    const snapshot = await node.takeSnapshot();

    const first = await node.mineEmptyBlock();
    const second = await node.mineEmptyBlock();
    assert.deepEqual(await node.getFilterChanges(filterId), [
      `0x${Buffer.from(first.hash()).toString("hex")}`,
      `0x${Buffer.from(second.hash()).toString("hex")}`,
    ]);
    assert.deepEqual(await node.getFilterChanges(filterId), []);

    assert.isTrue(await node.revertToSnapshot(snapshot));
    await node.increaseTime(bigint(7));
    const replacement = await node.mineEmptyBlock();
    assert.deepEqual(await node.getFilterChanges(filterId), [
      `0x${Buffer.from(replacement.hash()).toString("hex")}`,
    ]);
  });

  it("Polls pending hashes once, resets them on revert, and expires filters", async function () {
    const now = { value: 1_000 };
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult()),
      {
        automine: false,
        accounts: [{ address: "sender" }],
        filterNow: () => now.value,
      }
    );
    const filterId = await node.newPendingTransactionFilter();
    const snapshot = await node.takeSnapshot();
    const transaction = pendingTx(22);
    const expectedHash = `0x${"16".repeat(32)}`;

    await node.runTransaction(transaction, "sender");
    assert.deepEqual(await node.getFilterChanges(filterId), [expectedHash]);
    assert.deepEqual(await node.getFilterChanges(filterId), []);

    assert.isTrue(await node.revertToSnapshot(snapshot));
    await node.runTransaction(transaction, "sender");
    assert.deepEqual(await node.getFilterChanges(filterId), [expectedHash]);

    now.value += QRL_FILTER_DEADLINE_MS + 1;
    assert.isUndefined(await node.getFilterChanges(filterId));
    assert.isFalse(node.uninstallFilter(filterId));
    assert.equal(node.installedFilterCount(), 0);
  });

  it("Releases abandoned filters when their inactivity timer expires", async function () {
    const clock = sinon.useFakeTimers();
    try {
      const node = await HardhatNode.create(
        createRuntime(async () => runTxResult())
      );
      await node.newBlockFilter();
      await node.newPendingTransactionFilter();
      assert.equal(node.installedFilterCount(), 2);

      clock.tick(QRL_FILTER_DEADLINE_MS - 1);
      assert.equal(node.installedFilterCount(), 2);
      clock.tick(2);
      assert.equal(node.installedFilterCount(), 0);
    } finally {
      clock.restore();
    }
  });

  it("Uninstalls filters and rejects getFilterLogs for non-log filters", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult())
    );
    const blockFilter = await node.newBlockFilter();

    await assertRejects(
      () => node.getFilterLogs(blockFilter),
      "QRL getFilterLogs is only supported for log filters"
    );
    assert.isTrue(node.uninstallFilter(blockFilter));
    assert.isFalse(node.uninstallFilter(blockFilter));
    assert.isUndefined(await node.getFilterChanges(blockFilter));
  });

  it("Replays a mined transaction from its historical pre-block state", async function () {
    const executions: Array<{
      hashByte: number;
      balanceBefore: bigint;
      traced: boolean;
    }> = [];
    const traceListener = { step: sinon.spy() };
    const runtime = createRuntime(async (options, stateManager, evm) => {
      const balanceBefore = await stateManager.getBalance("flag");
      const traced = evm.options.traceListener === traceListener;
      const transactionValue: bigint = options.tx.value;
      executions.push({
        hashByte: options.tx.hash()[0],
        balanceBefore,
        traced,
      });
      evm.options.traceListener?.step({ hash: options.tx.hash() });
      await stateManager.setBalance("flag", balanceBefore + transactionValue);
      return {
        ...runTxResult(),
        txHash: options.tx.hash(),
        sender: options.sender,
        gasUsed: options.tx.gasUsed,
        returnValue: new Uint8Array([options.tx.hash()[0]]),
      };
    });
    const node = await HardhatNode.create(runtime, {
      automine: false,
      accounts: [{ address: "sender" }],
    });
    const first = pendingTx(30, 5);
    const target = pendingTx(31, 7);

    await node.runTransaction(first, "sender");
    await node.runTransaction(target, "sender");
    await node.mineBlock();
    await node.runTransaction(pendingTx(32, 100), "sender");
    await node.mineBlock();
    assert.equal(await node.getAccountBalance("flag"), bigint(112));
    executions.splice(0);

    const replay = await node.replayTransaction(target.hash(), traceListener);

    assert.deepEqual(executions, [
      { hashByte: 30, balanceBefore: bigint(0), traced: false },
      { hashByte: 31, balanceBefore: bigint(5), traced: true },
    ]);
    assert.isTrue(traceListener.step.calledOnce);
    assert.equal(replay.gasUsed, bigint(21_000));
    assert.equal(replay.gasLimit, bigint(100_000));
    assert.deepEqual(replay.returnValue, new Uint8Array([31]));
    assert.isFalse(replay.failed);
    assert.equal(await node.getAccountBalance("flag"), bigint(112));
  });

  it("Builds failed transaction frames and counts collector failures", async function () {
    const runtime = createRuntime(async (options, stateManager) => {
      await stateManager.setBalance("flag", bigint(1));
      return {
        ...runTxResult(),
        txHash: options.tx.hash(),
        sender: options.sender,
        status: 0,
        executionError: new Error("execution reverted"),
        returnValue: new Uint8Array([42]),
      };
    });
    (runtime.vmQrl as any).createFrameCollector = (root: any) => ({
      root,
      listener: {},
      lastError: new Error("collector failed"),
    });
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
    });
    const transaction = estimationTx(100_000);

    const mined = await node.runTransaction(transaction, "sender");
    assert.equal(mined.runTxResult.status, 0);
    assert.isDefined(mined.block);
    assert.isDefined(await node.getTransactionReceipt(transaction.hash()));
    assert.equal(await node.getStackTraceFailuresCount(), 0);

    const frame = await node.traceTransactionFrames(transaction.hash());

    assert.equal(frame.kind, "call");
    assert.equal(frame.errorMessage, "execution reverted");
    assert.equal(frame.traceError, "collector failed");
    assert.deepEqual(frame.returnValue, new Uint8Array([42]));
    assert.equal(await node.getStackTraceFailuresCount(), 1);
    assert.equal(await node.getAccountBalance("flag"), bigint(1));
  });

  it("Rejects replay of a transaction that has not been mined", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult()),
      { automine: false, accounts: [{ address: "sender" }] }
    );
    const transaction = pendingTx(33);
    await node.runTransaction(transaction, "sender");

    await assertRejects(
      () => node.replayTransaction(transaction.hash(), {}),
      "QRL transaction not found or not mined"
    );
  });

  it("Emits new heads and stops after unsubscribe", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult())
    );
    const events: any[] = [];
    node.on("ethEvent", (event) => events.push(event));
    const subscriptionId = node.newHeadsSubscription();

    await node.mineEmptyBlock();
    await node.mineEmptyBlock();

    assert.deepEqual(
      events.map((event) => event.filterId),
      [subscriptionId, subscriptionId]
    );
    assert.deepEqual(
      events.map((event) => event.result.number),
      ["0x1", "0x2"]
    );
    assert.equal(node.installedSubscriptionCount(), 1);
    assert.isTrue(node.unsubscribe(subscriptionId));
    assert.isFalse(node.unsubscribe(subscriptionId));

    await node.mineEmptyBlock();
    assert.lengthOf(events, 2);
  });

  it("Emits pending transaction hashes and full objects", async function () {
    const now = { value: 1_000 };
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult()),
      {
        automine: false,
        accounts: [{ address: "sender" }],
        filterNow: () => now.value,
      }
    );
    const events: any[] = [];
    node.on("ethEvent", (event) => events.push(event));
    const hashSubscription = node.newPendingTransactionsSubscription();
    const fullSubscription = node.newPendingTransactionsSubscription(true);
    const transaction = estimationTx(100_000);
    const expectedHash = `0x${"15".repeat(32)}`;

    await node.runTransaction(transaction, "sender");

    assert.equal(events[0].filterId, hashSubscription);
    assert.equal(events[0].result, expectedHash);
    assert.equal(events[1].filterId, fullSubscription);
    assert.equal(events[1].result.hash, expectedHash);
    assert.equal(events[1].result.from, "sender");
    assert.isNull(events[1].result.blockHash);
    assert.isNull(events[1].result.blockNumber);
    assert.isNull(events[1].result.transactionIndex);

    now.value += QRL_FILTER_DEADLINE_MS + 1;
    assert.equal(node.installedSubscriptionCount(), 2);
  });

  it("Emits only matching subscribed logs in the configured block range", async function () {
    const logger = { toString: () => `Q${"41".repeat(64)}` };
    const topic = new Uint8Array(64).fill(9);
    const runtime = createRuntime(async (options) => ({
      ...runTxResult(),
      logs: [
        {
          address: options.tx.to,
          topics: [topic],
          data: new Uint8Array([43]),
          removed: false,
        },
      ],
    }));
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
    });
    const events: any[] = [];
    node.on("ethEvent", (event) => events.push(event));
    const subscriptionId = node.newLogsSubscription({
      fromBlock: bigint(2),
      toBlock: bigint(2),
      addresses: [logger.toString()],
      topics: [new Set([`0x${Buffer.from(topic).toString("hex")}`])],
    });

    await node.runTransaction(estimationTx(100_000, logger), "sender");
    await node.runTransaction(estimationTx(100_000, logger), "sender");
    await node.runTransaction(estimationTx(100_000, logger), "sender");

    assert.lengthOf(events, 1);
    assert.equal(events[0].filterId, subscriptionId);
    assert.equal(events[0].result.blockNumber, "0x2");
    assert.equal(events[0].result.address, logger.toString());
    assert.equal(events[0].result.data, "0x2b");
  });

  it("Re-emits logs as removed when reverting a snapshot", async function () {
    const logger = { toString: () => `Q${"42".repeat(64)}` };
    const runtime = createRuntime(async (options) => ({
      ...runTxResult(),
      logs: [
        {
          address: options.tx.to,
          topics: [],
          data: new Uint8Array([44]),
          removed: false,
        },
      ],
    }));
    const node = await HardhatNode.create(runtime, {
      accounts: [{ address: "sender" }],
    });
    const events: any[] = [];
    node.on("ethEvent", (event) => events.push(event));
    const subscriptionId = node.newLogsSubscription({
      addresses: [logger.toString()],
    });
    const snapshot = await node.takeSnapshot();

    await node.runTransaction(estimationTx(100_000, logger), "sender");
    assert.isTrue(await node.revertToSnapshot(snapshot));

    assert.lengthOf(events, 2);
    assert.equal(events[0].filterId, subscriptionId);
    assert.isFalse(events[0].result.removed);
    assert.equal(events[1].filterId, subscriptionId);
    assert.isTrue(events[1].result.removed);
    assert.equal(events[1].result.blockHash, events[0].result.blockHash);
  });

  it("Does not let a faulty subscription listener interrupt mining", async function () {
    const node = await HardhatNode.create(
      createRuntime(async () => runTxResult())
    );
    node.newHeadsSubscription();
    node.on("ethEvent", () => {
      throw new Error("listener failed");
    });

    const block = await node.mineEmptyBlock();

    assert.equal(block.header.number, bigint(1));
    assert.equal(await node.getLatestBlockNumber(), bigint(1));
  });

  it("Queues verified raw transactions with their derived sender", async function () {
    const node = await HardhatNode.create(
      createRuntime(async (options) => ({
        ...runTxResult(),
        sender: options.sender,
      })),
      {
        automine: false,
        rawTransactionSigner: signer(),
      }
    );
    const transaction = pendingTx(17);

    const result = await node.runRawTransaction(transaction);

    assert.isUndefined(result.block);
    assert.equal(
      (await node.getIndexedTransactionByHash(transaction.hash()))!.sender,
      "external"
    );
    await node.mineBlock();
    assert.equal(
      (await node.getIndexedTransactionByHash(transaction.hash()))!.sender,
      "external"
    );
  });
});

function estimationTx(gasLimit: number, to: any = "receiver"): any {
  return {
    type: 2,
    chainId: bigint(1),
    nonce: bigint(0),
    gasTipCap: bigint(0),
    gasFeeCap: bigint(0),
    gasLimit: bigint(gasLimit),
    to,
    value: bigint(0),
    data: new Uint8Array(),
    accessList: [],
    descriptor: new Uint8Array(),
    extraParams: new Uint8Array(),
    signature: new Uint8Array(),
    publicKey: new Uint8Array(),
    hash: () => new Uint8Array(32).fill(21),
  };
}

function pendingTx(
  hashByte: number,
  value: number = 0,
  gasUsed: number = 21_000
): any {
  return {
    chainId: bigint(1),
    value: bigint(value),
    gasUsed: bigint(gasUsed),
    gasLimit: bigint(100_000),
    hash: () => new Uint8Array(32).fill(hashByte),
  };
}

function tx(chainId: bigint = bigint(1)): any {
  return {
    chainId,
    hash: () => new Uint8Array(32).fill(9),
  };
}

function signer(
  options: { valid?: boolean; senderError?: boolean } = {}
): QrlNodeSigner {
  return {
    chainId: bigint(1),
    hash: () => new Uint8Array(32),
    verify: () => options.valid ?? true,
    sender: () => {
      if (options.senderError === true) {
        throw new Error("sender failed");
      }
      return "external";
    },
  };
}

function runTxResult(): any {
  return {
    txHash: new Uint8Array(32).fill(9),
    sender: "sender",
    to: "receiver",
    returnValue: new Uint8Array(),
    gasUsed: bigint(21_000),
    gasRemaining: bigint(79_000),
    gasRefund: bigint(0),
    totalGasSpent: bigint(21_000),
    effectiveGasPrice: bigint(2),
    status: 1,
    logs: [],
  };
}

function createRuntime(
  runTx: (options: any, stateManager: StateManager, evm: any) => Promise<any>,
  failCommit = false
): QrlNodeRuntime {
  class TestStateManager extends StateManager {
    public constructor(options: any) {
      super(options, failCommit);
    }
  }

  class EVM {
    public constructor(public readonly options: any) {}
  }

  class VM {
    public readonly stateManager: any;
    public readonly evm: any;

    public constructor(public readonly options: any) {
      this.stateManager = options.stateManager;
      this.evm = options.evm;
    }

    public async runTx(options: any): Promise<any> {
      return runTx(options, this.stateManager, this.evm);
    }
  }

  class Receipt {
    public readonly cumulativeGasUsed: bigint;
    public readonly logs: any[];
    public readonly blockHash?: Uint8Array;

    public constructor(public readonly options: any) {
      this.cumulativeGasUsed = options.cumulativeGasUsed;
      this.blockHash = options.blockHash;
      const sourceLogs = options.result?.logs ?? options.logs ?? [];
      const logIndexStart: number | undefined = options.logIndexStart;
      this.logs = sourceLogs.map((log: any, index: number) => ({
        ...log,
        blockHash: options.blockHash,
        blockNumber: options.blockNumber,
        txHash: options.result?.txHash,
        txIndex: options.transactionIndex,
        index: logIndexStart === undefined ? undefined : logIndexStart + index,
        removed: log.removed ?? false,
      }));
    }

    public withInclusion(options: any): Receipt {
      return new Receipt({ ...this.options, ...options });
    }
  }

  class Block {
    public readonly header: any;
    public readonly transactions: any[];
    public readonly receipts: any[];

    public constructor(data: any) {
      this.header = {
        coinbase: "zero",
        timestamp: bigint(0),
        gasLimit: bigint(0),
        baseFee: bigint(0),
        ...data.header,
      };
      this.transactions = data.transactions ?? [];
      this.receipts = data.receipts ?? [];
    }

    public hash(): Uint8Array {
      return new Uint8Array(32).fill(Number(this.header.number) + 1);
    }
  }

  return {
    stateQrl: { QRLStateManager: TestStateManager },
    txQrl: { QRLDynamicFeeTransaction: TestTransaction },
    evmQrl: { QRLEVM: EVM },
    vmQrl: {
      QRLVM: VM,
      createQRLReceiptFromRunTxResult: (options: any) => new Receipt(options),
    },
    blockQrl: {
      QRLBlock: Block,
      genQRLTransactionsRoot: async () => new Uint8Array(32).fill(20),
      genQRLReceiptsRoot: async () => new Uint8Array(32).fill(21),
    },
  };
}

class TestTransaction {
  public constructor(data: any) {
    Object.assign(this, data);
  }
}

class StateManager {
  private _balances = new Map<any, bigint>();
  private _checkpoints: Array<Map<any, bigint>> = [];

  public constructor(_options: any, private readonly _failCommit: boolean) {}

  public shallowCopy(): StateManager {
    const copy = new StateManager({}, this._failCommit);
    copy._balances = new Map(this._balances);
    copy._checkpoints = this._checkpoints.map(
      (checkpoint) => new Map(checkpoint)
    );
    return copy;
  }

  public async getStateRoot(): Promise<Uint8Array> {
    const balance = await this.getBalance("receiver");
    return new Uint8Array(32).fill(Number(balance));
  }

  public async checkpoint(): Promise<void> {
    this._checkpoints.push(new Map(this._balances));
  }

  public async commit(): Promise<void> {
    if (this._failCommit) {
      throw new Error("commit failed");
    }
    this._checkpoints.pop();
  }

  public async revert(): Promise<void> {
    this._balances = this._checkpoints.pop()!;
  }

  public async getBalance(address: any): Promise<bigint> {
    return this._balances.get(address) ?? bigint(0);
  }

  public async getNonce(_address: any): Promise<bigint> {
    return bigint(0);
  }

  public async setBalance(address: any, balance: bigint): Promise<void> {
    this._balances.set(address, balance);
  }
}

async function assertRejects(
  action: () => Promise<unknown>,
  message: string
): Promise<void> {
  try {
    await action();
    assert.fail("Expected promise to reject");
  } catch (error) {
    assert.equal((error as Error).message, message);
  }
}
