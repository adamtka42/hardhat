import { assert } from "chai";

import {
  CallParams,
  HardhatNode,
  QrlNodeRuntime,
} from "../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("Hardhat QRL node calls", function () {
  it("Runs a call in the latest block context and reverts its state changes", async function () {
    let receivedCall: any;
    const runtime = createRuntime(async (call, callStateManager) => {
      receivedCall = call;
      await callStateManager.addBalance(call.to, bigint(5));
      return executionResult(42);
    });
    const node = await HardhatNode.create(runtime, {
      context: { chainId: bigint(7) },
      genesisHeader: {
        timestamp: bigint(10),
        gasLimit: bigint(1_000_000),
        baseFee: bigint(3),
        coinbase: "coinbase",
      },
    });
    const stateManager = (node as any)._stateManager;
    await stateManager.setBalance("sender", bigint(100));
    await stateManager.setBalance("receiver", bigint(0));

    const result = await node.runCall(callParams());

    assert.deepEqual(result, executionResult(42));
    assert.equal(await stateManager.getBalance("sender"), bigint(100));
    assert.equal(await stateManager.getBalance("receiver"), bigint(0));
    assert.equal(receivedCall.caller, "sender");
    assert.equal(receivedCall.origin, "sender");
    assert.equal(receivedCall.context.blockNumber, bigint(0));
    assert.equal(receivedCall.context.timestamp, bigint(10));
    assert.equal(receivedCall.context.gasLimit, bigint(1_000_000));
    assert.equal(receivedCall.context.chainId, bigint(7));
    assert.equal(receivedCall.context.baseFee, bigint(3));
    assert.equal(receivedCall.context.gasPrice, bigint(2));
    assert.equal(receivedCall.context.coinbase, "coinbase");
  });

  it("Runs pending calls against the pending state", async function () {
    let usedStateManager: StateManager | undefined;
    let receivedCall: any;
    const runtime = createRuntime(async (call, callStateManager) => {
      receivedCall = call;
      usedStateManager = callStateManager;
      return executionResult(7);
    });
    const node = await HardhatNode.create(runtime, {
      genesisHeader: { timestamp: bigint(10) },
    });
    const pendingStateManager = new StateManager({});
    const internalNode = node as any;
    internalNode._pendingStateManager = pendingStateManager;
    internalNode._pendingVm = internalNode._createVm(pendingStateManager);
    await node.setNextBlockTimestamp(bigint(100));

    const result = await node.runCall(callParams(), { usePendingState: true });

    assert.deepEqual(result, executionResult(7));
    assert.strictEqual(usedStateManager, pendingStateManager);
    assert.equal(receivedCall.context.blockNumber, bigint(1));
    assert.equal(receivedCall.context.timestamp, bigint(100));
  });

  it("Returns call failures without preserving their state changes", async function () {
    const failure = new Error("execution reverted");
    const runtime = createRuntime(async (call, callStateManager) => {
      await callStateManager.addBalance(call.to, bigint(9));
      return {
        ...executionResult(42),
        exceptionError: failure,
      };
    });
    const node = await HardhatNode.create(runtime);
    const stateManager = (node as any)._stateManager;
    await stateManager.setBalance("sender", bigint(100));

    const result = await node.runCall(callParams());

    assert.strictEqual(result.exceptionError, failure);
    assert.equal(await stateManager.getBalance("sender"), bigint(100));
    assert.equal(await stateManager.getBalance("receiver"), bigint(0));
  });

  it("Builds call frames and struct-log traces without preserving state", async function () {
    const listeners: any[] = [];
    const runtime = createRuntime(
      async (call, callStateManager, evmOptions) => {
        listeners.push(evmOptions.traceListener);
        await callStateManager.addBalance(call.to, bigint(9));
        return {
          ...executionResult(42),
          exceptionError: new Error("execution reverted"),
        };
      }
    );
    const node = await HardhatNode.create(runtime);
    const stateManager = (node as any)._stateManager;
    await stateManager.setBalance("sender", bigint(100));

    const frame = await node.traceCallFrames(callParams());
    assert.equal(frame.kind, "call");
    assert.equal(frame.target, "receiver");
    assert.equal(frame.errorMessage, "execution reverted");
    assert.deepEqual(frame.returnValue, new Uint8Array([42]));

    const trace = await node.debugTraceCall(callParams(), {
      disableStack: true,
      limit: 2,
    });
    assert.isTrue(trace.failed);
    assert.equal(trace.gas, 1);
    assert.deepEqual(trace.structLogs, []);
    assert.isDefined(listeners[0]);
    assert.isDefined(listeners[1]);
    assert.equal(await stateManager.getBalance("sender"), bigint(100));
    assert.equal(await stateManager.getBalance("receiver"), bigint(0));
  });

  it("Reverts state when call execution throws", async function () {
    const runtime = createRuntime(async (call, callStateManager) => {
      await callStateManager.addBalance(call.to, bigint(9));
      throw new Error("call failed");
    });
    const node = await HardhatNode.create(runtime);
    const stateManager = (node as any)._stateManager;
    await stateManager.setBalance("sender", bigint(100));

    await assertRejects(() => node.runCall(callParams()), "call failed");

    assert.equal(await stateManager.getBalance("sender"), bigint(100));
    assert.equal(await stateManager.getBalance("receiver"), bigint(0));
  });
});

function callParams(): CallParams {
  return {
    to: "receiver",
    from: "sender",
    gasLimit: bigint(100_000),
    gasPrice: bigint(2),
    value: bigint(10),
    data: new Uint8Array([1, 2, 3]),
  };
}

function executionResult(value: number): any {
  return {
    returnValue: new Uint8Array([value]),
    gasUsed: bigint(1),
    gasRemaining: bigint(99_999),
    gasRefund: bigint(0),
  };
}

function createRuntime(
  runCall: (
    call: any,
    stateManager: StateManager,
    evmOptions?: any
  ) => Promise<any>
): QrlNodeRuntime {
  class TestStateManager extends StateManager {}

  class EVM {
    public constructor(public readonly options: any) {}

    public async runCall(call: any): Promise<any> {
      return runCall(call, this.options.stateManager, this.options);
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

    public constructor(data: any) {
      this.header = {
        coinbase: "zero",
        timestamp: bigint(0),
        gasLimit: bigint(0),
        baseFee: bigint(0),
        ...data.header,
      };
    }

    public hash(): Uint8Array {
      return new Uint8Array(32).fill(11);
    }
  }

  return {
    stateQrl: { QRLStateManager: TestStateManager },
    evmQrl: { QRLEVM: EVM },
    vmQrl: {
      QRLVM: VM,
      createQRLReceiptFromRunTxResult: (options: any) => options,
      createFrameCollector: (root: any) => ({
        root,
        listener: { type: "frame" },
      }),
      createRawStructLogCollector: (_config: any) => ({
        listener: { type: "struct" },
        finish: () => [],
      }),
      qrlOpcodeName: (opcode: number) => `OP_${opcode}`,
    },
    blockQrl: {
      QRLBlock: Block,
      genQRLTransactionsRoot: async () => new Uint8Array(32),
      genQRLReceiptsRoot: async () => new Uint8Array(32),
    },
  };
}

class StateManager {
  private _balances = new Map<any, bigint>();
  private _checkpoints: Array<Map<any, bigint>> = [];

  public constructor(_options: any) {}

  public async getStateRoot(): Promise<Uint8Array> {
    return new Uint8Array(32).fill(7);
  }

  public async checkpoint(): Promise<void> {
    this._checkpoints.push(new Map(this._balances));
  }

  public async revert(): Promise<void> {
    this._balances = this._checkpoints.pop()!;
  }

  public async getBalance(address: any): Promise<bigint> {
    return this._balances.get(address) ?? bigint(0);
  }

  public async setBalance(address: any, balance: bigint): Promise<void> {
    this._balances.set(address, balance);
  }

  public async addBalance(address: any, amount: bigint): Promise<void> {
    await this.setBalance(address, (await this.getBalance(address)) + amount);
  }

  public async subBalance(address: any, amount: bigint): Promise<void> {
    await this.setBalance(address, (await this.getBalance(address)) - amount);
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
