import { assert } from "chai";

import {
  HardhatNode,
  QrlNodeRuntime,
} from "../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRL node snapshots", function () {
  it("Restores state, blocks, indexes, and time controls", async function () {
    const node = await createNode();
    const snapshot = await node.takeSnapshot();
    const transaction = tx(9);

    await node.increaseTime(bigint(100));
    await node.setNextBlockTimestamp(bigint(50));
    await node.runTransactionInNewBlock(transaction, "sender");

    assert.equal(await node.getLatestBlockNumber(), bigint(1));
    assert.equal(await node.getAccountBalance("receiver"), bigint(25));
    assert.strictEqual(
      await node.getTransactionByHash(transaction.hash()),
      transaction
    );

    assert.isTrue(await node.revertToSnapshot(snapshot));

    assert.equal(await node.getLatestBlockNumber(), bigint(0));
    assert.isUndefined(await node.getBlockByNumber(bigint(1)));
    assert.equal(await node.getAccountBalance("receiver"), bigint(0));
    assert.isUndefined(await node.getTransactionByHash(transaction.hash()));
    assert.isUndefined(await node.getTransactionReceipt(transaction.hash()));
    assert.isUndefined(
      await node.getBlockByTransactionHash(transaction.hash())
    );
    assert.equal(await node.getTimeIncrement(), bigint(0));
    assert.isUndefined(await node.getNextBlockTimestamp());

    const internalNode = node as any;
    assert.strictEqual(
      internalNode._vm.stateManager,
      internalNode._stateManager
    );
    assert.strictEqual(
      internalNode._vm.evm.stateManager,
      internalNode._stateManager
    );
  });

  it("Handles unknown and nested snapshots as single-use values", async function () {
    const node = await createNode();
    const snapshotA = await node.takeSnapshot();
    const transactionA = tx(9);
    await node.runTransactionInNewBlock(transactionA, "sender");

    const snapshotB = await node.takeSnapshot();
    const transactionB = tx(10);
    await node.runTransactionInNewBlock(transactionB, "sender");

    assert.equal(await node.getLatestBlockNumber(), bigint(2));
    assert.isFalse(await node.revertToSnapshot(bigint(999)));

    assert.isTrue(await node.revertToSnapshot(snapshotB));
    assert.equal(await node.getLatestBlockNumber(), bigint(1));
    assert.strictEqual(
      await node.getTransactionByHash(transactionA.hash()),
      transactionA
    );
    assert.isUndefined(await node.getTransactionByHash(transactionB.hash()));
    assert.isFalse(await node.revertToSnapshot(snapshotB));

    assert.isTrue(await node.revertToSnapshot(snapshotA));
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
    assert.isUndefined(await node.getTransactionByHash(transactionA.hash()));
  });

  it("Restores armed time controls", async function () {
    const node = await createNode();
    await node.increaseTime(bigint(100));
    await node.setNextBlockTimestamp(bigint(50));
    const snapshot = await node.takeSnapshot();

    await node.mineEmptyBlock();
    assert.isUndefined(await node.getNextBlockTimestamp());

    assert.isTrue(await node.revertToSnapshot(snapshot));
    assert.equal(await node.getTimeIncrement(), bigint(100));
    assert.equal(await node.getNextBlockTimestamp(), bigint(50));

    const block = await node.mineEmptyBlock();
    assert.equal(block.header.timestamp, bigint(50));
  });

  it("Allocates monotonically increasing snapshot ids", async function () {
    const node = await createNode();

    assert.equal(await node.takeSnapshot(), bigint(1));
    assert.equal(await node.takeSnapshot(), bigint(2));
  });
});

async function createNode(): Promise<HardhatNode> {
  const runtime = createRuntime(async (_options, stateManager) => {
    await stateManager.setBalance("receiver", bigint(25));
    return runTxResult();
  });
  return HardhatNode.create(runtime, {
    accounts: [{ address: "sender" }],
    genesisHeader: { timestamp: bigint(0) },
  });
}

function tx(hashByte: number): any {
  return {
    chainId: bigint(1),
    hash: () => new Uint8Array(32).fill(hashByte),
  };
}

function runTxResult(): any {
  return {
    gasUsed: bigint(21_000),
    logs: [],
  };
}

function createRuntime(
  runTx: (options: any, stateManager: StateManager) => Promise<any>
): QrlNodeRuntime {
  class EVM {
    public constructor(public readonly options: any) {}

    public get stateManager(): StateManager {
      return this.options.stateManager;
    }
  }

  class VM {
    public readonly stateManager: StateManager;
    public readonly evm: EVM;

    public constructor(public readonly options: any) {
      this.stateManager = options.stateManager;
      this.evm = options.evm;
    }

    public async runTx(options: any): Promise<any> {
      return runTx(options, this.stateManager);
    }
  }

  class Receipt {
    public readonly cumulativeGasUsed: bigint;
    public readonly logs: any[] = [];

    public constructor(public readonly options: any) {
      this.cumulativeGasUsed = options.cumulativeGasUsed;
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
      return new Uint8Array(32).fill(Number(this.header.number) + 1);
    }
  }

  return {
    stateQrl: { QRLStateManager: StateManager },
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

class StateManager {
  private _balances = new Map<any, bigint>();
  private _checkpoints: Array<Map<any, bigint>> = [];

  public constructor(_options: any = {}) {}

  public shallowCopy(): StateManager {
    const copy = new StateManager();
    copy._balances = new Map(this._balances);
    copy._checkpoints = this._checkpoints.map(
      (checkpoint) => new Map(checkpoint)
    );
    return copy;
  }

  public async getStateRoot(): Promise<Uint8Array> {
    return new Uint8Array(32).fill(Number(await this.getBalance("receiver")));
  }

  public async checkpoint(): Promise<void> {
    this._checkpoints.push(new Map(this._balances));
  }

  public async commit(): Promise<void> {
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
