import { assert } from "chai";

import {
  InvalidArgumentsError,
  InvalidInputError,
  MethodNotFoundError,
} from "../../../../../src/internal/buidler-evm/provider/errors";
import { EvmModule } from "../../../../../src/internal/buidler-evm/provider/modules/evm";
import { HardhatNode } from "../../../../../src/internal/buidler-evm/provider/node";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);
const ADDRESS = `Q${"01".repeat(64)}`;
const BLOCK_HASH = `0x${"09".repeat(32)}`;

describe("Evm module", function () {
  it("increases time and sets the next block timestamp", async function () {
    const operations: any[] = [];
    const module = createModule(operations);

    assert.equal(await module.processRequest("qrl_increaseTime", [10]), "10");
    assert.equal(
      await module.processRequest("qrl_increaseTime", ["0x5"]),
      "15"
    );
    assert.equal(await module.processRequest("qrl_increaseTime", ["7"]), "22");
    assert.equal(
      await module.processRequest("qrl_setNextBlockTimestamp", [200]),
      "200"
    );

    assert.deepInclude(operations[3], {
      type: "setNextBlockTimestamp",
      timestamp: bigint(200),
    });
  });

  it("mines blocks with QRL header overrides and returns their hash", async function () {
    const operations: any[] = [];
    const module = createModule(operations);

    assert.equal(await module.processRequest("qrl_mine"), BLOCK_HASH);
    assert.equal(
      await module.processRequest("qrl_mine", [
        {
          timestamp: "0x12c",
          gasLimit: 1000,
          baseFee: "7",
          coinbase: ADDRESS,
        },
      ]),
      BLOCK_HASH
    );

    assert.deepEqual(operations[0].options, {});
    assert.equal(operations[1].options.timestamp, bigint(300));
    assert.equal(operations[1].options.gasLimit, bigint(1000));
    assert.equal(operations[1].options.baseFee, bigint(7));
    assert.equal(operations[1].options.coinbase.toString(), ADDRESS);
  });

  it("creates and reverts snapshots", async function () {
    const module = createModule([]);

    assert.equal(await module.processRequest("qrl_snapshot"), "0x1");
    assert.equal(await module.processRequest("qrl_snapshot"), "0x2");
    assert.isTrue(await module.processRequest("qrl_revert", ["0x1"]));
    assert.isFalse(await module.processRequest("qrl_revert", [2]));
  });

  it("validates controls and rejects unknown methods", async function () {
    const module = createModule([]);

    await assertRejects(
      () => module.processRequest("qrl_increaseTime", [-1]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("qrl_setNextBlockTimestamp", [100]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("qrl_mine", [123]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("qrl_snapshot", [1]),
      InvalidArgumentsError
    );
    await assertRejects(
      () => module.processRequest("qrl_unknown"),
      MethodNotFoundError
    );
  });
});

function createModule(operations: any[]): EvmModule {
  let totalTime = bigint(0);
  let nextSnapshot = bigint(1);
  const node: HardhatNode = Object.assign(
    Object.create(HardhatNode.prototype),
    {
      increaseTime: async (increment: bigint) => {
        totalTime += increment;
        operations.push({ type: "increaseTime", increment });
        return totalTime;
      },
      setNextBlockTimestamp: async (timestamp: bigint) => {
        // tslint:disable-next-line:strict-comparisons
        if (timestamp <= bigint(100)) {
          throw new InvalidInputError(
            "timestamp is not greater than the latest block"
          );
        }
        operations.push({ type: "setNextBlockTimestamp", timestamp });
      },
      mineBlock: async (options: any) => {
        operations.push({ type: "mine", options });
        return { hash: () => new Uint8Array(32).fill(9) };
      },
      takeSnapshot: async () => {
        const id = nextSnapshot;
        nextSnapshot += bigint(1);
        return id;
      },
      revertToSnapshot: async (id: bigint) => id === bigint(1),
    }
  );

  return new EvmModule(node, {
    addressFromBytes: (value) => ({
      toString: () => `Q${Buffer.from(value).toString("hex")}`,
    }),
  });
}

async function assertRejects(
  action: () => Promise<unknown>,
  errorType: new (...args: any[]) => Error
): Promise<void> {
  try {
    await action();
    assert.fail("Expected action to reject");
  } catch (error) {
    assert.instanceOf(error, errorType);
  }
}
