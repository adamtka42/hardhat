import { assert } from "chai";

import {
  HardhatNode,
  QrlNodeRuntime,
} from "../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRLVM special options", function () {
  describe("allowUnlimitedContractSize", function () {
    for (const allowUnlimitedContractSize of [true, false]) {
      it(`preserves ${allowUnlimitedContractSize} when recreating the VM`, async function () {
        const evmOptions: any[] = [];
        const node = await HardhatNode.create(createRuntime(evmOptions), {
          allowUnlimitedContractSize,
        });
        const snapshotId = await node.takeSnapshot();

        await node.mineEmptyBlock();
        assert.isTrue(await node.revertToSnapshot(snapshotId));

        assert.isAtLeast(evmOptions.length, 2);
        for (const options of evmOptions) {
          assert.strictEqual(
            options.allowUnlimitedContractSize,
            allowUnlimitedContractSize
          );
        }
      });
    }
  });

  describe("initialDate", function () {
    it("uses the configured timestamp for genesis and advances it when mining", async function () {
      const initialTimestamp = bigint(1767225600);
      const node = await HardhatNode.create(createRuntime(), {
        genesisHeader: { timestamp: initialTimestamp },
      });

      const firstBlock = await node.getLatestBlock();
      const secondBlock = await node.mineEmptyBlock();

      assert.equal(firstBlock.header.timestamp, initialTimestamp);
      assert.equal(secondBlock.header.timestamp, initialTimestamp + bigint(1));
    });
  });
});

function createRuntime(evmOptions: any[] = []): QrlNodeRuntime {
  class StateManager {
    public constructor(_options: any = {}) {}

    public shallowCopy(): StateManager {
      return new StateManager();
    }

    public async getStateRoot(): Promise<Uint8Array> {
      return new Uint8Array(32).fill(7);
    }
  }

  class EVM {
    public constructor(public readonly options: any) {
      evmOptions.push(options);
    }
  }

  class VM {
    public readonly stateManager: any;
    public readonly evm: any;

    public constructor(public readonly options: any) {
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
      return new Uint8Array(32).fill(Number(this.header.number) + 1);
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
      genQRLTransactionsRoot: async () => new Uint8Array(32),
      genQRLReceiptsRoot: async () => new Uint8Array(32),
    },
  };
}
