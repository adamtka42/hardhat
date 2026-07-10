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

interface PreparedContract {
  info: QrlContractDebugInfo;
  deployedNormalized: string;
  bytecodeNormalized: string;
  deployedLocations?: QrlSourceLocation[];
  bytecodeLocations?: QrlSourceLocation[];
  deployedPcMap?: number[];
  bytecodePcMap?: number[];
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
    this._prepared = _debugInfo.contracts.map((info) => ({
      info,
      deployedNormalized: normalizeCode(info.deployedBytecode, [
        ...linkReferencePositions(info.deployedLinkReferences),
      ]),
      bytecodeNormalized: normalizeCode(info.bytecode, [
        ...linkReferencePositions(info.linkReferences),
      ]),
    }));
  }

  /**
   * Decodes one frame into a stack trace entry. `code` is the code that
   * executed in the frame (deployed code for calls, init code for creates);
   * `pc` is the frame's failure point.
   */
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

  private _identify(
    code: string,
    isCreate: boolean
  ): PreparedContract | undefined {
    const stripped = stripHexPrefix(code).toLowerCase();
    if (stripped === "") {
      return undefined;
    }

    for (const candidate of this._prepared) {
      const reference = isCreate
        ? candidate.bytecodeNormalized
        : candidate.deployedNormalized;
      if (reference === "") {
        continue;
      }
      // Init code carries appended constructor arguments, so match creates
      // by prefix; deployed code must match exactly.
      const normalized = normalizeAgainst(stripped, reference);
      const matches = isCreate
        ? normalized.startsWith(reference)
        : normalized === reference;
      if (matches) {
        return candidate;
      }
    }

    return undefined;
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

function linkReferencePositions(linkReferences: any): number[] {
  const positions: number[] = [];
  for (const sourceName of Object.keys(linkReferences ?? {})) {
    for (const libraryName of Object.keys(linkReferences[sourceName])) {
      for (const position of linkReferences[sourceName][libraryName]) {
        positions.push(position.start);
      }
    }
  }
  return positions;
}

/**
 * Zeroes both the `__$...$__` placeholders and the link-reference regions so
 * artifact code and on-chain (linked) code compare equal.
 */
function normalizeCode(code: string, linkPositions: number[]): string {
  let normalized = stripHexPrefix(code)
    .toLowerCase()
    .replace(PLACEHOLDER_PATTERN, PLACEHOLDER_FILLER);
  for (const start of linkPositions) {
    const from = start * 2;
    normalized =
      normalized.slice(0, from) +
      PLACEHOLDER_FILLER +
      normalized.slice(from + 128);
  }
  return normalized;
}

/** Zeroes the reference's link regions inside on-chain code before comparing. */
function normalizeAgainst(code: string, reference: string): string {
  let normalized = code;
  let searchFrom = 0;
  while (true) {
    const zeroRun = reference.indexOf(PLACEHOLDER_FILLER, searchFrom);
    if (zeroRun === -1 || zeroRun + 128 > normalized.length) {
      break;
    }
    normalized =
      normalized.slice(0, zeroRun) +
      PLACEHOLDER_FILLER +
      normalized.slice(zeroRun + 128);
    searchFrom = zeroRun + 128;
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
