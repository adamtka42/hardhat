import fsExtra from "fs-extra";
import path from "path";

import {
  COMPILER_INPUT_FILENAME,
  COMPILER_OUTPUT_FILENAME,
} from "../../constants";

export interface QrlContractDebugInfo {
  sourceName: string;
  contractName: string;
  abi: any[];
  contractKind?: string;
  bytecode: string;
  bytecodeSourceMap?: string;
  deployedBytecode: string;
  deployedSourceMap?: string;
  linkReferences: any;
  deployedLinkReferences: any;
  immutableReferences: any;
  methodIdentifiers: { [signature: string]: string };
  compilerVersion?: string;
}

export interface QrlDebugInfo {
  contracts: QrlContractDebugInfo[];
  /** Source content by sourceName (from the cached compiler input). */
  sourceContent: Map<string, string>;
  /** sourceName by numeric source index (from the cached compiler output). */
  sourceNamesByIndex: Map<number, string>;
  /** Raw per-source ASTs by sourceName. */
  astBySourceName: Map<string, any>;
}

/**
 * Loads the debug information the stack trace decoder needs from the cached
 * compiler input/output JSON files. Returns `undefined` when the cache is
 * missing or unreadable — stack traces then degrade gracefully.
 */
export function loadQrlDebugInfo(
  cachePath: string,
  projectRoot?: string
): QrlDebugInfo | undefined {
  try {
    const output = fsExtra.readJsonSync(
      path.join(cachePath, COMPILER_OUTPUT_FILENAME)
    );
    const input = fsExtra.readJsonSync(
      path.join(cachePath, COMPILER_INPUT_FILENAME)
    );

    const contracts: QrlContractDebugInfo[] = [];
    const fallbackCompilerVersion = readCachedCompilerVersion(cachePath);
    for (const sourceName of Object.keys(output.contracts ?? {})) {
      for (const contractName of Object.keys(output.contracts[sourceName])) {
        const contractOutput = output.contracts[sourceName][contractName];
        const bytecodeOutput = contractOutput.bytecodeOutput ?? {};
        contracts.push({
          sourceName,
          contractName,
          abi: contractOutput.abi ?? [],
          contractKind: findContractKind(
            output.sources?.[sourceName]?.ast,
            contractName
          ),
          bytecode: bytecodeOutput.bytecode?.object ?? "",
          bytecodeSourceMap: bytecodeOutput.bytecode?.sourceMap,
          deployedBytecode: bytecodeOutput.deployedBytecode?.object ?? "",
          deployedSourceMap: bytecodeOutput.deployedBytecode?.sourceMap,
          linkReferences: bytecodeOutput.bytecode?.linkReferences ?? {},
          deployedLinkReferences:
            bytecodeOutput.deployedBytecode?.linkReferences ?? {},
          immutableReferences:
            bytecodeOutput.deployedBytecode?.immutableReferences ?? {},
          methodIdentifiers: contractOutput.methodIdentifiers ?? {},
          compilerVersion:
            readCompilerVersion(contractOutput.metadata) ??
            fallbackCompilerVersion,
        });
      }
    }

    const sourceContent = new Map<string, string>();
    for (const sourceName of Object.keys(input.sources ?? {})) {
      const content = input.sources[sourceName]?.content;
      if (typeof content === "string") {
        sourceContent.set(sourceName, content);
      }
    }

    const sourceNamesByIndex = new Map<number, string>();
    const astBySourceName = new Map<string, any>();
    for (const sourceName of Object.keys(output.sources ?? {})) {
      const source = output.sources[sourceName];
      if (typeof source?.id === "number") {
        sourceNamesByIndex.set(source.id, sourceName);
      }
      if (source?.ast !== undefined) {
        astBySourceName.set(sourceName, source.ast);
      }

      // The compiler input normally carries the FULL dependency graph, but
      // the resolver-failure fallback ships only project-local roots and
      // lets hypc read imports from disk. Recover such content the same way
      // so library frames still get real line numbers.
      if (!sourceContent.has(sourceName) && projectRoot !== undefined) {
        const candidates = [
          path.join(projectRoot, sourceName),
          path.join(projectRoot, "node_modules", sourceName),
        ];
        for (const candidate of candidates) {
          try {
            sourceContent.set(
              sourceName,
              fsExtra.readFileSync(candidate, "utf8")
            );
            break;
          } catch {
            // Try the next candidate; missing content degrades to line 0.
          }
        }
      }
    }

    return { contracts, sourceContent, sourceNamesByIndex, astBySourceName };
  } catch {
    return undefined;
  }
}

function findContractKind(ast: any, contractName: string): string | undefined {
  let kind: string | undefined;
  visitNodes(ast, (node) => {
    if (
      kind === undefined &&
      node.nodeType === "ContractDefinition" &&
      node.name === contractName &&
      typeof node.contractKind === "string"
    ) {
      kind = node.contractKind;
    }
  });
  return kind;
}

function visitNodes(node: any, visit: (node: any) => void): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      visitNodes(child, visit);
    }
    return;
  }
  visit(node);
  for (const child of Object.values(node)) {
    visitNodes(child, visit);
  }
}

function readCachedCompilerVersion(cachePath: string): string | undefined {
  try {
    const config = fsExtra.readJsonSync(
      path.join(cachePath, "last-compiler-config.json")
    );
    if (typeof config?.compiler?.longVersion === "string") {
      return config.compiler.longVersion;
    }
    const configured = config?.hyperion?.version;
    return typeof configured === "string" && configured !== "local"
      ? configured
      : undefined;
  } catch {
    return undefined;
  }
}

function readCompilerVersion(metadata: unknown): string | undefined {
  if (typeof metadata !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed?.compiler?.version === "string"
      ? parsed.compiler.version
      : undefined;
  } catch {
    return undefined;
  }
}
