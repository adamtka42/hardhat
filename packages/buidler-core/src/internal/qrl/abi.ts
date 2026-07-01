import BN from "bn.js";
import { keccak_256 } from "js-sha3";

import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

import { isValidQrlAddress, toQrlChecksumAddress } from "./address";

const WORD_BYTES = 64;
const WORD_HEX_LENGTH = WORD_BYTES * 2;
const HEX_DATA_REGEX = /^(0x)?[0-9a-fA-F]*$/;

export interface QrlAbiFunction {
  type?: string;
  name?: string;
  inputs?: QrlAbiParam[];
  outputs?: QrlAbiParam[];
  anonymous?: boolean;
}

interface QrlAbiParam {
  type: string;
  name?: string;
  indexed?: boolean;
}

export interface QrlDecodedEventLog {
  eventName: string;
  args: { [name: string]: any };
  log: any;
}

export function encodeQrlFunctionData(
  abi: any,
  functionName: string,
  args: any[] = []
): string {
  const fragment = findFunctionFragment(abi, functionName);
  const inputs = fragment.inputs ?? [];

  const selector = getFunctionSelector(fragment);
  const encodedArgs = encodeQrlParameters(
    inputs,
    args,
    `Function ${functionName}`
  );

  return `0x${selector}${encodedArgs}`;
}

export function encodeQrlConstructorArgs(abi: any, args: any[] = []): string {
  const fragment = findConstructorFragment(abi);
  const inputs = fragment?.inputs ?? [];

  return `0x${encodeQrlParameters(inputs, args, "Constructor")}`;
}

export function decodeQrlFunctionResult(
  abi: any,
  functionName: string,
  data: string
): any[] {
  const fragment = findFunctionFragment(abi, functionName);
  const outputs = fragment.outputs ?? [];
  const normalized = normalizeHex(data);

  return decodeQrlParameters(outputs, normalized, `Function ${functionName}`);
}

export function decodeQrlEventLog(
  abi: any,
  eventName: string,
  log: any
): QrlDecodedEventLog {
  const fragment = findEventFragment(abi, eventName);
  const topics = normalizeTopics(log);

  assertEventTopic(fragment, topics[0]);

  return decodeEventLogWithFragment(fragment, log, topics);
}

export function decodeQrlReceiptLogs(
  abi: any,
  contractAddress: string,
  receipt: any
): QrlDecodedEventLog[] {
  if (
    receipt === undefined ||
    receipt === null ||
    !Array.isArray(receipt.logs)
  ) {
    return [];
  }

  return receipt.logs
    .filter((log: any) => sameQrlAddress(log.address, contractAddress))
    .map((log: any) => decodeKnownEventLog(abi, log))
    .filter(
      (log: QrlDecodedEventLog | undefined) => log !== undefined
    ) as QrlDecodedEventLog[];
}

export function getQrlEventTopic(abi: any, eventName: string): string {
  const fragment = findEventFragment(abi, eventName);

  return `0x${getEventTopic(fragment)}`;
}

function encodeQrlParameters(
  inputs: QrlAbiParam[],
  args: any[],
  label: string
): string {
  if (args.length !== inputs.length) {
    throw qrlAbiError(
      `${label} expects ${inputs.length} arguments, got ${args.length}`
    );
  }

  const head: string[] = [];
  const tail: string[] = [];
  const headByteLength = inputs.reduce(
    (length, input) => length + staticSlotByteLength(input.type),
    0
  );
  let tailByteLength = 0;

  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];

    if (isDynamicType(input.type)) {
      head.push(encodeWordNumber(headByteLength + tailByteLength));

      const encodedTail = encodeDynamicValue(input.type, args[index]);
      tail.push(encodedTail);
      tailByteLength += encodedTail.length / 2;
    } else {
      head.push(encodeStaticValue(input.type, args[index]));
    }
  }

  return `${head.join("")}${tail.join("")}`;
}

function decodeQrlParameters(
  outputs: QrlAbiParam[],
  data: string,
  label: string
): any[] {
  const headByteLength = outputs.reduce(
    (length, output) => length + staticSlotByteLength(output.type),
    0
  );

  if (data.length < headByteLength * 2) {
    throw qrlAbiError(
      `${label} returned ${
        data.length / 2
      } bytes, expected at least ${headByteLength}`
    );
  }

  if (data.length % WORD_HEX_LENGTH !== 0) {
    throw qrlAbiError(`${label} returned data is not QRL word-aligned`);
  }

  const decoded: any[] = [];
  let headOffset = 0;

  for (const output of outputs) {
    const slotByteLength = staticSlotByteLength(output.type);
    const headValue = data.slice(
      headOffset * 2,
      (headOffset + slotByteLength) * 2
    );

    if (isDynamicType(output.type)) {
      const offset = decodeOffset(headValue, data.length, label);
      decoded.push(decodeDynamicValue(output.type, data, offset));
    } else {
      decoded.push(decodeStaticValue(output.type, headValue));
    }

    headOffset += slotByteLength;
  }

  return decoded;
}

export function getFunctionSignature(fragment: QrlAbiFunction): string {
  const inputs = fragment.inputs ?? [];

  return `${fragment.name}(${inputs
    .map((input) => canonicalType(input.type))
    .join(",")})`;
}

export function isFullFunctionSignature(identifier: string): boolean {
  return isFullSignature(identifier);
}

function isFullSignature(identifier: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*\(.*\)$/.test(identifier);
}

export function findFunctionFragment(
  abi: any,
  identifier: string
): QrlAbiFunction {
  if (!Array.isArray(abi)) {
    throw qrlAbiError("Artifact ABI must be an array");
  }

  const fragments = abi.filter((entry) => entry.type === "function");
  const normalizedSignature = normalizeFunctionSignature(identifier);
  const matches =
    normalizedSignature !== undefined
      ? fragments.filter(
          (entry) => getFunctionSignature(entry) === normalizedSignature
        )
      : fragments.filter((entry) => entry.name === identifier);

  if (matches.length === 0) {
    throw qrlAbiError(`Function ${identifier} not found in contract ABI`);
  }

  if (matches.length > 1) {
    throw qrlAbiError(
      `Function ${identifier} is overloaded. Use a full signature like ${getFunctionSignature(
        matches[0]
      )}.`
    );
  }

  return matches[0];
}

function findEventFragment(abi: any, eventName: string): QrlAbiFunction {
  if (!Array.isArray(abi)) {
    throw qrlAbiError("Artifact ABI must be an array");
  }

  const fragments = abi.filter((entry) => entry.type === "event");
  const normalizedSignature = normalizeEventSignature(eventName);
  const matches =
    normalizedSignature !== undefined
      ? fragments.filter(
          (entry) => getEventSignature(entry) === normalizedSignature
        )
      : fragments.filter((entry) => entry.name === eventName);

  if (matches.length === 0) {
    throw qrlAbiError(`Event ${eventName} not found in contract ABI`);
  }

  if (matches.length > 1) {
    throw qrlAbiError(
      `Event ${eventName} is overloaded. Use a full signature like ${getEventSignature(
        matches[0]
      )}.`
    );
  }

  if (matches[0].anonymous === true) {
    throw qrlAbiError(`Anonymous event ${eventName} is not supported`);
  }

  return matches[0];
}

function findConstructorFragment(abi: any): QrlAbiFunction | undefined {
  if (!Array.isArray(abi)) {
    throw qrlAbiError("Artifact ABI must be an array");
  }

  const matches = abi.filter((entry) => entry.type === "constructor");

  if (matches.length > 1) {
    throw qrlAbiError("Contract ABI has multiple constructors");
  }

  return matches[0];
}

function getFunctionSelector(fragment: QrlAbiFunction): string {
  return keccak_256(getFunctionSignature(fragment)).slice(0, 8);
}

function getEventTopic(fragment: QrlAbiFunction): string {
  return rightPadWord(keccak_256(getEventSignature(fragment)));
}

function getEventSignature(fragment: QrlAbiFunction): string {
  const inputs = fragment.inputs ?? [];

  return `${fragment.name}(${inputs
    .map((input) => canonicalType(input.type))
    .join(",")})`;
}

function decodeKnownEventLog(
  abi: any,
  log: any
): QrlDecodedEventLog | undefined {
  const topics = normalizeTopics(log);

  if (topics.length === 0) {
    return undefined;
  }

  for (const fragment of getEventFragments(abi)) {
    if (topics[0].toLowerCase() === getEventTopic(fragment).toLowerCase()) {
      return decodeEventLogWithFragment(fragment, log, topics);
    }
  }

  return undefined;
}

function getEventFragments(abi: any): QrlAbiFunction[] {
  if (!Array.isArray(abi)) {
    throw qrlAbiError("Artifact ABI must be an array");
  }

  return abi.filter(
    (entry) =>
      entry.type === "event" &&
      entry.name !== undefined &&
      entry.anonymous !== true
  );
}

function decodeEventLogWithFragment(
  fragment: QrlAbiFunction,
  log: any,
  topics: string[]
): QrlDecodedEventLog {
  const inputs = fragment.inputs ?? [];
  const indexedInputs = inputs.filter((input) => input.indexed === true);
  const dataInputs = inputs.filter((input) => input.indexed !== true);
  const normalizedData = normalizeHex(log.data ?? "0x");

  if (topics.length !== indexedInputs.length + 1) {
    throw qrlAbiError(
      `Event ${fragment.name} has ${
        topics.length - 1
      } indexed topics, expected ${indexedInputs.length}`
    );
  }

  const decodedData = decodeQrlParameters(
    dataInputs,
    normalizedData,
    `Event ${fragment.name}`
  );

  const args: { [name: string]: any } = {};
  let topicIndex = 1;
  let dataIndex = 0;

  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const value =
      input.indexed === true
        ? decodeIndexedEventValue(input.type, topics[topicIndex++])
        : decodedData[dataIndex];

    if (input.indexed !== true) {
      dataIndex++;
    }

    args[
      input.name !== undefined && input.name !== "" ? input.name : `${index}`
    ] = value;
  }

  return {
    args,
    eventName: fragment.name!,
    log,
  };
}

function assertEventTopic(fragment: QrlAbiFunction, topic: string | undefined) {
  if (topic === undefined) {
    throw qrlAbiError(`Missing topic for event ${fragment.name}`);
  }

  if (topic.toLowerCase() !== getEventTopic(fragment).toLowerCase()) {
    throw qrlAbiError(`Log topic does not match event ${fragment.name}`);
  }
}

function normalizeTopics(log: any): string[] {
  if (log === undefined || log === null || !Array.isArray(log.topics)) {
    throw qrlAbiError("Log must include topics array");
  }

  return log.topics.map((topic: string) => {
    const normalized = normalizeHex(topic);

    if (normalized.length !== WORD_HEX_LENGTH) {
      throw qrlAbiError(
        `Log topic has ${normalized.length / 2} bytes, expected ${WORD_BYTES}`
      );
    }

    return normalized;
  });
}

function sameQrlAddress(left: string | undefined, right: string): boolean {
  if (left === undefined) {
    return false;
  }

  return left.toLowerCase() === right.toLowerCase();
}

function canonicalType(type: string): string {
  const array = parseArrayType(type);
  if (array !== undefined) {
    return `${canonicalType(array.elementType)}[${array.length ?? ""}]`;
  }

  if (type === "uint") {
    return "uint256";
  }

  if (type === "int") {
    return "int256";
  }

  return type;
}

function normalizeFunctionSignature(identifier: string): string | undefined {
  return normalizeSignature(identifier);
}

function normalizeEventSignature(identifier: string): string | undefined {
  return normalizeSignature(identifier);
}

function normalizeSignature(identifier: string): string | undefined {
  if (!isFullSignature(identifier)) {
    return undefined;
  }

  const match = /^([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\)$/.exec(identifier);

  if (match === null) {
    return undefined;
  }

  const [, name, rawTypes] = match;
  const types =
    rawTypes.trim() === ""
      ? []
      : rawTypes.split(",").map((type) => canonicalType(type.trim()));

  return `${name}(${types.join(",")})`;
}

function isDynamicType(type: string): boolean {
  const canonical = canonicalType(type);

  if (canonical === "string" || canonical === "bytes") {
    return true;
  }

  const array = parseArrayType(canonical);
  if (array === undefined) {
    return false;
  }

  return array.length === undefined || isDynamicType(array.elementType);
}

function encodeStaticValue(type: string, value: any): string {
  const canonical = canonicalType(type);

  const array = parseArrayType(canonical);
  if (array !== undefined) {
    if (array.length === undefined || isDynamicType(array.elementType)) {
      throw qrlAbiError(`Unsupported static QRL ABI type ${type}`);
    }

    if (!Array.isArray(value) || value.length !== array.length) {
      throw qrlAbiError(
        `${type} value must be an array with ${array.length} elements`
      );
    }

    return value
      .map((entry) => encodeStaticValue(array.elementType, entry))
      .join("");
  }

  if (isUintType(canonical)) {
    return encodeUnsigned(canonical, value);
  }

  if (isIntType(canonical)) {
    return encodeSigned(canonical, value);
  }

  if (canonical === "bool") {
    return encodeBool(value);
  }

  if (canonical === "address") {
    return encodeAddress(value);
  }

  const fixedBytes = parseFixedBytesType(canonical);
  if (fixedBytes !== undefined) {
    return encodeFixedBytes(value, fixedBytes);
  }

  throw qrlAbiError(`Unsupported QRL ABI type ${type}`);
}

function decodeStaticValue(type: string, word: string): any {
  const canonical = canonicalType(type);

  const array = parseArrayType(canonical);
  if (array !== undefined) {
    if (array.length === undefined || isDynamicType(array.elementType)) {
      throw qrlAbiError(`Unsupported static QRL ABI type ${type}`);
    }

    return decodeStaticArray(array.elementType, word, array.length);
  }

  if (isUintType(canonical)) {
    return new BN(word, 16);
  }

  if (isIntType(canonical)) {
    return decodeSigned(canonical, word);
  }

  if (canonical === "bool") {
    return new BN(word, 16).eqn(1);
  }

  if (canonical === "address") {
    return toQrlChecksumAddress(`Q${word}`);
  }

  const fixedBytes = parseFixedBytesType(canonical);
  if (fixedBytes !== undefined) {
    return `0x${word.slice(0, fixedBytes * 2)}`;
  }

  throw qrlAbiError(`Unsupported QRL ABI type ${type}`);
}

function encodeDynamicValue(type: string, value: any): string {
  const canonical = canonicalType(type);

  if (canonical === "string") {
    if (typeof value !== "string") {
      throw qrlAbiError("string values must be strings");
    }

    return encodeDynamicBytes(Buffer.from(value, "utf8").toString("hex"));
  }

  if (canonical === "bytes") {
    if (typeof value !== "string") {
      throw qrlAbiError("bytes values must be hex strings");
    }

    return encodeDynamicBytes(normalizeHex(value));
  }

  const array = parseArrayType(canonical);
  if (array !== undefined) {
    if (array.length !== undefined) {
      if (!isDynamicType(array.elementType)) {
        throw qrlAbiError(`Unsupported dynamic QRL ABI type ${type}`);
      }

      return encodeFixedArrayWithDynamicElements(array.elementType, value);
    }

    return encodeDynamicArray(array.elementType, value);
  }

  throw qrlAbiError(`Unsupported dynamic QRL ABI type ${type}`);
}

function decodeDynamicValue(type: string, data: string, offset: number): any {
  const canonical = canonicalType(type);

  if (canonical === "string") {
    return Buffer.from(decodeDynamicBytes(data, offset), "hex").toString(
      "utf8"
    );
  }

  if (canonical === "bytes") {
    return `0x${decodeDynamicBytes(data, offset)}`;
  }

  const array = parseArrayType(canonical);
  if (array !== undefined) {
    if (array.length !== undefined) {
      if (!isDynamicType(array.elementType)) {
        throw qrlAbiError(`Unsupported dynamic QRL ABI type ${type}`);
      }

      return decodeFixedArrayWithDynamicElements(
        array.elementType,
        data,
        offset,
        array.length
      );
    }

    return decodeDynamicArray(array.elementType, data, offset);
  }

  throw qrlAbiError(`Unsupported dynamic QRL ABI type ${type}`);
}

function encodeDynamicBytes(hex: string): string {
  return `${encodeWordNumber(hex.length / 2)}${rightPadToWord(hex)}`;
}

function decodeDynamicBytes(data: string, offset: number): string {
  const length = decodeWordNumber(readWord(data, offset));
  const start = offset + WORD_BYTES;
  const end = start + length;

  assertDataRange(data, start, length);

  return data.slice(start * 2, end * 2);
}

function encodeDynamicArray(elementType: string, value: any): string {
  if (!Array.isArray(value)) {
    throw qrlAbiError("dynamic array value must be an array");
  }

  if (isDynamicType(elementType)) {
    return `${encodeWordNumber(value.length)}${encodeDynamicElementSequence(
      elementType,
      value
    )}`;
  }

  return `${encodeWordNumber(value.length)}${value
    .map((entry) => encodeStaticValue(elementType, entry))
    .join("")}`;
}

function decodeDynamicArray(
  elementType: string,
  data: string,
  offset: number
): any[] {
  const length = decodeWordNumber(readWord(data, offset));
  const bodyOffset = offset + WORD_BYTES;

  if (isDynamicType(elementType)) {
    return decodeDynamicElementSequence(elementType, data, bodyOffset, length);
  }

  assertDataRange(data, bodyOffset, length * WORD_BYTES);

  return decodeStaticArray(
    elementType,
    data.slice(bodyOffset * 2, (bodyOffset + length * WORD_BYTES) * 2),
    length
  );
}

function encodeFixedArrayWithDynamicElements(
  elementType: string,
  value: any
): string {
  if (!Array.isArray(value)) {
    throw qrlAbiError("fixed array value must be an array");
  }

  return encodeDynamicElementSequence(elementType, value);
}

function decodeFixedArrayWithDynamicElements(
  elementType: string,
  data: string,
  offset: number,
  length: number
): any[] {
  return decodeDynamicElementSequence(elementType, data, offset, length);
}

function encodeDynamicElementSequence(
  elementType: string,
  value: any[]
): string {
  const head: string[] = [];
  const tail: string[] = [];
  let tailByteLength = 0;

  for (const entry of value) {
    head.push(encodeWordNumber(value.length * WORD_BYTES + tailByteLength));

    const encodedTail = encodeDynamicValue(elementType, entry);
    tail.push(encodedTail);
    tailByteLength += encodedTail.length / 2;
  }

  return `${head.join("")}${tail.join("")}`;
}

function decodeDynamicElementSequence(
  elementType: string,
  data: string,
  offset: number,
  length: number
): any[] {
  assertDataRange(data, offset, length * WORD_BYTES);

  const decoded: any[] = [];
  for (let index = 0; index < length; index++) {
    const offsetWord = readWord(data, offset + index * WORD_BYTES);
    const elementOffset = decodeOffset(
      offsetWord,
      data.length,
      "Dynamic array"
    );
    decoded.push(decodeDynamicValue(elementType, data, offset + elementOffset));
  }

  return decoded;
}

function decodeStaticArray(
  elementType: string,
  data: string,
  length: number
): any[] {
  if (data.length !== length * WORD_HEX_LENGTH) {
    throw qrlAbiError(
      `Static array has ${data.length / 2} bytes, expected ${
        length * WORD_BYTES
      }`
    );
  }

  const decoded: any[] = [];
  for (let index = 0; index < length; index++) {
    decoded.push(
      decodeStaticValue(
        elementType,
        data.slice(index * WORD_HEX_LENGTH, (index + 1) * WORD_HEX_LENGTH)
      )
    );
  }

  return decoded;
}

function decodeIndexedEventValue(type: string, topic: string): any {
  if (isDynamicType(type)) {
    return `0x${topic}`;
  }

  return decodeStaticValue(type, topic);
}

function encodeUnsigned(type: string, value: any): string {
  const bits = parseIntegerBits(type, "uint");
  const bn = toBN(value);

  if (bn.isNeg()) {
    throw qrlAbiError(`${type} cannot encode negative values`);
  }

  if (bn.bitLength() > bits) {
    throw qrlAbiError(`${type} value exceeds ${bits} bits`);
  }

  return leftPadWord(bn.toString("hex"));
}

function encodeSigned(type: string, value: any): string {
  const bits = parseIntegerBits(type, "int");
  const bn = toBN(value);
  const min = new BN(1).ushln(bits - 1).neg();
  const max = new BN(1).ushln(bits - 1).subn(1);

  if (bn.lt(min) || bn.gt(max)) {
    throw qrlAbiError(`${type} value is outside the signed ${bits}-bit range`);
  }

  const encoded = bn.isNeg() ? new BN(1).ushln(bits).add(bn) : bn;
  return leftPadWord(encoded.toString("hex"));
}

function decodeSigned(type: string, word: string): BN {
  const bits = parseIntegerBits(type, "int");
  const valueHex = word.slice(WORD_HEX_LENGTH - bits / 4);
  const unsigned = new BN(valueHex, 16);
  const signBit = new BN(1).ushln(bits - 1);

  if (unsigned.and(signBit).isZero()) {
    return unsigned;
  }

  return unsigned.sub(new BN(1).ushln(bits));
}

function encodeBool(value: any): string {
  if (value !== true && value !== false) {
    throw qrlAbiError("bool values must be true or false");
  }

  return leftPadWord(value ? "1" : "0");
}

function encodeAddress(value: any): string {
  if (typeof value !== "string" || !isValidQrlAddress(value)) {
    throw qrlAbiError(`Invalid QRL address ${value}`);
  }

  return value.slice(1);
}

function encodeFixedBytes(value: any, size: number): string {
  if (typeof value !== "string") {
    throw qrlAbiError(`bytes${size} value must be a hex string`);
  }

  const normalized = normalizeHex(value);
  if (normalized.length !== size * 2) {
    throw qrlAbiError(`bytes${size} value must be exactly ${size} bytes`);
  }

  return rightPadWord(normalized);
}

function normalizeHex(value: string): string {
  if (!HEX_DATA_REGEX.test(value)) {
    throw qrlAbiError(`Invalid hex data ${value}`);
  }

  const normalized =
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;

  if (normalized.length % 2 !== 0) {
    throw qrlAbiError(`Invalid hex data ${value}`);
  }

  return normalized;
}

function leftPadWord(hex: string): string {
  if (hex.length > WORD_HEX_LENGTH) {
    throw qrlAbiError("Encoded value exceeds one QRL ABI word");
  }

  return hex.padStart(WORD_HEX_LENGTH, "0");
}

function rightPadWord(hex: string): string {
  if (hex.length > WORD_HEX_LENGTH) {
    throw qrlAbiError("Encoded value exceeds one QRL ABI word");
  }

  return hex.padEnd(WORD_HEX_LENGTH, "0");
}

function toBN(value: any): BN {
  if (BN.isBN(value)) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw qrlAbiError("Numeric ABI values must be safe integers");
    }

    return new BN(value);
  }

  if (typeof value === "string") {
    if (value.startsWith("0x") || value.startsWith("0X")) {
      return new BN(value.slice(2), 16);
    }

    return new BN(value, 10);
  }

  throw qrlAbiError(`Unsupported numeric ABI value ${value}`);
}

function isUintType(type: string): boolean {
  return /^uint([0-9]+)$/.test(type);
}

function isIntType(type: string): boolean {
  return /^int([0-9]+)$/.test(type);
}

function parseIntegerBits(type: string, prefix: "uint" | "int"): number {
  const bits = Number(type.slice(prefix.length));

  if (bits < 8 || bits > 512 || bits % 8 !== 0) {
    throw qrlAbiError(`Unsupported QRL ABI integer type ${type}`);
  }

  return bits;
}

function parseFixedBytesType(type: string): number | undefined {
  const match = /^bytes([0-9]+)$/.exec(type);

  if (match === null) {
    return undefined;
  }

  const size = Number(match[1]);
  if (size < 1 || size > WORD_BYTES) {
    throw qrlAbiError(`Unsupported QRL ABI fixed bytes type ${type}`);
  }

  return size;
}

function parseArrayType(
  type: string
): { elementType: string; length?: number } | undefined {
  const match = /^(.*)\[([0-9]*)\]$/.exec(type);

  if (match === null) {
    return undefined;
  }

  if (match[2] === "") {
    return { elementType: match[1] };
  }

  return { elementType: match[1], length: Number(match[2]) };
}

function staticSlotByteLength(type: string): number {
  if (isDynamicType(type)) {
    return WORD_BYTES;
  }

  const array = parseArrayType(canonicalType(type));
  if (array !== undefined) {
    if (array.length === undefined) {
      throw qrlAbiError(`Unsupported static QRL ABI type ${type}`);
    }

    return array.length * staticSlotByteLength(array.elementType);
  }

  return WORD_BYTES;
}

function encodeWordNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw qrlAbiError(`Invalid QRL ABI word number ${value}`);
  }

  return leftPadWord(new BN(value).toString("hex"));
}

function decodeWordNumber(word: string): number {
  const value = new BN(word, 16);

  if (value.bitLength() > 53) {
    throw qrlAbiError("QRL ABI value is too large to decode safely");
  }

  return value.toNumber();
}

function decodeOffset(
  word: string,
  dataHexLength: number,
  label: string
): number {
  const offset = decodeWordNumber(word);

  if (offset % WORD_BYTES !== 0) {
    throw qrlAbiError(`${label} offset ${offset} is not QRL word-aligned`);
  }

  if (offset * 2 > dataHexLength) {
    throw qrlAbiError(`${label} offset ${offset} is outside returned data`);
  }

  return offset;
}

function readWord(data: string, offset: number): string {
  assertDataRange(data, offset, WORD_BYTES);

  return data.slice(offset * 2, (offset + WORD_BYTES) * 2);
}

function assertDataRange(data: string, offset: number, byteLength: number) {
  if (offset < 0 || byteLength < 0 || (offset + byteLength) * 2 > data.length) {
    throw qrlAbiError(
      `QRL ABI data range ${offset}:${offset + byteLength} is out of bounds`
    );
  }
}

function rightPadToWord(hex: string): string {
  const remainder = hex.length % WORD_HEX_LENGTH;

  if (remainder === 0) {
    return hex;
  }

  return hex.padEnd(hex.length + WORD_HEX_LENGTH - remainder, "0");
}

function qrlAbiError(message: string): HardhatError {
  return new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, { message });
}
