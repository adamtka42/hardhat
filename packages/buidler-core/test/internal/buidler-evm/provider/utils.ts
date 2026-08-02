import { assert } from "chai";
import sinon from "sinon";

import { getCurrentTimestamp } from "../../../../src/internal/buidler-evm/provider/utils";

describe("QRL provider utils", function () {
  it("Returns the current timestamp rounded up to seconds", function () {
    const getTime = sinon.stub(Date.prototype, "getTime").returns(1501);

    try {
      assert.equal(getCurrentTimestamp(), 2);
    } finally {
      getTime.restore();
    }
  });
});
