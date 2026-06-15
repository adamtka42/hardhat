import BN from "bn.js";
import { assert } from "chai";

import { weiToHumanReadableString } from "../../../src/internal/util/wei-values";

describe("Wei values formatting", function () {
  const ONE_GWEI = new BN(10).pow(new BN(9));
  const ONE_QRL = new BN(10).pow(new BN(18));

  it("Should show 0 wei as 0 QRL", function () {
    assert.equal(weiToHumanReadableString(0), "0 QRL");
  });

  it("Should show 1 wei as wei", function () {
    assert.equal(weiToHumanReadableString(1), "1 wei");
  });

  it("Should show 10 wei as wei", function () {
    assert.equal(weiToHumanReadableString(10), "10 wei");
  });

  it("Should show 10000 wei as wei", function () {
    assert.equal(weiToHumanReadableString(10000), "10000 wei");
  });

  it("Should show 100000 wei as gwei", function () {
    assert.equal(weiToHumanReadableString(100000), "0.0001 gwei");
  });

  it("Should show 0.0001 gwei as gwei", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI.divn(10000)), "0.0001 gwei");
  });

  it("Should show 0.1 gwei as gwei", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI.divn(10)), "0.1 gwei");
  });

  it("Should show 1 gwei as gwei", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI), "1 gwei");
  });

  it("Should show 10 gwei as gwei", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI.muln(10)), "10 gwei");
  });

  it("Should show 10 gwei as gwei", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI.muln(10)), "10 gwei");
  });

  it("Should show 10000 gwei as gwei", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI.muln(10000)), "10000 gwei");
  });

  it("Should show 100000 gwei as QRL", function () {
    assert.equal(weiToHumanReadableString(ONE_GWEI.muln(100000)), "0.0001 QRL");
  });

  it("Should show 0.0001 QRL as QRL", function () {
    assert.equal(weiToHumanReadableString(ONE_QRL.divn(10000)), "0.0001 QRL");
  });

  it("Should show 0.1 QRL as QRL", function () {
    assert.equal(weiToHumanReadableString(ONE_QRL.divn(10)), "0.1 QRL");
  });

  it("Should show 1 QRL as QRL", function () {
    assert.equal(weiToHumanReadableString(ONE_QRL), "1 QRL");
  });

  it("Should show 1.2 QRL as QRL", function () {
    assert.equal(
      weiToHumanReadableString(ONE_QRL.add(ONE_QRL.divn(10).muln(2))),
      "1.2 QRL"
    );
  });

  it("Should show 43 QRL as QRL", function () {
    assert.equal(weiToHumanReadableString(ONE_QRL.muln(43)), "43 QRL");
  });
});
