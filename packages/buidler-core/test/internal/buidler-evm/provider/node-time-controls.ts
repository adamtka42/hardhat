import { assert } from "chai";

import {
  HardhatNode,
  QrlNodeRuntime,
} from "../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRL node time controls", function () {
  it("Accumulates time increases and applies them to the next block", async function () {
    const node = await createNode();

    assert.equal(await node.increaseTime(bigint(3_600)), bigint(3_600));
    assert.equal(await node.increaseTime(bigint(100)), bigint(3_700));
    assert.equal(await node.getTimeIncrement(), bigint(3_700));

    const shifted = await node.mineEmptyBlock();
    const following = await node.mineEmptyBlock();

    assert.equal(shifted.header.timestamp, bigint(3_701));
    assert.equal(following.header.timestamp, bigint(3_702));
    assert.equal(await node.getTimeIncrement(), bigint(3_700));
  });

  it("Uses a one-shot timestamp while preserving a pending increase", async function () {
    const node = await createNode();

    await node.increaseTime(bigint(100));
    await node.setNextBlockTimestamp(bigint(50));
    assert.equal(await node.getNextBlockTimestamp(), bigint(50));

    const overridden = await node.mineEmptyBlock();
    assert.equal(overridden.header.timestamp, bigint(50));
    assert.isUndefined(await node.getNextBlockTimestamp());

    const shifted = await node.mineEmptyBlock();
    assert.equal(shifted.header.timestamp, bigint(151));
  });

  it("Lets an explicit block timestamp win without consuming time controls", async function () {
    const node = await createNode();

    await node.increaseTime(bigint(100));
    await node.setNextBlockTimestamp(bigint(50));

    const explicit = await node.mineEmptyBlock({ timestamp: bigint(25) });
    const overridden = await node.mineEmptyBlock();
    const shifted = await node.mineEmptyBlock();

    assert.equal(explicit.header.timestamp, bigint(25));
    assert.equal(overridden.header.timestamp, bigint(50));
    assert.equal(shifted.header.timestamp, bigint(151));
  });

  it("Rejects negative increases and non-monotonic timestamps", async function () {
    const node = await createNode(bigint(10));

    await assertRejects(
      () => node.increaseTime(bigint(-1)),
      "time increase must not be negative"
    );
    await assertRejects(
      () => node.setNextBlockTimestamp(bigint(10)),
      "timestamp 10 is not greater than the next block timestamp lower bound 10"
    );

    assert.equal(await node.getTimeIncrement(), bigint(0));
    assert.isUndefined(await node.getNextBlockTimestamp());
  });

  it("Does not consume time controls when storing the block fails", async function () {
    const node = await createNode();
    await node.increaseTime(bigint(100));
    await node.setNextBlockTimestamp(bigint(50));

    const blockchain = (node as any)._blockchain;
    const putBlock = blockchain.putBlock.bind(blockchain);
    blockchain.putBlock = (_block: any, callback: (error: Error) => void) =>
      callback(new Error("put failed"));

    await assertRejects(() => node.mineEmptyBlock(), "put failed");
    assert.equal(await node.getNextBlockTimestamp(), bigint(50));
    assert.equal(await node.getTimeIncrement(), bigint(100));
    assert.equal(await node.getLatestBlockNumber(), bigint(0));

    blockchain.putBlock = putBlock;
    const block = await node.mineEmptyBlock();
    assert.equal(block.header.timestamp, bigint(50));
  });
});

async function createNode(timestamp: bigint = bigint(0)): Promise<HardhatNode> {
  return HardhatNode.create(createRuntime(), {
    genesisHeader: { timestamp },
  });
}

function createRuntime(): QrlNodeRuntime {
  class StateManager {
    public constructor(_options: any) {}

    public async getStateRoot(): Promise<Uint8Array> {
      return root(7);
    }
  }

  class EVM {
    public constructor(_options: any) {}
  }

  class VM {
    public readonly stateManager: any;
    public readonly evm: any;

    public constructor(options: any) {
      this.stateManager = options.stateManager;
      this.evm = options.evm;
    }
  }

  class Block {
    public readonly header: any;
    public readonly transactions: any[];
    public readonly receipts: any[];

    public constructor(data: any) {
      this.header = {
        timestamp: bigint(0),
        gasLimit: bigint(0),
        baseFee: bigint(0),
        coinbase: "zero",
        ...data.header,
      };
      this.transactions = data.transactions ?? [];
      this.receipts = data.receipts ?? [];
    }

    public hash(): Uint8Array {
      return root(Number(this.header.number) + 1);
    }
  }

  return {
    stateQrl: { QRLStateManager: StateManager },
    evmQrl: { QRLEVM: EVM },
    vmQrl: {
      QRLVM: VM,
      createQRLReceiptFromRunTxResult: (options: any) => options,
    },
    blockQrl: {
      QRLBlock: Block,
      genQRLTransactionsRoot: async () => root(20),
      genQRLReceiptsRoot: async () => root(21),
    },
  };
}

function root(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

async function assertRejects(
  action: () => Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  try {
    await action();
    assert.fail("Expected action to reject");
  } catch (error) {
    assert.include((error as Error).message, expectedMessage);
  }
}
