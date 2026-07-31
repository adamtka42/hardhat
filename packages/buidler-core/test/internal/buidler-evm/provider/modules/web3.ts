import { assert } from "chai";

import {
  InvalidArgumentsError,
  MethodNotFoundError,
} from "../../../../../src/internal/buidler-evm/provider/errors";
import { Web3Module } from "../../../../../src/internal/buidler-evm/provider/modules/web3";

describe("Web3 module", function () {
  const module = new Web3Module();

  it("returns the QRL compatibility client version", async function () {
    assert.strictEqual(
      await module.processRequest("web3_clientVersion"),
      "QRLLocalProvider/qrljs"
    );
  });

  it("returns the keccak-256 hash of decoded input data", async function () {
    assert.strictEqual(
      await module.processRequest("web3_sha3", ["0x"]),
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
    assert.strictEqual(
      await module.processRequest("web3_sha3", ["0x123a1b238123"]),
      "0xc622714c5813be4d0d8a944f9efc949485b298b52cb2c240598fdbcd4e0162a6"
    );
  });

  it("validates input data and rejects unknown methods", async function () {
    await assertRejects(
      () => module.processRequest("web3_sha3", ["0x1"]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("web3_unknown"),
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
