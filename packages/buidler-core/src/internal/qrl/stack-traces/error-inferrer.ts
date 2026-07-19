import { getFunctionSignature } from "../abi";

import { QrlContractDebugInfo } from "./debug-info";
import { QrlStackTraceDecoder } from "./decoder";
import { QrlStackTraceDiagnostic, QrlStackTraceEntryType } from "./types";

export function inferQrlStackTrace(
  rootFrame: any,
  decoder: QrlStackTraceDecoder
): QrlStackTraceDiagnostic[] {
  if (rootFrame === undefined || rootFrame.errorMessage === undefined) {
    return [];
  }

  const spine: any[] = [];
  let current = rootFrame;
  while (current !== undefined) {
    spine.push(current);
    current = propagatedFailureChild(current, decoder);
  }

  const diagnostics: QrlStackTraceDiagnostic[] = [];
  const reversed = spine.reverse();
  for (let index = 0; index < reversed.length; index++) {
    const frame = reversed[index];
    const terminal = inferFrame(frame, decoder, index === 0);
    diagnostics.push(terminal);
    for (const caller of inferInternalCallstack(frame, decoder).reverse()) {
      if (!sameSourceReference(caller, terminal.sourceReference)) {
        diagnostics.push({
          type: QrlStackTraceEntryType.CALLSTACK_ENTRY,
          sourceReference: caller,
        });
      }
    }
  }
  return diagnostics;
}

function inferInternalCallstack(
  frame: any,
  decoder: QrlStackTraceDecoder
): any[] {
  const isCreate = frame.kind === "create" || frame.kind === "create2";
  const code = bytesToHex(frame.code ?? (isCreate ? frame.input : undefined));
  const active: any[] = [];
  for (const step of frame.steps ?? []) {
    if (!isPcStep(step)) {
      continue;
    }
    const location = decoder.getSourceLocation(code, step.pc, isCreate);
    if (location?.jumpType === "i") {
      const source = decoder.decodeFrame(code, step.pc, isCreate);
      if (source !== undefined && source.functionName !== "<unknown>") {
        active.push(source);
      }
    } else if (location?.jumpType === "o" && active.length > 0) {
      active.pop();
    }
  }
  return active;
}

function sameSourceReference(left: any, right: any): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.contractName === right.contractName &&
    left.functionName === right.functionName &&
    left.sourceName === right.sourceName &&
    left.line === right.line
  );
}

function inferFrame(
  frame: any,
  decoder: QrlStackTraceDecoder,
  isFailureOrigin: boolean
): QrlStackTraceDiagnostic {
  const isCreate = frame.kind === "create" || frame.kind === "create2";
  if (frame.precompile !== undefined) {
    return {
      type: QrlStackTraceEntryType.PRECOMPILE_ERROR,
      precompile: frame.precompile.toString(),
    };
  }

  const code = bytesToHex(frame.code ?? (isCreate ? frame.input : undefined));
  const contract = decoder.identifyContract(code, isCreate);
  const sourceReference =
    typeof frame.lastPc === "number"
      ? decoder.decodeFrame(code, frame.lastPc, isCreate)
      : undefined;

  if (contract === undefined) {
    return {
      type: isFailureOrigin
        ? isCreate
          ? QrlStackTraceEntryType.UNRECOGNIZED_CREATE_ERROR
          : QrlStackTraceEntryType.UNRECOGNIZED_CONTRACT_ERROR
        : isCreate
        ? QrlStackTraceEntryType.UNRECOGNIZED_CREATE_CALLSTACK_ENTRY
        : QrlStackTraceEntryType.UNRECOGNIZED_CONTRACT_CALLSTACK_ENTRY,
      address: frame.target?.toString(),
      message: frame.returnValue,
    };
  }

  if (!isFailureOrigin) {
    return {
      type: QrlStackTraceEntryType.CALLSTACK_ENTRY,
      sourceReference,
    };
  }

  const dispatchError = inferDispatchError(
    frame,
    contract,
    sourceReference,
    decoder
  );
  if (dispatchError !== undefined) {
    return dispatchError;
  }

  const orderedSteps = Array.isArray(frame.steps) ? frame.steps : [];
  const lastChildIndex = findLastChildIndex(orderedSteps);
  const lastChild =
    lastChildIndex === undefined ? undefined : orderedSteps[lastChildIndex];
  if (
    lastChild !== undefined &&
    lastChild.errorMessage === undefined &&
    failsImmediatelyAfterChild(frame, orderedSteps, lastChildIndex!, decoder)
  ) {
    if (byteLength(lastChild.code) === 0) {
      return {
        type: QrlStackTraceEntryType.NONCONTRACT_ACCOUNT_CALLED_ERROR,
        sourceReference,
        address: lastChild.target?.toString(),
      };
    }
    return {
      type: QrlStackTraceEntryType.RETURNDATA_SIZE_ERROR,
      sourceReference,
    };
  }

  if (hasFailedCallWithoutSubtrace(frame, decoder)) {
    return {
      type: QrlStackTraceEntryType.CALL_FAILED_ERROR,
      sourceReference,
    };
  }

  if (
    lastOpcode(frame) === 0xfd ||
    lastOpcode(frame) === 0xfe ||
    byteLength(frame.returnValue) > 0
  ) {
    return {
      type: QrlStackTraceEntryType.REVERT_ERROR,
      sourceReference,
      message: frame.returnValue,
    };
  }

  if (frame.children?.some((child: any) => child.errorMessage !== undefined)) {
    return {
      type: QrlStackTraceEntryType.CALL_FAILED_ERROR,
      sourceReference,
    };
  }

  return {
    type: QrlStackTraceEntryType.OTHER_EXECUTION_ERROR,
    sourceReference,
  };
}

function inferDispatchError(
  frame: any,
  contract: QrlContractDebugInfo,
  sourceReference: any,
  decoder: QrlStackTraceDecoder
): QrlStackTraceDiagnostic | undefined {
  if (frame.kind === "create" || frame.kind === "create2") {
    const constructor = contract.abi.find(
      (candidate) => candidate.type === "constructor"
    );
    const constructorSource =
      decoder.decodeContractStart(contract, "constructor") ?? sourceReference;
    const constructorValue = frame.value ?? (global as any).BigInt(0);
    const zeroValue = (global as any).BigInt(0);
    if (
      byteLength(frame.returnValue) === 0 &&
      constructorValue > zeroValue &&
      constructor !== undefined &&
      constructor.stateMutability !== "payable"
    ) {
      return {
        type: QrlStackTraceEntryType.FUNCTION_NOT_PAYABLE_ERROR,
        sourceReference: constructorSource,
        value: constructorValue,
      };
    }

    if (constructor !== undefined && byteLength(frame.returnValue) === 0) {
      const initCodeLength = stripHexPrefix(contract.bytecode).length / 2;
      const constructorData = bytes(frame.input).slice(initCodeLength);
      if (!isValidAbiData(constructor.inputs ?? [], constructorData)) {
        return {
          type: QrlStackTraceEntryType.INVALID_PARAMS_ERROR,
          sourceReference: constructorSource,
        };
      }
    }
    return undefined;
  }

  const input = bytes(frame.input);
  const fragment = findCalledFunction(frame, contract);
  const fallback =
    input.length === 0
      ? contract.abi.find((candidate) => candidate.type === "receive") ??
        contract.abi.find((candidate) => candidate.type === "fallback")
      : contract.abi.find((candidate) => candidate.type === "fallback");
  const value = frame.value ?? (global as any).BigInt(0);
  const zero = (global as any).BigInt(0);

  if (fragment !== undefined) {
    if (
      byteLength(frame.returnValue) === 0 &&
      value > zero &&
      fragment.stateMutability !== "payable"
    ) {
      return {
        type: QrlStackTraceEntryType.FUNCTION_NOT_PAYABLE_ERROR,
        sourceReference:
          decoder.decodeContractStart(
            contract,
            getFunctionSignature(fragment)
          ) ?? sourceReference,
        value,
      };
    }
    if (!isValidAbiData(fragment.inputs ?? [], input.slice(4))) {
      return {
        type: QrlStackTraceEntryType.INVALID_PARAMS_ERROR,
        sourceReference:
          decoder.decodeContractStart(
            contract,
            getFunctionSignature(fragment)
          ) ?? sourceReference,
      };
    }
    return undefined;
  }

  if (fallback === undefined && byteLength(frame.returnValue) === 0) {
    return {
      type: QrlStackTraceEntryType.UNRECOGNIZED_FUNCTION_WITHOUT_FALLBACK_ERROR,
      sourceReference: decoder.decodeContractStart(contract) ?? sourceReference,
    };
  }
  if (
    fallback !== undefined &&
    byteLength(frame.returnValue) === 0 &&
    value > zero &&
    fallback.stateMutability !== "payable"
  ) {
    return {
      type: QrlStackTraceEntryType.FALLBACK_NOT_PAYABLE_ERROR,
      sourceReference:
        decoder.decodeContractStart(contract, fallback.type) ?? sourceReference,
      value,
    };
  }
  return undefined;
}

function findCalledFunction(
  frame: any,
  contract: QrlContractDebugInfo
): any | undefined {
  const input = bytes(frame.input);
  const selector = input.length >= 4 ? toHex(input.slice(0, 4)) : undefined;
  const signature = Object.keys(contract.methodIdentifiers).find(
    (candidate) =>
      normalizeSelector(contract.methodIdentifiers[candidate]) === selector
  );
  return signature === undefined
    ? undefined
    : contract.abi.find(
        (candidate) =>
          candidate.type === "function" &&
          getFunctionSignature(candidate) === signature
      );
}

function isValidAbiData(inputs: any[], data: Uint8Array): boolean {
  if (data.length % 64 !== 0) {
    return false;
  }
  return validateParameterHead(inputs, data, 0);
}

function validateParameterHead(
  inputs: any[],
  data: Uint8Array,
  base: number
): boolean {
  const headWords = inputs.reduce(
    (total: number, input: any) => total + staticSlotWords(input),
    0
  );
  const headLength = headWords * 64;
  if (base + headLength > data.length) {
    return false;
  }

  let cursor = base;
  for (const input of inputs) {
    if (isDynamicParam(input)) {
      const relativeOffset = readWordNumber(data, cursor);
      if (
        relativeOffset === undefined ||
        relativeOffset < headLength ||
        relativeOffset % 64 !== 0 ||
        !validateDynamicValue(input, data, base + relativeOffset)
      ) {
        return false;
      }
    }
    cursor += staticSlotWords(input) * 64;
  }
  return true;
}

function validateDynamicValue(
  input: any,
  data: Uint8Array,
  offset: number
): boolean {
  const type = String(input.type ?? "");
  if (type === "string" || type === "bytes") {
    const length = readWordNumber(data, offset);
    return (
      length !== undefined &&
      offset + 64 + Math.ceil(length / 64) * 64 <= data.length
    );
  }

  const dynamicArray = type.match(/^(.*)\[\]$/);
  if (dynamicArray !== null) {
    const length = readWordNumber(data, offset);
    if (length === undefined) {
      return false;
    }
    const element = { ...input, type: dynamicArray[1] };
    const elementsBase = offset + 64;
    if (isDynamicParam(element)) {
      const synthetic = new Array(length).fill(element);
      return validateParameterHead(synthetic, data, elementsBase);
    }
    return elementsBase + length * staticSlotWords(element) * 64 <= data.length;
  }

  const fixedArray = type.match(/^(.*)\[(\d+)\]$/);
  if (fixedArray !== null) {
    const element = { ...input, type: fixedArray[1] };
    return validateParameterHead(
      new Array(parseInt(fixedArray[2], 10)).fill(element),
      data,
      offset
    );
  }

  if (type.startsWith("tuple")) {
    return validateParameterHead(input.components ?? [], data, offset);
  }
  return false;
}

function staticSlotWords(input: any): number {
  if (isDynamicParam(input)) {
    return 1;
  }
  const type = String(input.type ?? "");
  const array = type.match(/^(.*)\[(\d+)\]$/);
  if (array !== null) {
    return (
      staticSlotWords({ ...input, type: array[1] }) * parseInt(array[2], 10)
    );
  }
  if (type.startsWith("tuple")) {
    return (input.components ?? []).reduce(
      (total: number, component: any) => total + staticSlotWords(component),
      0
    );
  }
  return 1;
}

function isDynamicParam(input: any): boolean {
  const type = String(input.type ?? "");
  if (type === "string" || type === "bytes" || /\[\]$/.test(type)) {
    return true;
  }
  const fixedArray = type.match(/^(.*)\[\d+\]$/);
  if (fixedArray !== null) {
    return isDynamicParam({ ...input, type: fixedArray[1] });
  }
  return (
    type.startsWith("tuple") &&
    (input.components ?? []).some((component: any) => isDynamicParam(component))
  );
}

function readWordNumber(data: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 64 > data.length) {
    return undefined;
  }
  let value = 0;
  for (let index = offset; index < offset + 64; index++) {
    value = value * 256 + data[index];
    if (!Number.isSafeInteger(value)) {
      return undefined;
    }
  }
  return value;
}

function propagatedFailureChild(
  frame: any,
  decoder: QrlStackTraceDecoder
): any | undefined {
  const steps = Array.isArray(frame.steps) ? frame.steps : [];
  let hasOrderedChildren = false;
  for (let index = steps.length - 1; index >= 0; index--) {
    const child = steps[index];
    if (!isFrameStep(child)) {
      continue;
    }
    hasOrderedChildren = true;
    if (
      child.errorMessage !== undefined &&
      bytesEqual(child.returnValue, frame.returnValue) &&
      failsImmediatelyAfterChild(frame, steps, index, decoder)
    ) {
      return child;
    }
  }

  // Backward-compatible degradation for an older qrljs runtime that has no
  // ordered frame steps. Empty payloads remain undecidable in that format.
  if (!hasOrderedChildren) {
    const children = (frame.children ?? []).filter(
      (child: any) => child.errorMessage !== undefined
    );
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (
        byteLength(child.returnValue) > 0 &&
        bytesEqual(child.returnValue, frame.returnValue)
      ) {
        return child;
      }
    }
  }
  return undefined;
}

function findLastChildIndex(steps: any[]): number | undefined {
  for (let index = steps.length - 1; index >= 0; index--) {
    if (isFrameStep(steps[index])) {
      return index;
    }
  }
  return undefined;
}

function hasFailedCallWithoutSubtrace(
  frame: any,
  decoder: QrlStackTraceDecoder
): boolean {
  const steps = Array.isArray(frame.steps) ? frame.steps : [];
  const code = bytes(frame.code);
  const isCreate = frame.kind === "create" || frame.kind === "create2";
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (!isPcStep(step) || !isCallOrCreateOpcode(code[step.pc])) {
      continue;
    }
    if (isFrameStep(steps[index + 1])) {
      continue;
    }
    const after = steps.slice(index + 1);
    const last = after[after.length - 1];
    if (after.length === 0 || !isPcStep(last) || code[last.pc] !== 0xfd) {
      continue;
    }
    const callLocation = decoder.getSourceLocation(
      bytesToHex(code),
      step.pc,
      isCreate
    );
    if (callLocation === undefined) {
      continue;
    }
    if (
      after.every((candidate: any) => {
        if (!isPcStep(candidate)) {
          return false;
        }
        const location = decoder.getSourceLocation(
          bytesToHex(code),
          candidate.pc,
          isCreate
        );
        return location === undefined || sameLocation(location, callLocation);
      })
    ) {
      return true;
    }
  }
  return false;
}

function isCallOrCreateOpcode(opcode: number | undefined): boolean {
  return (
    opcode === 0xf0 ||
    opcode === 0xf1 ||
    opcode === 0xf2 ||
    opcode === 0xf4 ||
    opcode === 0xf5 ||
    opcode === 0xfa
  );
}

function failsImmediatelyAfterChild(
  frame: any,
  steps: any[],
  childIndex: number,
  decoder: QrlStackTraceDecoder
): boolean {
  const code = bytes(frame.code);
  const isCreate = frame.kind === "create" || frame.kind === "create2";
  const after = steps.slice(childIndex + 1);
  if (after.length === 0 || after.some((step) => isFrameStep(step))) {
    return false;
  }
  const last = after[after.length - 1];
  if (!isPcStep(last) || code[last.pc] !== 0xfd) {
    return false;
  }

  let callPc: number | undefined;
  for (let index = childIndex - 1; index >= 0; index--) {
    if (isPcStep(steps[index])) {
      callPc = steps[index].pc;
      break;
    }
  }
  if (callPc === undefined) {
    return false;
  }
  const callLocation = decoder.getSourceLocation(
    bytesToHex(code),
    callPc,
    isCreate
  );
  if (callLocation === undefined) {
    return true;
  }

  for (const step of after) {
    if (!isPcStep(step)) {
      return false;
    }
    const location = decoder.getSourceLocation(
      bytesToHex(code),
      step.pc,
      isCreate
    );
    if (location !== undefined && !sameLocation(location, callLocation)) {
      return false;
    }
  }
  return true;
}

function isFrameStep(step: any): boolean {
  return (
    step !== null && typeof step === "object" && typeof step.kind === "string"
  );
}

function isPcStep(step: any): step is { pc: number } {
  return (
    step !== null && typeof step === "object" && typeof step.pc === "number"
  );
}

function sameLocation(left: any, right: any): boolean {
  return (
    left.sourceName === right.sourceName &&
    left.offset === right.offset &&
    left.length === right.length
  );
}

function lastOpcode(frame: any): number | undefined {
  const code = bytes(frame.code);
  return typeof frame.lastPc === "number" ? code[frame.lastPc] : undefined;
}

function normalizeSelector(value: string): string {
  return value.toLowerCase().replace(/^0x/, "");
}

function byteLength(value: unknown): number {
  return value instanceof Uint8Array ? value.length : 0;
}

function bytes(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(0);
}

function bytesEqual(a: unknown, b: unknown): boolean {
  const left = bytes(a);
  const right = bytes(b);
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

function bytesToHex(value: unknown): string {
  return toHex(bytes(value));
}

function toHex(value: Uint8Array): string {
  let result = "";
  for (const byte of value) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}
