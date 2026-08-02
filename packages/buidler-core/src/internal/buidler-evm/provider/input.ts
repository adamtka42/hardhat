import * as t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter";

import { isValidQrlAddress, qrlAddressToBytes } from "../../qrl/address";

import { InvalidArgumentsError } from "./errors";

function optional<TypeT, OutputT>(
  codec: t.Type<TypeT, OutputT, unknown>,
  name: string = `${codec.name} | undefined`
): t.Type<TypeT | undefined, OutputT | undefined, unknown> {
  return new t.Type(
    name,
    (u: unknown): u is TypeT | undefined => u === undefined || codec.is(u),
    (u, c) => (u === undefined ? t.success(u) : codec.validate(u, c)),
    (a) => (a === undefined ? undefined : codec.encode(a))
  );
}

const isRpcQuantityString = (u: unknown): u is string =>
  typeof u === "string" &&
  u.match(/^0x(?:0|(?:[1-9a-fA-F][0-9a-fA-F]*))$/) !== null;

const isRpcDataString = (u: unknown): u is string =>
  typeof u === "string" && u.match(/^0x(?:[0-9a-fA-F]{2})*$/) !== null;

const isRpcHashString = (u: unknown): u is string =>
  typeof u === "string" && u.length === 66 && isRpcDataString(u);

const isRpcTopicString = (u: unknown): u is string =>
  typeof u === "string" && u.length === 130 && isRpcDataString(u);

const rpcHexToBytes = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value.slice(2), "hex"));

export const rpcQuantity = new t.Type<bigint>(
  "QUANTITY",
  (u): u is bigint => typeof u === "bigint",
  (u, c) =>
    isRpcQuantityString(u)
      ? t.success((global as any).BigInt(u))
      : t.failure(u, c),
  t.identity
);

export const rpcData = new t.Type<Uint8Array>(
  "DATA",
  (u): u is Uint8Array => u instanceof Uint8Array,
  (u, c) =>
    isRpcDataString(u) ? t.success(rpcHexToBytes(u)) : t.failure(u, c),
  t.identity
);

export const rpcHash = new t.Type<Uint8Array>(
  "HASH",
  (u): u is Uint8Array => u instanceof Uint8Array,
  (u, c) =>
    isRpcHashString(u) ? t.success(rpcHexToBytes(u)) : t.failure(u, c),
  t.identity
);

export const rpcStorageKey = new t.Type<Uint8Array>(
  "DATA_32",
  (u): u is Uint8Array => u instanceof Uint8Array && u.length === 32,
  (u, c) =>
    typeof u === "string" && u.length === 66 && isRpcDataString(u)
      ? t.success(rpcHexToBytes(u))
      : t.failure(u, c),
  t.identity
);

export const rpcTopic = new t.Type<Uint8Array>(
  "TOPIC",
  (u): u is Uint8Array => u instanceof Uint8Array,
  (u, c) =>
    isRpcTopicString(u) ? t.success(rpcHexToBytes(u)) : t.failure(u, c),
  t.identity
);

export const rpcUnknown = t.unknown;

export const rpcAddress = new t.Type<Uint8Array>(
  "ADDRESS",
  (u): u is Uint8Array => u instanceof Uint8Array,
  (u, c) =>
    typeof u === "string" && isValidQrlAddress(u)
      ? t.success(qrlAddressToBytes(u))
      : t.failure(u, c),
  t.identity
);

export const logAddress = t.union([
  rpcAddress,
  t.array(rpcAddress),
  t.undefined,
]);

export type LogAddress = t.TypeOf<typeof logAddress>;

export const logTopics = t.union([
  t.array(t.union([t.null, rpcTopic, t.array(t.union([t.null, rpcTopic]))])),
  t.undefined,
]);

export type LogTopics = t.TypeOf<typeof logTopics>;

export const blockTag = t.union([
  rpcQuantity,
  t.keyof({
    earliest: null,
    latest: null,
    pending: null,
  }),
]);

export type BlockTag = t.TypeOf<typeof blockTag>;

export const optionalBlockTag = t.union([blockTag, t.undefined]);

export type OptionalBlockTag = t.TypeOf<typeof optionalBlockTag>;

export const optionalBoolean = optional(t.boolean);

export const rpcTransactionRequest = t.type(
  {
    from: rpcAddress,
    to: optional(rpcAddress),
    gas: optional(rpcQuantity),
    gasLimit: optional(rpcQuantity),
    gasPrice: optional(rpcQuantity),
    maxFeePerGas: optional(rpcQuantity),
    maxPriorityFeePerGas: optional(rpcQuantity),
    value: optional(rpcQuantity),
    data: optional(rpcData),
    nonce: optional(rpcQuantity),
    chainId: optional(rpcQuantity),
  },
  "RpcTransactionRequest"
);

export interface RpcTransactionRequestInput {
  from: string;
  to?: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  value?: string;
  data?: string;
  nonce?: string;
  chainId?: string;
}

export type RpcTransactionRequest = t.TypeOf<typeof rpcTransactionRequest>;

export const rpcCallRequest = t.type(
  {
    from: optional(rpcAddress),
    to: optional(rpcAddress),
    gas: optional(rpcQuantity),
    gasLimit: optional(rpcQuantity),
    gasPrice: optional(rpcQuantity),
    maxFeePerGas: optional(rpcQuantity),
    maxPriorityFeePerGas: optional(rpcQuantity),
    value: optional(rpcQuantity),
    data: optional(rpcData),
  },
  "RpcCallRequest"
);

export interface RpcCallRequestInput {
  from?: string;
  to: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  value?: string;
  data?: string;
}

export type RpcCallRequest = t.TypeOf<typeof rpcCallRequest>;

export const rpcFilterRequest = t.type(
  {
    fromBlock: optionalBlockTag,
    toBlock: optionalBlockTag,
    address: logAddress,
    topics: logTopics,
    blockHash: optional(rpcHash),
  },
  "RpcFilterRequest"
);

export interface RpcSubscribe {
  request: RpcFilterRequest;
}

export type OptionalRpcFilterRequest = t.TypeOf<
  typeof optionalRpcFilterRequest
>;

export const optionalRpcFilterRequest = t.union([
  rpcFilterRequest,
  t.undefined,
]);

export type RpcSubscribeRequest = t.TypeOf<typeof rpcSubscribeRequest>;

export const rpcSubscribeRequest = t.keyof(
  {
    newHeads: null,
    newPendingTransactions: null,
    logs: null,
  },
  "RpcSubscribe"
);

export type RpcFilterRequest = t.TypeOf<typeof rpcFilterRequest>;

export function validateParams(params: any[]): [];

export function validateParams(
  params: any[],
  addr: typeof rpcAddress,
  data: typeof rpcData
): [Uint8Array, Uint8Array];

export function validateParams(
  params: any[],
  addr: typeof rpcAddress,
  block: typeof optionalBlockTag
): [Uint8Array, OptionalBlockTag];

export function validateParams(
  params: any[],
  addr: typeof rpcAddress,
  slot: typeof rpcStorageKey,
  block: typeof optionalBlockTag
): [Uint8Array, Uint8Array, OptionalBlockTag];

export function validateParams(
  params: any[],
  hash: typeof rpcHash,
  bool: typeof optionalBoolean
): [Uint8Array, boolean | undefined];

export function validateParams(
  params: any[],
  tag: typeof blockTag,
  bool: typeof optionalBoolean
): [BlockTag, boolean | undefined];

export function validateParams(params: any[], tag: typeof blockTag): [BlockTag];

export function validateParams(
  params: any[],
  value: typeof rpcHash | typeof rpcData
): [Uint8Array];

export function validateParams(
  params: any[],
  tag: typeof blockTag,
  num: typeof rpcQuantity
): [BlockTag, bigint];

export function validateParams(
  params: any[],
  addr: typeof rpcAddress,
  slot: typeof rpcQuantity,
  block: typeof optionalBlockTag
): [Uint8Array, bigint, OptionalBlockTag];

export function validateParams(
  params: any[],
  tx: typeof rpcTransactionRequest
): [RpcTransactionRequest];

export function validateParams(
  params: any[],
  call: typeof rpcCallRequest,
  block: typeof optionalBlockTag
): [RpcCallRequest, OptionalBlockTag];

export function validateParams(
  params: any[],
  call: typeof rpcTransactionRequest,
  block: typeof optionalBlockTag
): [RpcTransactionRequest, OptionalBlockTag];

export function validateParams(params: any[], num: typeof t.number): [number];

export function validateParams(
  params: any[],
  hash: typeof rpcHash,
  bool: typeof t.boolean
): [Uint8Array, boolean];

export function validateParams(
  params: any[],
  tag: typeof optionalBlockTag,
  bool: typeof t.boolean
): [OptionalBlockTag, boolean];

export function validateParams(
  params: any[],
  num: typeof rpcQuantity,
  bool: typeof t.boolean
): [bigint, boolean];

export function validateParams(
  params: any[],
  num: typeof rpcQuantity
): [bigint];

export function validateParams(
  params: any[],
  hash: typeof rpcHash,
  num: typeof rpcQuantity
): [Uint8Array, bigint];

export function validateParams(
  params: any[],
  num1: typeof rpcQuantity,
  num2: typeof rpcQuantity
): [bigint, bigint];

export function validateParams(
  params: any[],
  addr: typeof rpcAddress,
  data: typeof rpcUnknown
): [Uint8Array, any];

export function validateParams(
  params: any[],
  filterRequest: typeof rpcFilterRequest
): [RpcFilterRequest];

export function validateParams(
  params: any[],
  topics: typeof logTopics
): [LogTopics];

export function validateParams(
  params: any[],
  subscribeRequest: typeof rpcSubscribeRequest
): [RpcSubscribeRequest];

export function validateParams(
  params: any[],
  subscribeRequest: typeof rpcSubscribeRequest,
  optionalFilterRequest: typeof optionalRpcFilterRequest
): [RpcSubscribeRequest, OptionalRpcFilterRequest];

// tslint:disable only-hardhat-error

export function validateParams(params: any[], ...types: Array<t.Type<any>>) {
  if (types === undefined && params.length > 0) {
    throw new InvalidArgumentsError(
      `No argument was expected and got ${params.length}`
    );
  }

  let optionalParams = 0;
  for (let i = types.length - 1; i >= 0; i--) {
    if (types[i].is(undefined)) {
      optionalParams += 1;
    } else {
      break;
    }
  }

  if (optionalParams === 0) {
    if (params.length !== types.length) {
      throw new InvalidArgumentsError(
        `Expected exactly ${types.length} arguments and got ${params.length}`
      );
    }
  } else {
    if (
      params.length > types.length ||
      params.length < types.length - optionalParams
    ) {
      throw new InvalidArgumentsError(
        `Expected between ${types.length - optionalParams} and ${
          types.length
        } arguments and got ${params.length}`
      );
    }
  }

  const decoded: any[] = [];
  for (let i = 0; i < types.length; i++) {
    const result = types[i].decode(params[i]);

    if (result.isLeft()) {
      throw new InvalidArgumentsError(
        `Errors encountered in param ${i}: ${PathReporter.report(result).join(
          ", "
        )}`
      );
    }

    decoded.push(result.value);
  }
  return decoded;
}
