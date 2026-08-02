import { assert } from "chai";

import {
  InvalidArgumentsError,
  MethodNotFoundError,
} from "../../../../../src/internal/buidler-evm/provider/errors";
import { BuidlerModule } from "../../../../../src/internal/buidler-evm/provider/modules/buidler";
import { HardhatNode } from "../../../../../src/internal/buidler-evm/provider/node";

describe("Buidler module", function () {
  const node: HardhatNode = Object.assign(
    Object.create(HardhatNode.prototype),
    { getStackTraceFailuresCount: async () => 3 }
  );
  const module = new BuidlerModule(node);

  it("returns the Hardhat QRL stack trace failure count", async function () {
    assert.equal(
      await module.processRequest("qrl_getStackTraceFailuresCount"),
      3
    );
  });

  it("validates parameters and rejects unknown methods", async function () {
    await assertRejects(
      () =>
        module.processRequest("qrl_getStackTraceFailuresCount", ["unexpected"]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("qrl_unknown"),
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
