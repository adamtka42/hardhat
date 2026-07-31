import { assert } from "chai";

import {
  bufferToRpcData,
  getRpcBlock,
  getRpcDebugTrace,
  getRpcLog,
  getRpcTransaction,
  getRpcTransactionReceipt,
  numberToRpcQuantity,
} from "../../../../src/internal/buidler-evm/provider/output";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);
const bytes = (byte: number, length = 32): Uint8Array =>
  new Uint8Array(length).fill(byte);
const address = (byte: number) => ({
  toString: () => `Q${byte.toString(16).padStart(2, "0").repeat(64)}`,
});

function fixture() {
  const tx = {
    hash: () => bytes(1),
    type: 2,
    chainId: bigint(1),
    nonce: bigint(2),
    to: address(2),
    gasLimit: bigint(3),
    gasFeeCap: bigint(4),
    gasTipCap: bigint(5),
    value: bigint(6),
    data: new Uint8Array([0x60, 0x2a]),
  };
  const log = {
    address: address(3),
    topics: [bytes(4, 64)],
    data: new Uint8Array([1, 2]),
    blockNumber: bigint(7),
    txHash: tx.hash(),
    txIndex: 0,
    blockHash: bytes(8),
    index: 0,
    removed: false,
  };
  const receipt = {
    txHash: tx.hash(),
    blockHash: bytes(8),
    blockNumber: bigint(7),
    transactionIndex: 0,
    from: address(1),
    to: address(2),
    status: 1 as 0 | 1,
    gasUsed: bigint(9),
    cumulativeGasUsed: bigint(9),
    effectiveGasPrice: bigint(4),
    logs: [log],
    logsBloom: bytes(0, 256),
  };
  const block = {
    hash: () => bytes(8),
    header: {
      parentHash: bytes(9),
      number: bigint(7),
      timestamp: bigint(10),
      gasLimit: bigint(11),
      gasUsed: bigint(9),
      baseFee: bigint(12),
      coinbase: address(5),
      stateRoot: bytes(13),
      transactionsRoot: bytes(14),
      receiptsRoot: bytes(15),
      logsBloom: bytes(0, 256),
    },
    transactions: [tx],
    receipts: [receipt],
  };

  return { block, log, receipt, tx };
}

describe("QRL RPC output", function () {
  it("Formats quantities and data", function () {
    assert.equal(numberToRpcQuantity(0), "0x0");
    assert.equal(numberToRpcQuantity(bigint(15)), "0xf");
    assert.equal(bufferToRpcData(new Uint8Array([0, 15])), "0x000f");
    assert.equal(bufferToRpcData(new Uint8Array([15]), 4), "0x000f");
    assert.throws(() => numberToRpcQuantity(-1));
  });

  it("Formats transactions and blocks", function () {
    const { block, tx } = fixture();
    const transaction = getRpcTransaction(
      tx,
      block,
      0,
      false,
      block.receipts[0].from
    );

    assert.equal(transaction.hash, `0x${"01".repeat(32)}`);
    assert.equal(transaction.type, "0x2");
    assert.equal(transaction.from, address(1).toString());
    assert.equal(transaction.to, address(2).toString());
    assert.equal(transaction.input, "0x602a");
    assert.equal(transaction.blockNumber, "0x7");

    const hashesOnly = getRpcBlock(block, false);
    assert.deepEqual(hashesOnly.transactions, [`0x${"01".repeat(32)}`]);

    const withTransactions = getRpcBlock(block, true);
    assert.equal(withTransactions.number, "0x7");
    assert.equal(withTransactions.miner, address(5).toString());
    assert.equal(
      (withTransactions.transactions[0] as any).from,
      address(1).toString()
    );
    assert.equal(withTransactions.receipts[0].status, "0x1");
  });

  it("Formats receipts and 64-byte QRL log topics", function () {
    const { log, receipt } = fixture();
    const rpcLog = getRpcLog(log);
    const rpcReceipt = getRpcTransactionReceipt(receipt);

    assert.equal(rpcLog.topics[0], `0x${"04".repeat(64)}`);
    assert.equal(rpcLog.blockNumber, "0x7");
    assert.equal(rpcLog.transactionIndex, "0x0");
    assert.equal(rpcReceipt.transactionHash, `0x${"01".repeat(32)}`);
    assert.equal(rpcReceipt.effectiveGasPrice, "0x4");
    assert.deepEqual(rpcReceipt.logs, [rpcLog]);
  });

  it("Formats raw VM steps as go-qrl debug trace output", function () {
    const trace = getRpcDebugTrace(
      {
        gasUsed: bigint(7),
        returnValue: new Uint8Array([0xab]),
        failed: false,
      },
      [
        {
          pc: 2,
          opcode: 1,
          depth: 0,
          gasLeft: bigint(100),
          gasCost: bigint(3),
          stack: [bigint(42)],
          memory: new Uint8Array([1, 2]),
        },
      ],
      (opcode) => (opcode === 1 ? "ADD" : "UNKNOWN")
    );

    assert.deepEqual(trace, {
      gas: 7,
      failed: false,
      returnValue: "ab",
      structLogs: [
        {
          pc: 2,
          op: "ADD",
          gas: 100,
          gasCost: 3,
          depth: 1,
          stack: ["0x2a"],
          memory: ["0102".padEnd(128, "0")],
        },
      ],
    });
  });
});
