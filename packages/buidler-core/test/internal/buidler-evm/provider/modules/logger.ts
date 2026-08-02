import { assert } from "chai";

import { ModulesLogger } from "../../../../../src/internal/buidler-evm/provider/modules/logger";

describe("Modules logger", function () {
  it("stores plain messages and aligns titled values", function () {
    const logger = new ModulesLogger();

    logger.log("plain message");
    logger.logWithTitle("To", "Q1234");
    logger.logWithTitle("Transaction", "0x1234");

    const logs = logger.getLogs();
    assert.equal(logs[0], "plain message");
    assert.equal(logs[1].indexOf("Q1234"), logs[2].indexOf("0x1234"));
    assert.isTrue(logger.hasLogs());
  });

  it("formats debug arguments like util.format", function () {
    const logger = new ModulesLogger();

    logger.debug("value: %d, name: %s", 7, "QRL");

    assert.deepEqual(logger.getLogs(), ["value: 7, name: QRL"]);
  });

  it("clears messages while retaining stable title alignment", function () {
    const logger = new ModulesLogger();
    logger.logWithTitle("Transaction", "first");
    const valueColumn = logger.getLogs()[0].indexOf("first");

    logger.clearLogs();
    assert.isFalse(logger.hasLogs());
    assert.deepEqual(logger.getLogs(), []);

    logger.logWithTitle("To", "second");
    assert.equal(logger.getLogs()[0].indexOf("second"), valueColumn);
  });
});
