import { assert } from "chai";

import { ERRORS } from "../../../src/internal/core/errors-list";
import {
  isValidQrlAddress,
  qrlAddressFromSeed,
  normalizeQrlAddress,
  toQrlChecksumAddress,
} from "../../../src/internal/qrl/address";
import { expectHardhatError } from "../../helpers/errors";

describe("QRL address helpers", () => {
  const checksummed =
    "QA73C065F7018CC0cFFf98028D8Ef1Ff746f5Cb425bC8840A4CDC2A6Eb717faa121A2e959A6A0Dac2D7C38252d70E4541397b0967880f00b9bD0c4C5d0FC46b2D";
  const lowercase = checksummed.toLowerCase().replace(/^q/, "Q");
  const uppercase = checksummed.toUpperCase().replace(/^Q/, "Q");
  const invalidMixedCase = `Q${checksummed.slice(1).replace("A", "a")}`;

  it("derives addresses from the real QRL account implementation", () => {
    const seed =
      "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401";
    const { seedToAccount } = require("@theqrl/web3-qrl-accounts");

    assert.equal(qrlAddressFromSeed(seed), normalizeQrlAddress(seedToAccount(seed).address));
  });

  it("computes QIP-55 checksum casing with SHAKE256", () => {
    assert.equal(toQrlChecksumAddress(lowercase), checksummed);
  });

  it("accepts plain and correctly checksummed QRL addresses", () => {
    assert.isTrue(isValidQrlAddress(lowercase));
    assert.isTrue(isValidQrlAddress(uppercase));
    assert.isTrue(isValidQrlAddress(checksummed));
  });

  it("rejects invalid mixed-case checksum addresses", () => {
    assert.isFalse(isValidQrlAddress(invalidMixedCase));
  });

  it("normalizes valid QRL addresses and rejects invalid ones", () => {
    assert.equal(normalizeQrlAddress(lowercase), checksummed);

    expectHardhatError(
      () => normalizeQrlAddress(invalidMixedCase),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS,
      invalidMixedCase
    );
  });
});
