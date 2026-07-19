import { QrlContractDebugInfo, QrlDebugInfo } from "./debug-info";
import {
  buildQrlPcToInstruction,
  decodeQrlSourceMap,
  offsetToLine,
  QrlSourceLocation,
} from "./source-maps";

export interface QrlStackTraceEntry {
  contractName: string;
  functionName: string;
  sourceName: string;
  line: number;
}

export interface QrlResolvedSourceLocation {
  sourceName: string;
  offset: number;
  length: number;
  jumpType: string;
}

interface PreparedContract {
  info: QrlContractDebugInfo;
  deployedNormalized: string;
  bytecodeNormalized: string;
  deployedLocations?: QrlSourceLocation[];
  bytecodeLocations?: QrlSourceLocation[];
  deployedPcMap?: number[];
  bytecodePcMap?: number[];
  deployedRanges: CodeRange[];
  bytecodeRanges: CodeRange[];
}

interface CodeRange {
  start: number;
  length: number;
}

const PLACEHOLDER_PATTERN = /__\$[0-9a-f]{122}\$__/g;
const PLACEHOLDER_FILLER = "0".repeat(128);

/**
 * Resolves execution frames to Hyperion source locations: identifies the
 * contract by its (placeholder-normalized) code, maps the frame's pc through
 * the instruction source map, and finds the enclosing function in the AST.
 */
export class QrlStackTraceDecoder {
  private readonly _prepared: PreparedContract[];

  constructor(private readonly _debugInfo: QrlDebugInfo) {
    this._prepared = _debugInfo.contracts.map((info) => {
      const deployedRanges = [
        ...linkReferenceRanges(info.deployedLinkReferences),
        ...immutableReferenceRanges(info.immutableReferences),
      ];
      const bytecodeRanges = linkReferenceRanges(info.linkReferences);
      return {
        info,
        deployedRanges,
        bytecodeRanges,
        deployedNormalized: normalizeCode(
          info.deployedBytecode,
          deployedRanges
        ),
        bytecodeNormalized: normalizeCode(info.bytecode, bytecodeRanges),
      };
    });
  }

  /**
   * Decodes one frame into a stack trace entry. `code` is the code that
   * executed in the frame (deployed code for calls, init code for creates);
   * `pc` is the frame's failure point.
   */
  public identifyContract(
    code: string,
    isCreate: boolean
  ): QrlContractDebugInfo | undefined {
    return this._identify(code, isCreate)?.info;
  }

  public decodeFrame(
    code: string,
    pc: number,
    isCreate: boolean
  ): QrlStackTraceEntry | undefined {
    const contract = this._identify(code, isCreate);
    if (contract === undefined) {
      return undefined;
    }

    const locations = this._locationsFor(contract, isCreate);
    const pcMap = this._pcMapFor(contract, isCreate);
    if (locations === undefined || pcMap === undefined) {
      return undefined;
    }

    const instruction = pcMap[pc];
    if (instruction === undefined || instruction < 0) {
      return undefined;
    }
    const location = locations[instruction];
    if (location === undefined || location.sourceIndex < 0) {
      return undefined;
    }

    const sourceName = this._debugInfo.sourceNamesByIndex.get(
      location.sourceIndex
    );
    if (sourceName === undefined) {
      return undefined;
    }

    const content = this._debugInfo.sourceContent.get(sourceName);
    const line =
      content === undefined ? 0 : offsetToLine(content, location.offset);

    const functionName =
      this._findFunctionName(sourceName, location.offset) ??
      (isCreate ? "constructor" : "<unknown>");

    return {
      contractName: contract.info.contractName,
      functionName,
      sourceName,
      line,
    };
  }

  public getSourceLocation(
    code: string,
    pc: number,
    isCreate: boolean
  ): QrlResolvedSourceLocation | undefined {
    const contract = this._identify(code, isCreate);
    if (contract === undefined) {
      return undefined;
    }
    const locations = this._locationsFor(contract, isCreate);
    const pcMap = this._pcMapFor(contract, isCreate);
    if (locations === undefined || pcMap === undefined) {
      return undefined;
    }
    const instruction = pcMap[pc];
    const location =
      instruction === undefined ? undefined : locations[instruction];
    if (location === undefined || location.sourceIndex < 0) {
      return undefined;
    }
    const sourceName = this._debugInfo.sourceNamesByIndex.get(
      location.sourceIndex
    );
    return sourceName === undefined
      ? undefined
      : {
          sourceName,
          offset: location.offset,
          length: location.length,
          jumpType: location.jumpType,
        };
  }

  public decodeContractStart(
    contract: QrlContractDebugInfo,
    functionIdentifier?: string
  ): QrlStackTraceEntry | undefined {
    const ast = this._debugInfo.astBySourceName.get(contract.sourceName);
    const content = this._debugInfo.sourceContent.get(contract.sourceName);
    let contractNode: any;
    visitAstNodes(ast, (node) => {
      if (
        contractNode === undefined &&
        node.nodeType === "ContractDefinition" &&
        node.name === contract.contractName
      ) {
        contractNode = node;
      }
    });
    if (contractNode === undefined) {
      return undefined;
    }

    let selected = contractNode;
    if (functionIdentifier !== undefined) {
      const normalized =
        functionIdentifier === "<fallback>" ? "fallback" : functionIdentifier;
      const functionName = identifierFunctionName(normalized);
      const candidates = (contractNode.nodes ?? []).filter((node: any) => {
        if (node.nodeType !== "FunctionDefinition") {
          return false;
        }
        if (
          functionName === "constructor" ||
          functionName === "fallback" ||
          functionName === "receive"
        ) {
          return node.kind === functionName;
        }
        return node.name === functionName;
      });
      const candidate =
        candidates.find(
          (node: any) => functionNodeSignature(node) === normalized
        ) ?? candidates[0];
      if (candidate !== undefined) {
        selected = candidate;
      }
    }

    const location = parseSrc(selected.src);
    if (location === undefined) {
      return undefined;
    }
    return {
      contractName: contract.contractName,
      functionName:
        functionIdentifier === undefined
          ? "<unknown>"
          : identifierFunctionName(functionIdentifier),
      sourceName: contract.sourceName,
      line: content === undefined ? 0 : offsetToLine(content, location.offset),
    };
  }

  private _identify(
    code: string,
    isCreate: boolean
  ): PreparedContract | undefined {
    const stripped = stripHexPrefix(code).toLowerCase();
    if (stripped === "") {
      return undefined;
    }

    let match: PreparedContract | undefined;
    for (const candidate of this._prepared) {
      const reference = isCreate
        ? candidate.bytecodeNormalized
        : candidate.deployedNormalized;
      if (reference === "") {
        continue;
      }
      const normalized = normalizeAgainst(
        stripped,
        isCreate ? candidate.bytecodeRanges : candidate.deployedRanges
      );
      const matches = isCreate
        ? normalized.startsWith(reference)
        : normalized === reference;
      if (matches) {
        // Keep the last match, matching the baseline collision policy.
        match = candidate;
      }
    }

    return match;
  }

  private _locationsFor(
    contract: PreparedContract,
    isCreate: boolean
  ): QrlSourceLocation[] | undefined {
    if (isCreate) {
      if (
        contract.bytecodeLocations === undefined &&
        contract.info.bytecodeSourceMap !== undefined
      ) {
        contract.bytecodeLocations = decodeQrlSourceMap(
          contract.info.bytecodeSourceMap
        );
      }
      return contract.bytecodeLocations;
    }
    if (
      contract.deployedLocations === undefined &&
      contract.info.deployedSourceMap !== undefined
    ) {
      contract.deployedLocations = decodeQrlSourceMap(
        contract.info.deployedSourceMap
      );
    }
    return contract.deployedLocations;
  }

  private _pcMapFor(
    contract: PreparedContract,
    isCreate: boolean
  ): number[] | undefined {
    if (isCreate) {
      if (contract.bytecodePcMap === undefined) {
        contract.bytecodePcMap = buildQrlPcToInstruction(
          hexToBytes(contract.info.bytecode)
        );
      }
      return contract.bytecodePcMap;
    }
    if (contract.deployedPcMap === undefined) {
      contract.deployedPcMap = buildQrlPcToInstruction(
        hexToBytes(contract.info.deployedBytecode)
      );
    }
    return contract.deployedPcMap;
  }

  private _findFunctionName(
    sourceName: string,
    offset: number
  ): string | undefined {
    const ast = this._debugInfo.astBySourceName.get(sourceName);
    if (ast === undefined) {
      return undefined;
    }

    let best: { name: string; length: number } | undefined;
    visitAstNodes(ast, (node) => {
      if (node.nodeType !== "FunctionDefinition") {
        return;
      }
      const src = parseSrc(node.src);
      if (src === undefined) {
        return;
      }
      if (offset < src.offset || offset >= src.offset + src.length) {
        return;
      }
      if (best === undefined || src.length < best.length) {
        const name =
          node.kind === "constructor"
            ? "constructor"
            : node.kind === "fallback"
            ? "fallback"
            : node.kind === "receive"
            ? "receive"
            : node.name;
        if (typeof name === "string" && name !== "") {
          best = { name, length: src.length };
        }
      }
    });

    return best?.name;
  }
}

function identifierFunctionName(identifier: string): string {
  const open = identifier.indexOf("(");
  return open === -1 ? identifier : identifier.slice(0, open);
}

function functionNodeSignature(node: any): string | undefined {
  if (typeof node.name !== "string" || node.name === "") {
    return undefined;
  }
  const parameters = node.parameters?.parameters;
  if (!Array.isArray(parameters)) {
    return undefined;
  }
  const types: string[] = [];
  for (const parameter of parameters) {
    const type = canonicalAstParameterType(parameter);
    if (type === undefined) {
      return undefined;
    }
    types.push(type);
  }
  return [node.name, "(", types.join(","), ")"].join("");
}

function canonicalAstParameterType(parameter: any): string | undefined {
  const typeString = parameter?.typeDescriptions?.typeString;
  if (typeof typeString !== "string") {
    return undefined;
  }
  return typeString
    .replace(/\s+(memory|calldata|storage)(\s+ref)?/g, "")
    .replace(/^contract\s+[^\[]+/, "address")
    .replace(/\s+/g, "");
}

function linkReferenceRanges(linkReferences: any): CodeRange[] {
  const ranges: CodeRange[] = [];
  for (const sourceName of Object.keys(linkReferences ?? {})) {
    for (const libraryName of Object.keys(linkReferences[sourceName])) {
      for (const position of linkReferences[sourceName][libraryName]) {
        ranges.push({ start: position.start, length: position.length ?? 64 });
      }
    }
  }
  return ranges;
}

// Hyperion currently emits length 32 for immutable PUSH64 operands. Accept
// that legacy metadata as a 64-byte QRL word while preserving explicit
// non-legacy lengths for forward compatibility.
function immutableReferenceRanges(immutableReferences: any): CodeRange[] {
  const ranges: CodeRange[] = [];
  for (const references of Object.values<any>(immutableReferences ?? {})) {
    for (const reference of references) {
      ranges.push({
        start: reference.start,
        length: reference.length === 32 ? 64 : reference.length,
      });
    }
  }
  return ranges;
}

/** Zeroes compiler-patched regions so compiled and executed code compare equal. */
function normalizeCode(code: string, ranges: CodeRange[]): string {
  let normalized = stripHexPrefix(code)
    .toLowerCase()
    .replace(PLACEHOLDER_PATTERN, PLACEHOLDER_FILLER);
  for (const range of ranges) {
    const from = range.start * 2;
    const length = range.length * 2;
    normalized =
      normalized.slice(0, from) +
      "0".repeat(length) +
      normalized.slice(from + length);
  }
  return normalized;
}

/** Zeroes compiler-patched regions inside executed code before comparing. */
function normalizeAgainst(code: string, ranges: CodeRange[]): string {
  let normalized = code;
  for (const range of ranges) {
    const from = range.start * 2;
    const length = range.length * 2;
    if (from + length > normalized.length) {
      continue;
    }
    normalized =
      normalized.slice(0, from) +
      "0".repeat(length) +
      normalized.slice(from + length);
  }
  return normalized;
}

function visitAstNodes(node: any, visit: (node: any) => void): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      visitAstNodes(child, visit);
    }
    return;
  }
  if (typeof node.nodeType === "string") {
    visit(node);
  }
  for (const key of Object.keys(node)) {
    visitAstNodes(node[key], visit);
  }
}

function parseSrc(
  src: unknown
): { offset: number; length: number } | undefined {
  if (typeof src !== "string") {
    return undefined;
  }
  const [offset, length] = src.split(":").map((part) => parseInt(part, 10));
  if (Number.isNaN(offset) || Number.isNaN(length)) {
    return undefined;
  }
  return { offset, length };
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

function hexToBytes(value: string): Uint8Array {
  const stripped = stripHexPrefix(value);
  const bytes = new Uint8Array(stripped.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(stripped.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
