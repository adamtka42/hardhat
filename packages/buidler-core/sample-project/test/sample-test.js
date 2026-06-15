const assert = require("assert");

describe("Sample", function() {
  it("deploys and calls a Hyperion contract", async function() {
    this.timeout(300000);

    const [from] = await network.provider.send("qrl_accounts");
    const Sample = await qrl.getContractFactory("Sample");
    const deployment = await Sample.deploy({ from });
    const sample = await qrl.getContractAt("Sample", deployment.address);

    const txHash = await sample.functions.store(42, { from });
    await qrl.waitForTransaction(txHash);
    const [stored] = await sample.callStatic.retrieve();

    assert.ok(deployment.hash);
    assert.ok(deployment.address);
    assert.strictEqual(stored.toString(10), "42");
  });
});
