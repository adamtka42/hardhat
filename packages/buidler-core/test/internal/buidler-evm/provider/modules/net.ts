import { assert } from "chai";

import {
  InvalidArgumentsError,
  MethodNotFoundError,
} from "../../../../../src/internal/buidler-evm/provider/errors";
import { NetModule } from "../../../../../src/internal/buidler-evm/provider/modules/net";
import { numberToRpcQuantity } from "../../../../../src/internal/buidler-evm/provider/output";

const bigint = (value: number): bigint => (global as any).BigInt(value);

describe("Net module", function () {
  const module = new NetModule(bigint(1337));

  it("returns local network status", async function () {
    assert.isTrue(await module.processRequest("net_listening"));
    assert.strictEqual(
      await module.processRequest("net_peerCount"),
      numberToRpcQuantity(0)
    );
  });

  it("returns the network id as a decimal string", async function () {
    assert.strictEqual(await module.processRequest("net_version"), "1337");
  });

  it("validates parameters and rejects unknown methods", async function () {
    await assertRejects(
      () => module.processRequest("net_peerCount", ["unexpected"]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("net_unknown"),
      MethodNotFoundError
    );
  });
});

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
