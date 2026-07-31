import { ERRORS } from "../../../../src/internal/core/errors-list";
import { HttpProvider } from "../../../../src/internal/core/providers/http";
import { expectHardhatErrorAsync } from "../../../helpers/errors";

describe("HTTP provider", () => {
  it("Should forward every JSON-RPC method namespace to the node", async () => {
    const provider = new HttpProvider("http://127.0.0.1:1", "qrl");

    for (const method of [
      "qrl_blockNumber",
      "eth_blockNumber",
      "debug_traceBlockByNumber",
    ]) {
      await expectHardhatErrorAsync(
        () => provider.send(method),
        ERRORS.NETWORK.NODE_IS_NOT_RUNNING
      );
    }
  });
});
