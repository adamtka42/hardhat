import { assert } from "chai";

import {
  Block,
  Blockchain,
} from "../../../../src/internal/buidler-evm/provider/blockchain";

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("QRL blockchain", function () {
  it("Stores sequential blocks and looks them up by number and hash", async function () {
    const blockchain = new Blockchain();
    const genesis = block(0, 1);
    const next = block(1, 2);

    await putBlock(blockchain, genesis);
    await putBlock(blockchain, next);

    assert.strictEqual(await getLatestBlock(blockchain), next);
    assert.strictEqual(await getBlock(blockchain, bigint(0)), genesis);
    assert.strictEqual(await getBlock(blockchain, next.hash()), next);
  });

  it("Rejects gaps in the canonical block sequence", async function () {
    const blockchain = new Blockchain();

    await assertRejects(() => putBlock(blockchain, block(1, 1)));
    await putBlock(blockchain, block(0, 2));
    await assertRejects(() => putBlock(blockchain, block(2, 3)));
  });

  it("Deletes the selected block and every following block", async function () {
    const blockchain = new Blockchain();
    const genesis = block(0, 1);
    const first = block(1, 2);
    const second = block(2, 3);
    await putBlock(blockchain, genesis);
    await putBlock(blockchain, first);
    await putBlock(blockchain, second);

    await deleteBlock(blockchain, first.hash());

    assert.strictEqual(await getLatestBlock(blockchain), genesis);
    await assertRejects(() => getBlock(blockchain, first.hash()));
    await assertRejects(() => getBlock(blockchain, second.hash()));

    const replacement = block(1, 4);
    await putBlock(blockchain, replacement);
    assert.strictEqual(await getLatestBlock(blockchain), replacement);
  });

  it("Rewinds to a canonical snapshot block", async function () {
    const blockchain = new Blockchain();
    const genesis = block(0, 1);
    const first = block(1, 2);
    const second = block(2, 3);
    await putBlock(blockchain, genesis);
    await putBlock(blockchain, first);
    await putBlock(blockchain, second);

    blockchain.deleteAllFollowingBlocks(first);

    assert.strictEqual(await getLatestBlock(blockchain), first);
    await assertRejects(() => getBlock(blockchain, second.hash()));
    assert.throws(
      () => blockchain.deleteAllFollowingBlocks(block(1, 9)),
      "Invalid block"
    );
  });

  it("Iterates over the canonical chain in block order", async function () {
    const blockchain = new Blockchain();
    const blocks = [block(0, 1), block(1, 2), block(2, 3)];
    for (const value of blocks) {
      await putBlock(blockchain, value);
    }

    const visited: Block[] = [];
    await iterate(blockchain, (value, reorg, next) => {
      visited.push(value);
      assert.isFalse(reorg);
      next();
    });

    assert.deepEqual(visited, blocks);
  });

  it("Reports missing blocks without corrupting its indexes", async function () {
    const blockchain = new Blockchain();
    await assertRejects(() => getLatestBlock(blockchain));
    await assertRejects(() => getBlock(blockchain, new Uint8Array(32).fill(9)));
    await assertRejects(() =>
      deleteBlock(blockchain, new Uint8Array(32).fill(9))
    );

    const genesis = block(0, 1);
    await putBlock(blockchain, genesis);
    assert.strictEqual(await getLatestBlock(blockchain), genesis);
  });
});

function block(number: number, hashByte: number): Block {
  const hash = new Uint8Array(32).fill(hashByte);
  return {
    header: { number: bigint(number) },
    hash: () => new Uint8Array(hash),
  };
}

function putBlock(blockchain: Blockchain, value: Block): Promise<Block> {
  return new Promise((resolve, reject) => {
    blockchain.putBlock(value, (error, stored) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(stored!);
      }
    });
  });
}

function getLatestBlock(blockchain: Blockchain): Promise<Block> {
  return new Promise((resolve, reject) => {
    blockchain.getLatestBlock((error, value) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(value!);
      }
    });
  });
}

function getBlock(
  blockchain: Blockchain,
  hashOrNumber: Uint8Array | bigint
): Promise<Block | undefined> {
  return new Promise((resolve, reject) => {
    blockchain.getBlock(hashOrNumber, (error, value) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(value);
      }
    });
  });
}

function deleteBlock(blockchain: Blockchain, hash: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    blockchain.delBlock(hash, (error) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function iterate(
  blockchain: Blockchain,
  onBlock: (
    value: Block,
    reorg: boolean,
    callback: (error?: Error | null) => void
  ) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    blockchain.iterator("test", onBlock, (error) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function assertRejects(action: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await action();
  } catch (_error) {
    rejected = true;
  }
  assert.isTrue(rejected, "Expected promise to reject");
}
