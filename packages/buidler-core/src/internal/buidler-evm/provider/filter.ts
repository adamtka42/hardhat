import { keccak_256 } from "js-sha3";

import { toQrlChecksumAddress } from "../../qrl/address";

import { InvalidArgumentsError } from "./errors";
import {
  LogAddress,
  LogTopics,
  OptionalBlockTag,
  rpcFilterRequest,
  validateParams,
} from "./input";
import { bufferToRpcData, numberToRpcQuantity, RpcLogOutput } from "./output";

// tslint:disable only-hardhat-error no-bitwise strict-comparisons

const BIGINT_ZERO: bigint = (global as any).BigInt(0);
const BIGINT_ONE: bigint = (global as any).BigInt(1);
const QRL_LOGS_BLOOM_BYTES = 256;
const MAX_LOG_TOPIC_POSITIONS = 4;
const MAX_LOG_TOPIC_ALTERNATIVES = 1000;

export const LATEST_BLOCK: bigint = (global as any).BigInt(-1);
export const QRL_FILTER_DEADLINE_MS = 5 * 60 * 1000;

export type QRLNormalizedTopics = Array<Set<string> | null>;

export interface QRLLogFilter {
  fromBlock?: OptionalBlockTag;
  toBlock?: OptionalBlockTag;
  blockHash?: Uint8Array;
  addresses?: string[];
  topics?: QRLNormalizedTopics;
}

export type QRLInstalledFilter = (
  | {
      type: "log";
      criteria: QRLLogFilter;
      minimumBlock: bigint;
      nextBlock: bigint;
    }
  | { type: "block"; lastBlock: bigint }
  | { type: "pendingTx"; reported: Set<string> }
) & { deadline: number };

export type QRLSubscription =
  | { type: "newHeads" }
  | { type: "newPendingTransactions"; fullObjects: boolean }
  | {
      type: "logs";
      criteria: QRLLogFilter;
      fromBound?: bigint;
      toBound?: bigint;
    };

export type QRLSubscriptionBound =
  | { kind: "latest" }
  | { kind: "number"; value: bigint };

export interface FilterCriteria {
  fromBlock: bigint;
  toBlock: bigint;
  addresses: string[];
  normalizedTopics: QRLNormalizedTopics;
}

interface QrlLogLike {
  address: {
    toString(): string;
  };
  topics: ReadonlyArray<Uint8Array>;
}

interface QrlReceiptLike<LogT extends QrlLogLike> {
  logs: ReadonlyArray<LogT>;
}

interface QrlBlockLike<LogT extends QrlLogLike> {
  receipts: ReadonlyArray<QrlReceiptLike<LogT>>;
}

export function parseLogFilter(value: unknown): QRLLogFilter {
  if (!isRecord(value)) {
    throw new InvalidArgumentsError("QRL log filter must be an object");
  }

  const request = validateParams([value], rpcFilterRequest)[0];
  if (
    request.blockHash !== undefined &&
    (request.fromBlock !== undefined || request.toBlock !== undefined)
  ) {
    throw new InvalidArgumentsError(
      "QRL log filter blockHash cannot be combined with fromBlock or toBlock"
    );
  }

  return {
    fromBlock: request.fromBlock,
    toBlock: request.toBlock,
    blockHash: request.blockHash,
    addresses: normalizeLogAddresses(request.address),
    topics: normalizeLogTopics(request.topics),
  };
}

export function serializeLogCriteria(
  criteria: QRLLogFilter
): Record<string, unknown> {
  return {
    fromBlock: serializeBlockTag(criteria.fromBlock),
    toBlock: serializeBlockTag(criteria.toBlock),
    address: criteria.addresses,
    topics: criteria.topics?.map((topic) =>
      topic === null ? null : Array.from(topic)
    ),
  };
}

export function parseSubscriptionBound(
  value: OptionalBlockTag,
  name: string
): QRLSubscriptionBound {
  if (value === undefined || value === "latest") {
    return { kind: "latest" };
  }
  if (value === "earliest") {
    return { kind: "number", value: BIGINT_ZERO };
  }
  if (value === "pending") {
    throw new InvalidArgumentsError(
      `qrl_subscribe logs ${name} cannot be 'pending'`
    );
  }
  return { kind: "number", value };
}

export interface ResolvedLogFilterBlock {
  number: bigint;
  includesPending: boolean;
}

export function resolveLogFilterBlock(
  value: OptionalBlockTag,
  fallback: bigint,
  latest: bigint
): ResolvedLogFilterBlock {
  if (value === undefined) {
    return { number: fallback, includesPending: false };
  }
  if (value === "latest") {
    return { number: latest, includesPending: false };
  }
  if (value === "pending") {
    return { number: latest + BIGINT_ONE, includesPending: true };
  }
  if (value === "earliest") {
    return { number: BIGINT_ZERO, includesPending: false };
  }
  return { number: value, includesPending: false };
}

export function resolveInstalledFilterStart(
  value: OptionalBlockTag,
  latest: bigint
): bigint {
  if (value === undefined || value === "latest" || value === "pending") {
    return latest + BIGINT_ONE;
  }
  if (value === "earliest") {
    return BIGINT_ZERO;
  }
  return value;
}

export function resolveInstalledFilterMinimum(value: OptionalBlockTag): bigint {
  if (
    value === undefined ||
    value === "latest" ||
    value === "pending" ||
    value === "earliest"
  ) {
    return BIGINT_ZERO;
  }
  return value;
}

export function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function collectMatchingLogs<LogT extends QrlLogLike>(
  block: QrlBlockLike<LogT>,
  filter: QRLLogFilter
): LogT[] {
  const logs: LogT[] = [];
  for (const receipt of block.receipts) {
    for (const log of receipt.logs) {
      if (matchesLogFilter(log, filter)) {
        logs.push(log);
      }
    }
  }
  return logs;
}

export function matchesLogFilter(
  log: QrlLogLike,
  filter: QRLLogFilter
): boolean {
  if (
    filter.addresses !== undefined &&
    !filter.addresses.includes(log.address.toString())
  ) {
    return false;
  }

  if (filter.topics === undefined) {
    return true;
  }

  return topicMatched(
    filter.topics,
    log.topics.map((topic) => bufferToRpcData(topic))
  );
}

export function filterLogs(
  logs: RpcLogOutput[],
  criteria: FilterCriteria
): RpcLogOutput[] {
  const filteredLogs: RpcLogOutput[] = [];
  for (const log of logs) {
    if (log.blockNumber === undefined) {
      continue;
    }

    const blockNumber = (global as any).BigInt(log.blockNumber);
    if (blockNumber < criteria.fromBlock) {
      continue;
    }

    if (criteria.toBlock !== LATEST_BLOCK && blockNumber > criteria.toBlock) {
      continue;
    }

    if (
      criteria.addresses.length !== 0 &&
      !criteria.addresses.includes(log.address)
    ) {
      continue;
    }

    if (!topicMatched(criteria.normalizedTopics, log.topics)) {
      continue;
    }

    filteredLogs.push(log);
  }

  return filteredLogs;
}

export function topicMatched(
  normalizedTopics: QRLNormalizedTopics,
  logTopics: string[]
): boolean {
  if (normalizedTopics.length > logTopics.length) {
    return false;
  }

  for (let i = 0; i < normalizedTopics.length; i++) {
    const acceptedTopics = normalizedTopics[i];
    if (acceptedTopics === null || acceptedTopics.size === 0) {
      continue;
    }
    if (!acceptedTopics.has(logTopics[i])) {
      return false;
    }
  }

  return true;
}

export function bloomFilter(
  bloom: Uint8Array,
  addresses: Uint8Array[],
  normalizedTopics: Array<Array<Uint8Array | null> | null>
): boolean {
  if (bloom.length !== QRL_LOGS_BLOOM_BYTES) {
    throw new Error(`Invalid QRL logs bloom length=${bloom.length}`);
  }

  if (
    addresses.length > 0 &&
    !addresses.some((address) => bloomContains(bloom, address))
  ) {
    return false;
  }

  for (const alternatives of normalizedTopics) {
    if (alternatives === null || alternatives.length === 0) {
      continue;
    }
    if (
      !alternatives.some(
        (topic) => topic !== null && bloomContains(bloom, topic)
      )
    ) {
      return false;
    }
  }

  return true;
}

function normalizeLogAddresses(addresses: LogAddress): string[] | undefined {
  if (addresses === undefined) {
    return undefined;
  }

  const values = Array.isArray(addresses) ? addresses : [addresses];
  if (values.length === 0) {
    return undefined;
  }
  return values.map((address) =>
    toQrlChecksumAddress(`Q${Buffer.from(address).toString("hex")}`)
  );
}

function normalizeLogTopics(
  topics: LogTopics
): QRLNormalizedTopics | undefined {
  if (topics === undefined) {
    return undefined;
  }
  if (topics.length > MAX_LOG_TOPIC_POSITIONS) {
    throw new InvalidArgumentsError(
      `QRL log filter allows at most ${MAX_LOG_TOPIC_POSITIONS} topic positions`
    );
  }

  return topics.map((entry) => {
    if (entry === null) {
      return null;
    }
    if (entry instanceof Uint8Array) {
      return new Set([bufferToRpcData(entry)]);
    }
    if (entry.length > MAX_LOG_TOPIC_ALTERNATIVES) {
      throw new InvalidArgumentsError(
        `QRL log filter allows at most ${MAX_LOG_TOPIC_ALTERNATIVES} topic alternatives`
      );
    }
    if (entry.length === 0 || entry.some((topic) => topic === null)) {
      return null;
    }
    return new Set(entry.map((topic) => bufferToRpcData(topic as Uint8Array)));
  });
}

function bloomContains(bloom: Uint8Array, value: Uint8Array): boolean {
  const hash = new Uint8Array(keccak_256.arrayBuffer(value));
  for (let index = 0; index < 6; index += 2) {
    const bit = ((hash[index] << 8) | hash[index + 1]) & 0x7ff;
    const byteIndex = QRL_LOGS_BLOOM_BYTES - (bit >> 3) - 1;
    if ((bloom[byteIndex] & (1 << (hash[index + 1] & 0x07))) === 0) {
      return false;
    }
  }
  return true;
}

function serializeBlockTag(value: OptionalBlockTag): string | undefined {
  return typeof value === "bigint" ? numberToRpcQuantity(value) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
