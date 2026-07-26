import { getFunctionSignature } from "../../qrl/abi";

import { QrlContractDebugInfo } from "./compiler-to-model";
import {
  QrlStackTraceDiagnostic,
  QrlStackTraceEntryType,
} from "./solidity-stack-trace";
import { QrlStackTraceDecoder } from "./vm-trace-decoder";

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
    const internalCallstack = inferInternalCallstack(frame, decoder);
    if (
      (terminal.sourceReference === undefined ||
        terminal.sourceReference.functionName === "<unknown>") &&
      internalCallstack.length > 0
    ) {
      terminal.sourceReference = internalCallstack.pop();
    }
    if (frame.kind === "create" || frame.kind === "create2") {
      if (terminal.sourceReference !== undefined) {
        for (
          let sourceIndex = internalCallstack.length - 1;
          sourceIndex >= 0;
          sourceIndex--
        ) {
          const source = internalCallstack[sourceIndex];
          if (
            source.functionName === "constructor" &&
            source.sourceName !== terminal.sourceReference.sourceName
          ) {
            internalCallstack.splice(sourceIndex, 1);
          }
        }
      }
      const code = bytesToHex(frame.code ?? frame.input);
      const implicitConstructor = decoder.decodeImplicitCreationStart(code);
      if (
        implicitConstructor !== undefined &&
        terminal.sourceReference?.functionName !== "constructor" &&
        implicitConstructor.sourceName !==
          terminal.sourceReference?.sourceName &&
        !internalCallstack.some(
          (source) =>
            source.sourceName === implicitConstructor.sourceName &&
            source.functionName === "constructor"
        )
      ) {
        internalCallstack.unshift(implicitConstructor);
      }
    }
    const remaining = allowedCallsiteCounts(
      internalCallstack,
      terminal.sourceReference
    );
    diagnostics.push(terminal);
    for (const caller of internalCallstack.reverse()) {
      const key = sourceReferenceKey(caller);
      const allowed = remaining.get(key) ?? 0;
      if (allowed === 0) {
        continue;
      }
      remaining.set(key, allowed - 1);
      diagnostics.push({
        type: QrlStackTraceEntryType.CALLSTACK_ENTRY,
        sourceReference: caller,
      });
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
  const externalCallsites: any[] = [];
  let previousPc: number | undefined;
  for (const step of frame.steps ?? []) {
    if (!isPcStep(step)) {
      if (isFrameStep(step) && previousPc !== undefined) {
        const callsite = decoder.decodeFrame(code, previousPc, isCreate);
        if (callsite !== undefined) {
          externalCallsites.push(callsite);
        }
      }
      continue;
    }
    previousPc = step.pc;
    const location = decoder.getSourceLocation(code, step.pc, isCreate);
    if (location?.jumpType === "i") {
      const source = decoder.decodeFrame(code, step.pc, isCreate);
      if (source !== undefined && source.functionName !== "<unknown>") {
        if (source.sourceName === "@theqrl/hardhat/console.hyp") {
          continue;
        }
        active.push(source);
        const target = decoder.decodeInternalCallTarget(
          location,
          source.contractName
        );
        if (target !== undefined && !sameSourceReference(target, source)) {
          if (sameFunctionReference(target, source)) {
            Object.defineProperties(source, {
              __qrlRecursiveCall: { value: true },
              __qrlLocationKey: {
                value: [location.offset, location.length].join(":"),
              },
            });
          }
          active.push(target);
        }
      }
    } else if (location?.jumpType === "o" && active.length > 0) {
      active.pop();
    }
  }
  return active.filter(
    (source, index) =>
      (!externalCallsites.some((callsite) =>
        sameSourceReference(source, callsite)
      ) &&
        !decoder.isFunctionStartReference(source)) ||
      !active
        .slice(index + 1)
        .some((next) => sameFunctionReference(source, next))
  );
}

function allowedCallsiteCounts(
  sources: any[],
  terminal: any
): Map<string, number> {
  const counts = new Map<string, number>();
  const references = new Map<string, any>();
  const recursiveLocations = new Map<string, Set<string>>();
  for (const source of sources) {
    const key = sourceReferenceKey(source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    references.set(key, source);
    if (source.__qrlRecursiveCall === true) {
      const locations = recursiveLocations.get(key) ?? new Set<string>();
      locations.add(source.__qrlLocationKey);
      recursiveLocations.set(key, locations);
    }
  }
  for (const [key, count] of counts) {
    const reference = references.get(key);
    const sameFunction = sameFunctionReference(reference, terminal);
    const isRecursive = recursiveLocations.has(key);
    counts.set(
      key,
      sameFunction && isRecursive
        ? count > 2
          ? Math.ceil(count / 2)
          : count
        : sameFunction
        ? count <= 2
          ? 0
          : Math.floor(count / 2)
        : Math.ceil(count / 2)
    );
  }
  return counts;
}

function sameFunctionReference(left: any, right: any): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.contractName === right.contractName &&
    left.functionName === right.functionName &&
    left.sourceName === right.sourceName
  );
}

function sourceReferenceKey(source: any): string {
  return [
    source?.contractName,
    source?.functionName,
    source?.sourceName,
    source?.line,
  ].join(":");
}

function sameSourceReference(left: any, right: any): boolean {
  return sameFunctionReference(left, right) && left.line === right.line;
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
  let sourceReference =
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

  if (
    !isCreate &&
    (sourceReference === undefined ||
      sourceReference.functionName === "<unknown>")
  ) {
    const fragment = findCalledFunction(frame, contract);
    const fallback =
      contract.abi.find(
        (candidate) =>
          candidate.type ===
          (bytes(frame.input).length === 0 ? "receive" : "fallback")
      ) ?? contract.abi.find((candidate) => candidate.type === "fallback");
    const identifier =
      fragment !== undefined ? getFunctionSignature(fragment) : fallback?.type;
    if (identifier !== undefined) {
      sourceReference =
        decoder.decodeContractStart(contract, identifier) ?? sourceReference;
    }
  }

  if (!isFailureOrigin) {
    return {
      type: QrlStackTraceEntryType.CALLSTACK_ENTRY,
      sourceReference:
        decodeLastFailedChildCallsite(frame, decoder) ?? sourceReference,
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
  const executionSourceReference =
    sourceReference !== undefined &&
    decoder.isFunctionStartReference(sourceReference)
      ? decoder.decodeLastMappedStatement(code, orderedSteps, isCreate) ??
        sourceReference
      : sourceReference;
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
        sourceReference: executionSourceReference,
        address: lastChild.target?.toString(),
      };
    }
    return {
      type: QrlStackTraceEntryType.RETURNDATA_SIZE_ERROR,
      sourceReference: executionSourceReference,
    };
  }

  if (
    lastChild !== undefined &&
    isCallSetupFailure(lastChild) &&
    failsImmediatelyAfterChild(frame, orderedSteps, lastChildIndex!, decoder)
  ) {
    return {
      type: QrlStackTraceEntryType.CALL_FAILED_ERROR,
      sourceReference: executionSourceReference,
    };
  }

  if (hasNonContractAccountGuardFailure(frame)) {
    return {
      type: QrlStackTraceEntryType.NONCONTRACT_ACCOUNT_CALLED_ERROR,
      sourceReference: executionSourceReference,
    };
  }

  if (hasFailedCallWithoutSubtrace(frame, decoder)) {
    return {
      type: QrlStackTraceEntryType.CALL_FAILED_ERROR,
      sourceReference: executionSourceReference,
    };
  }

  let revertSourceReference = executionSourceReference;
  if (
    sourceReference !== undefined &&
    decoder.isFunctionStartReference(sourceReference)
  ) {
    const fragment = !isCreate
      ? findCalledFunction(frame, contract)
      : undefined;
    revertSourceReference =
      decoder.decodeLastModifier(code, orderedSteps, isCreate) ??
      (fragment !== undefined
        ? decoder.decodeUnconditionalModifier(
            contract,
            getFunctionSignature(fragment)
          )
        : undefined) ??
      executionSourceReference;
  }

  if (
    lastOpcode(frame) === 0xfd ||
    lastOpcode(frame) === 0xfe ||
    byteLength(frame.returnValue) > 0
  ) {
    return {
      type: QrlStackTraceEntryType.REVERT_ERROR,
      sourceReference: revertSourceReference,
      message: frame.returnValue,
    };
  }

  if (frame.children?.some((child: any) => child.errorMessage !== undefined)) {
    return {
      type: QrlStackTraceEntryType.CALL_FAILED_ERROR,
      sourceReference: executionSourceReference,
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
    if (value > zero && fragment.stateMutability !== "payable") {
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
  const isCreate = frame.kind === "create" || frame.kind === "create2";
  const code = bytesToHex(frame.code ?? (isCreate ? frame.input : undefined));
  const recognized = decoder.identifyContract(code, isCreate) !== undefined;
  let hasOrderedChildren = false;
  for (let index = steps.length - 1; index >= 0; index--) {
    const child = steps[index];
    if (!isFrameStep(child)) {
      continue;
    }
    hasOrderedChildren = true;
    if (
      child.errorMessage !== undefined &&
      !isCallSetupFailure(child) &&
      bytesEqual(child.returnValue, frame.returnValue) &&
      (forwardsReturnDataAfterChild(frame, steps, index) ||
        ((byteLength(child.returnValue) === 0 || !recognized) &&
          failsImmediatelyAfterChild(frame, steps, index, decoder)))
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

function decodeLastFailedChildCallsite(
  frame: any,
  decoder: QrlStackTraceDecoder
): any | undefined {
  const steps = Array.isArray(frame.steps) ? frame.steps : [];
  const code = bytesToHex(frame.code);
  const isCreate = frame.kind === "create" || frame.kind === "create2";
  for (let childIndex = steps.length - 1; childIndex >= 0; childIndex--) {
    const child = steps[childIndex];
    if (!isFrameStep(child) || child.errorMessage === undefined) {
      continue;
    }
    for (let pcIndex = childIndex - 1; pcIndex >= 0; pcIndex--) {
      if (isPcStep(steps[pcIndex])) {
        return decoder.decodeFrame(code, steps[pcIndex].pc, isCreate);
      }
    }
  }
  return undefined;
}

function isCallSetupFailure(frame: any): boolean {
  return (
    byteLength(frame.code) === 0 &&
    typeof frame.errorMessage === "string" &&
    /balance underflow|insufficient funds/i.test(frame.errorMessage)
  );
}

function forwardsReturnDataAfterChild(
  frame: any,
  steps: any[],
  childIndex: number
): boolean {
  const code = bytes(frame.code);
  const after = steps.slice(childIndex + 1);
  let lastCopyIndex = -1;
  for (let index = 0; index < after.length; index++) {
    const step = after[index];
    if (isPcStep(step) && code[step.pc] === 0x3e) {
      lastCopyIndex = index;
    }
  }
  if (lastCopyIndex === -1) {
    return false;
  }
  const tail = after.slice(lastCopyIndex + 1);
  return (
    tail.some((step) => isPcStep(step) && code[step.pc] === 0xfd) &&
    !tail.some(
      (step) =>
        isPcStep(step) &&
        (code[step.pc] === 0x52 ||
          code[step.pc] === 0x53 ||
          isCallOrCreateOpcode(code[step.pc]))
    )
  );
}

function hasNonContractAccountGuardFailure(frame: any): boolean {
  const code = bytes(frame.code);
  const steps = Array.isArray(frame.steps) ? frame.steps : [];
  return (
    (frame.children ?? []).length === 0 &&
    lastOpcode(frame) === 0xfd &&
    steps.some((step: any) => isPcStep(step) && code[step.pc] === 0x3b)
  );
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
