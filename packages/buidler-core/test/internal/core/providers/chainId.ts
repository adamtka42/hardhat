import { ERRORS } from "../../../../src/internal/core/errors-list";
import { createChainIdValidationProvider } from "../../../../src/internal/core/providers/chainId";
import { expectHardhatErrorAsync } from "../../../helpers/errors";

import { MockedProvider } from "./mocks";

describe("Chain id provider", () => {
  it("should fail when configured chain id dont match the real chain id", async () => {
    const mock = new MockedProvider();
    mock.setReturnValue("qrl_chainId", "0xabcabc");

    const wrapper = createChainIdValidationProvider(mock, 66666);
    await expectHardhatErrorAsync(
      () => wrapper.send("qrl_getAccounts", []),
      ERRORS.NETWORK.INVALID_GLOBAL_CHAIN_ID
    );
  });
});
