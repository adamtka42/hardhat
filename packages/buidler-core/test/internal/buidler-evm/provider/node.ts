import { assert } from "chai";
import EventEmitter from "events";

import {
  HardhatNode,
  QrlNodeRuntime,
} from "../../../../src/internal/buidler-evm/provider/node";
import { QRL_CONSOLE_LOG_ADDRESS } from "../../../../src/internal/buidler-evm/stack-traces/consoleLogger";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRL node", function () {
  it("Owns one shared state manager, EVM, and VM", async function () {
    const runtime = createRuntime();
    const context = { chainId: bigint(1), coinbase: "configured-coinbase" };
    let consoleLogCount = 0;
    const consoleLogListener = () => consoleLogCount++;
    const node = await HardhatNode.create(runtime, {
      context,
      consoleLogListener,
      allowUnlimitedContractSize: true,
    });

    assert.instanceOf(node, EventEmitter);
    const internalNode = node as any;
    assert.strictEqual(
      internalNode._vm.evm.options.stateManager,
      internalNode._stateManager
    );
    assert.strictEqual(
      internalNode._vm.options.stateManager,
      internalNode._stateManager
    );
    assert.strictEqual(internalNode._vm.options.evm, internalNode._vm.evm);
    assert.strictEqual(internalNode._vm.options.context, context);
    assert.isUndefined(internalNode._vm.evm.options.consoleLogListener);
    assert.isDefined(internalNode._vm.evm.options.traceListener);
    internalNode._vm.evm.options.traceListener.enterFrame({
      kind: "staticcall",
      target: { toString: () => QRL_CONSOLE_LOG_ADDRESS },
      input: new Uint8Array([1]),
      value: bigint(0),
    });
    assert.equal(consoleLogCount, 1);
    assert.isTrue(internalNode._vm.evm.options.allowUnlimitedContractSize);
    assert.equal(await node.getCoinbaseAddress(), "configured-coinbase");
    assert.equal(await node.getGasPrice(), bigint(0));
    assert.deepEqual(await node.getCode("contract"), new Uint8Array([1]));
    assert.deepEqual(
      await node.getStorageAt("contract", new Uint8Array(32)),
      new Uint8Array([2])
    );
    assert.deepEqual(
      await node.getPendingCode("contract"),
      new Uint8Array([1])
    );
    assert.deepEqual(
      await node.getPendingStorageAt("contract", new Uint8Array(32)),
      new Uint8Array([2])
    );
  });

  it("Initializes genesis state and stores its root in block zero", async function () {
    const runtime = createRuntime();
    const genesis = {
      "0x01": { balance: "100" },
    };
    const node = await HardhatNode.create(runtime, {
      genesis,
      genesisHeader: {
        number: bigint(99),
        timestamp: bigint(123),
        gasLimit: bigint(456),
      },
    });

    assert.deepEqual((node as any)._stateManager.options.genesis, genesis);

    const latest = await node.getLatestBlock();
    assert.strictEqual(await node.getBlockByNumber(bigint(0)), latest);
    assert.strictEqual(await node.getBlockByHash(latest.hash()), latest);
    assert.equal(await node.getLatestBlockNumber(), bigint(0));
    assert.equal(latest.header.timestamp, bigint(123));
    assert.equal(latest.header.gasLimit, bigint(456));
    assert.deepEqual(latest.header.stateRoot, new Uint8Array(32).fill(7));
  });

  it("Initializes and exposes local accounts", async function () {
    const runtime = createRuntime();
    const node = await HardhatNode.create(runtime, {
      accounts: [
        { address: "sender", balance: "100", nonce: bigint(2) },
        { address: "receiver", balance: "5" },
      ],
    });

    assert.deepEqual(await node.getLocalAccountAddresses(), [
      "sender",
      "receiver",
    ]);
    assert.equal(await node.getAccountBalance("sender"), bigint(100));
    assert.equal(await node.getAccountNonce("sender"), bigint(2));
    assert.equal(await node.getAccountBalance("receiver"), bigint(5));
  });
});

function createRuntime(): QrlNodeRuntime {
  class StateManager {
    public constructor(public readonly options: any) {}

    public async getStateRoot(): Promise<Uint8Array> {
      return new Uint8Array(32).fill(7);
    }

    public async getBalance(address: any): Promise<bigint> {
      const account = this.options.genesis?.[address.toString().toLowerCase()];
      return bigint(account?.balance ?? 0);
    }

    public async getNonce(address: any): Promise<bigint> {
      const account = this.options.genesis?.[address.toString().toLowerCase()];
      return bigint(account?.nonce ?? 0);
    }

    public async getCode(_address: any): Promise<Uint8Array> {
      return new Uint8Array([1]);
    }

    public async getStorage(
      _address: any,
      _key: Uint8Array
    ): Promise<Uint8Array> {
      return new Uint8Array([2]);
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
  }

  class Block {
    public readonly header: any;

    public constructor(data: any) {
      this.header = data.header;
    }

    public hash(): Uint8Array {
      return new Uint8Array(32).fill(11);
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
