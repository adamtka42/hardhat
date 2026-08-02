import { assert } from "chai";

import {
  InvalidArgumentsError,
  InvalidInputError,
  MethodNotFoundError,
} from "../../../../../src/internal/buidler-evm/provider/errors";
import {
  DebugModule,
  DebugModuleConfig,
} from "../../../../../src/internal/buidler-evm/provider/modules/debug";
import { HardhatNode } from "../../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

const FROM = `Q${"01".repeat(64)}`;
const TO = `Q${"02".repeat(64)}`;
const TRANSACTION_HASH = `0x${"03".repeat(32)}`;

describe("Debug module", function () {
  it("traces a transaction by hash with the requested config", async function () {
    const calls: any[] = [];
    const module = createModule(calls);

    const result = await module.processRequest("debug_traceTransaction", [
      TRANSACTION_HASH,
      { disableStack: true, enableMemory: true, limit: "0x2" },
    ]);

    assert.deepEqual(result, { kind: "transaction-trace" });
    assert.deepEqual(calls, [
      {
        method: "transaction",
        hash: new Uint8Array(32).fill(3),
        config: { disableStack: true, enableMemory: true, limit: 2 },
      },
    ]);
  });

  it("builds a pending call and delegates its trace to the node", async function () {
    const calls: any[] = [];
    const module = createModule(calls);

    const result = await module.processRequest("debug_traceCall", [
      {
        from: FROM,
        to: TO,
        gas: "0x64",
        maxFeePerGas: "0x5",
        maxPriorityFeePerGas: "0x1",
        value: "0x2",
        data: "0x1234",
      },
      "pending",
      { limit: 3 },
    ]);

    assert.deepEqual(result, { kind: "call-trace" });
    assert.equal(calls[0].method, "createTransaction");
    assert.equal(calls[0].data.nonce, bigint(9));
    assert.equal(calls[0].data.gasLimit, bigint(100));
    assert.equal(calls[0].data.gasFeeCap, bigint(5));
    assert.equal(calls[0].data.gasTipCap, bigint(1));
    assert.equal(calls[1].method, "effectiveGasPrice");
    assert.equal(calls[2].method, "call");
    assert.equal(calls[2].call.gasPrice, bigint(7));
    assert.deepEqual(calls[2].call.data, new Uint8Array([0x12, 0x34]));
    assert.deepEqual(calls[2].config, {
      disableStack: false,
      enableMemory: false,
      limit: 3,
    });
    assert.deepEqual(calls[2].options, { usePendingState: true });
  });

  it("rejects unsupported trace options and state tags", async function () {
    const module = createModule([]);
    const request = { from: FROM, to: TO };

    await assertRejects(
      () =>
        module.processRequest("debug_traceCall", [
          request,
          "latest",
          { tracer: "callTracer" },
        ]),
      InvalidArgumentsError
    );
    await assertRejects(
      () =>
        module.processRequest("debug_traceCall", [
          request,
          "latest",
          { disableStorage: false },
        ]),
      InvalidArgumentsError
    );
    await assertRejects(
      () =>
        module.processRequest("debug_traceCall", [
          request,
          "latest",
          { disableStack: "yes" },
        ]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("debug_traceCall", [request, "0x0"]),
      InvalidInputError
    );
    await assertRejects(
      () =>
        module.processRequest("debug_traceTransaction", [
          TRANSACTION_HASH,
          { limit: -1 },
        ]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("debug_unknown"),
      MethodNotFoundError
    );
  });
});

function createModule(calls: any[]): DebugModule {
  const fromAddress = { id: "from" };
  const toAddress = { id: "to" };
  const node = ({
    getPendingAccountNonce: async () => bigint(9),
    getAccountNonce: async () => bigint(8),
    getLatestBlock: async () => ({
      header: {
        baseFee: bigint(0),
        number: bigint(4),
        timestamp: bigint(5),
      },
    }),
    getCoinbaseAddress: async () => ({ id: "coinbase" }),
    getBlockGasLimit: async () => bigint(1000),
    debugTraceCall: async (call: any, traceConfig: any, options: any) => {
      calls.push({ method: "call", call, config: traceConfig, options });
      return { kind: "call-trace" };
    },
    debugTraceTransaction: async (hash: any, traceConfig: any) => {
      calls.push({ method: "transaction", hash, config: traceConfig });
      return { kind: "transaction-trace" };
    },
  } as any) as HardhatNode;
  const config: DebugModuleConfig = {
    chainId: bigint(1337),
    addressFromBytes: (value) => (value[0] === 1 ? fromAddress : toAddress),
    defaultGasLimit: bigint(200),
    createTransaction: (data) => {
      calls.push({ method: "createTransaction", data });
      return {
        ...data,
        gasFeeCap: data.gasFeeCap,
        gasTipCap: data.gasTipCap,
      };
    },
    effectiveGasPrice: (transaction, context) => {
      calls.push({ method: "effectiveGasPrice", transaction, context });
      return bigint(7);
    },
  };
  return new DebugModule(config, node);
}

async function assertRejects(
  action: () => Promise<any>,
  expectedError: new (...args: any[]) => Error
): Promise<void> {
  try {
    await action();
    assert.fail("Expected request to be rejected");
  } catch (error) {
    assert.instanceOf(error, expectedError);
  }
}
