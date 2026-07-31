import { assert } from "chai";
import { keccak_256 } from "js-sha3";

import { InvalidArgumentsError } from "../../../../src/internal/buidler-evm/provider/errors";
import {
  bloomFilter,
  collectMatchingLogs,
  filterLogs,
  LATEST_BLOCK,
  matchesLogFilter,
  parseLogFilter,
  QRL_FILTER_DEADLINE_MS,
  resolveInstalledFilterMinimum,
  resolveInstalledFilterStart,
  resolveLogFilterBlock,
  serializeLogCriteria,
  topicMatched,
} from "../../../../src/internal/buidler-evm/provider/filter";
import { RpcLogOutput } from "../../../../src/internal/buidler-evm/provider/output";

// tslint:disable no-bitwise

const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);
const QRL_ADDRESS = `Q${"1".repeat(128)}`;
const OTHER_QRL_ADDRESS = `Q${"2".repeat(128)}`;
const TOPIC = `0x${"03".repeat(64)}`;
const OTHER_TOPIC = `0x${"04".repeat(64)}`;

describe("QRL filters", function () {
  it("Normalizes QRL addresses, topics, and block tags", function () {
    const filter = parseLogFilter({
      fromBlock: "0x2",
      toBlock: "latest",
      address: [QRL_ADDRESS],
      topics: [TOPIC, [OTHER_TOPIC, null], null],
    });

    assert.equal(filter.fromBlock, bigint(2));
    assert.equal(filter.toBlock, "latest");
    assert.deepEqual(filter.addresses, [QRL_ADDRESS]);
    assert.deepEqual(Array.from(filter.topics![0]!), [TOPIC]);
    assert.isNull(filter.topics![1]);
    assert.isNull(filter.topics![2]);

    const reparsed = parseLogFilter(serializeLogCriteria(filter));
    assert.equal(reparsed.fromBlock, bigint(2));
    assert.deepEqual(reparsed.addresses, filter.addresses);
    assert.deepEqual(
      Array.from(reparsed.topics![0]!),
      Array.from(filter.topics![0]!)
    );
  });

  it("Rejects invalid filter combinations and topic limits", function () {
    assert.throws(
      () =>
        parseLogFilter({
          blockHash: `0x${"01".repeat(32)}`,
          fromBlock: "latest",
        }),
      InvalidArgumentsError
    );
    assert.throws(
      () => parseLogFilter({ topics: [null, null, null, null, null] }),
      InvalidArgumentsError
    );
    assert.throws(
      () =>
        parseLogFilter({
          topics: [new Array(1001).fill(TOPIC)],
        }),
      InvalidArgumentsError
    );
  });

  it("Matches addresses and positional topic alternatives", function () {
    const log = {
      address: { toString: () => QRL_ADDRESS },
      topics: [
        Uint8Array.from(Buffer.from(TOPIC.slice(2), "hex")),
        Uint8Array.from(Buffer.from(OTHER_TOPIC.slice(2), "hex")),
      ],
    };

    assert.isTrue(
      matchesLogFilter(log, {
        addresses: [QRL_ADDRESS],
        topics: [new Set([TOPIC]), null],
      })
    );
    assert.isTrue(
      matchesLogFilter(log, {
        topics: [new Set([OTHER_TOPIC, TOPIC])],
      })
    );
    assert.isFalse(
      matchesLogFilter(log, {
        addresses: [OTHER_QRL_ADDRESS],
      })
    );
    assert.isFalse(
      matchesLogFilter(log, {
        topics: [null, null, new Set([TOPIC])],
      })
    );
  });

  it("Collects matching logs from block receipts", function () {
    const matching = {
      address: { toString: () => QRL_ADDRESS },
      topics: [Uint8Array.from(Buffer.from(TOPIC.slice(2), "hex"))],
    };
    const other = {
      address: { toString: () => OTHER_QRL_ADDRESS },
      topics: [Uint8Array.from(Buffer.from(OTHER_TOPIC.slice(2), "hex"))],
    };

    assert.deepEqual(
      collectMatchingLogs(
        { receipts: [{ logs: [matching] }, { logs: [other] }] },
        { addresses: [QRL_ADDRESS] }
      ),
      [matching]
    );
  });

  it("Filters formatted logs by block, address, and topics", function () {
    const logs: RpcLogOutput[] = [
      rpcLog("0x1", QRL_ADDRESS, TOPIC),
      rpcLog("0x2", OTHER_QRL_ADDRESS, TOPIC),
      rpcLog("0x3", QRL_ADDRESS, OTHER_TOPIC),
    ];

    assert.deepEqual(
      filterLogs(logs, {
        fromBlock: bigint(1),
        toBlock: bigint(2),
        addresses: [QRL_ADDRESS],
        normalizedTopics: [new Set([TOPIC])],
      }),
      [logs[0]]
    );
    assert.deepEqual(
      filterLogs(logs, {
        fromBlock: bigint(2),
        toBlock: LATEST_BLOCK,
        addresses: [],
        normalizedTopics: [],
      }),
      [logs[1], logs[2]]
    );
  });

  it("Uses QRL bloom entries as a pre-filter", function () {
    const addressBytes = Uint8Array.from(
      Buffer.from(QRL_ADDRESS.slice(1), "hex")
    );
    const topicBytes = Uint8Array.from(Buffer.from(TOPIC.slice(2), "hex"));
    const bloom = new Uint8Array(256);
    addToBloom(bloom, addressBytes);
    addToBloom(bloom, topicBytes);

    assert.isTrue(bloomFilter(bloom, [addressBytes], [[topicBytes]]));
    assert.isFalse(
      bloomFilter(
        bloom,
        [Uint8Array.from(Buffer.from(OTHER_QRL_ADDRESS.slice(1), "hex"))],
        [[topicBytes]]
      )
    );
  });

  it("Resolves installed filter and pending block boundaries", function () {
    const latest = bigint(5);
    assert.deepEqual(resolveLogFilterBlock("pending", bigint(0), latest), {
      number: bigint(6),
      includesPending: true,
    });
    assert.equal(resolveInstalledFilterStart("latest", latest), bigint(6));
    assert.equal(resolveInstalledFilterMinimum("latest"), bigint(0));
    assert.equal(QRL_FILTER_DEADLINE_MS, 300000);
    assert.isTrue(topicMatched([new Set([TOPIC])], [TOPIC]));
  });
});

function rpcLog(
  blockNumber: string,
  address: string,
  topic: string
): RpcLogOutput {
  return {
    address,
    topics: [topic],
    data: "0x",
    blockNumber,
    removed: false,
  };
}

function addToBloom(bloom: Uint8Array, value: Uint8Array): void {
  const hash = new Uint8Array(keccak_256.arrayBuffer(value));
  for (let index = 0; index < 6; index += 2) {
    const bit = ((hash[index] << 8) | hash[index + 1]) & 0x7ff;
    const byteIndex = bloom.length - (bit >> 3) - 1;
    bloom[byteIndex] |= 1 << (hash[index + 1] & 0x07);
  }
}
