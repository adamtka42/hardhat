import { assert } from "chai";

import {
  HardhatNode,
  QrlNodeRuntime,
} from "../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRL node empty block mining", function () {
  it("Mines an empty child block without changing the state root", async function () {
    const generatedRoots: any[][] = [];
    const runtime = createRuntime(generatedRoots);
    const node = await HardhatNode.create(runtime, {
      genesisHeader: {
        timestamp: bigint(10),
        gasLimit: bigint(1_000_000),
        baseFee: bigint(3),
        coinbase: "genesis-coinbase",
      },
    });
    const genesis = await node.getLatestBlock();

    const block = await node.mineEmptyBlock();

    assert.equal(block.header.number, bigint(1));
    assert.equal(block.header.timestamp, bigint(11));
    assert.equal(block.header.gasLimit, bigint(1_000_000));
    assert.equal(block.header.baseFee, bigint(3));
    assert.equal(block.header.coinbase, "genesis-coinbase");
    assert.deepEqual(block.header.parentHash, genesis.hash());
    assert.deepEqual(block.header.stateRoot, genesis.header.stateRoot);
    assert.deepEqual(block.header.transactionsRoot, root(20));
    assert.deepEqual(block.header.receiptsRoot, root(21));
    assert.lengthOf(block.transactions, 0);
    assert.lengthOf(block.receipts, 0);
    assert.deepEqual(generatedRoots, [[], []]);
    assert.strictEqual(await node.getLatestBlock(), block);
  });

  it("Applies explicit QRL header overrides", async function () {
    const node = await HardhatNode.create(createRuntime(), {
      genesisHeader: {
        timestamp: bigint(10),
        gasLimit: bigint(100),
        baseFee: bigint(1),
        coinbase: "old",
      },
    });

    const block = await node.mineEmptyBlock({
      timestamp: bigint(25),
      gasLimit: bigint(200),
      baseFee: bigint(4),
      coinbase: "new",
    });

    assert.equal(block.header.timestamp, bigint(25));
    assert.equal(block.header.gasLimit, bigint(200));
    assert.equal(block.header.baseFee, bigint(4));
    assert.equal(block.header.coinbase, "new");
  });

  it("Mines sequential blocks using monotonically increasing timestamps", async function () {
    const node = await HardhatNode.create(createRuntime(), {
      genesisHeader: { timestamp: bigint(5) },
    });

    const first = await node.mineEmptyBlock();
    const second = await node.mineEmptyBlock();

    assert.equal(first.header.number, bigint(1));
    assert.equal(first.header.timestamp, bigint(6));
    assert.equal(second.header.number, bigint(2));
    assert.equal(second.header.timestamp, bigint(7));
    assert.deepEqual(second.header.parentHash, first.hash());
  });

  it("Rejects a timestamp that is not newer than the latest block", async function () {
    const node = await HardhatNode.create(createRuntime(), {
      genesisHeader: { timestamp: bigint(10) },
    });

    await assertRejects(
      () => node.mineEmptyBlock({ timestamp: bigint(10) }),
      "timestamp 10 is not greater than the latest block timestamp 10"
    );

    assert.equal(await node.getLatestBlockNumber(), bigint(0));
  });
});

function createRuntime(generatedRoots: any[][] = []): QrlNodeRuntime {
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
      genQRLTransactionsRoot: async (items: readonly any[]) => {
        generatedRoots.push([...items]);
        return root(20);
      },
      genQRLReceiptsRoot: async (items: readonly any[]) => {
        generatedRoots.push([...items]);
        return root(21);
      },
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
