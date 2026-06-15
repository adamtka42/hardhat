const assert = require("assert");

describe("Sample", function() {
  it("deploys a Hyperion contract", async function() {
    const Sample = await qrl.getContractFactory("Sample");
    const deployment = await Sample.deploy();

    assert.ok(deployment.hash);
    assert.ok(deployment.address);
  });
});
