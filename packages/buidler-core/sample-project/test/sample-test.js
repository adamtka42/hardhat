const assert = require("assert");

describe("Sample", function() {
  it("deploys and calls a Hyperion contract", async function() {
    this.timeout(300000);

    const Sample = await qrl.getContractFactory("Sample");
    const sample = await Sample.deploy();

    const tx = await sample.store(42);
    const receipt = await tx.wait();
    const stored = await sample.retrieve();

    assert.ok(sample.deployTransactionHash);
    assert.ok(sample.address);
    assert.strictEqual(receipt.status, "0x1");
    assert.strictEqual(stored.toString(10), "42");
  });
});
