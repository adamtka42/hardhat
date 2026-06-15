import { assert } from "chai";

import { ERRORS } from "../../../../src/internal/core/errors-list";
import { HttpProvider } from "../../../../src/internal/core/providers/http";
import { expectHardhatErrorAsync } from "../../../helpers/errors";

describe("HTTP provider", () => {
  it("Should reject legacy eth_* JSON-RPC methods", async () => {
    const provider = new HttpProvider("http://127.0.0.1:1", "qrl");

    await expectHardhatErrorAsync(
      () => provider.send("eth_blockNumber"),
      ERRORS.NETWORK.LEGACY_ETH_RPC_UNSUPPORTED,
      "eth_blockNumber"
    );
  });

  it("Should keep allowing QRL and custom JSON-RPC methods", async () => {
    const provider = new HttpProvider("http://127.0.0.1:1", "qrl");

    await expectHardhatErrorAsync(
      () => provider.send("qrl_blockNumber"),
      ERRORS.NETWORK.NODE_IS_NOT_RUNNING
    );

    try {
      await provider.send("debug_traceBlockByNumber");
    } catch (error) {
      assert.equal(error.number, ERRORS.NETWORK.NODE_IS_NOT_RUNNING.number);
    }
  });
});
