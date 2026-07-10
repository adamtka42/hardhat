import fsExtra from "fs-extra";
import path from "path";

import {
  COMPILER_INPUT_FILENAME,
  COMPILER_OUTPUT_FILENAME,
} from "../../constants";

export interface QrlContractDebugInfo {
  sourceName: string;
  contractName: string;
  bytecode: string;
  bytecodeSourceMap?: string;
  deployedBytecode: string;
  deployedSourceMap?: string;
  linkReferences: any;
  deployedLinkReferences: any;
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
    for (const sourceName of Object.keys(output.contracts ?? {})) {
      for (const contractName of Object.keys(output.contracts[sourceName])) {
        const contractOutput = output.contracts[sourceName][contractName];
        const bytecodeOutput = contractOutput.bytecodeOutput ?? {};
        contracts.push({
          sourceName,
          contractName,
          bytecode: bytecodeOutput.bytecode?.object ?? "",
          bytecodeSourceMap: bytecodeOutput.bytecode?.sourceMap,
          deployedBytecode: bytecodeOutput.deployedBytecode?.object ?? "",
          deployedSourceMap: bytecodeOutput.deployedBytecode?.sourceMap,
          linkReferences: bytecodeOutput.bytecode?.linkReferences ?? {},
          deployedLinkReferences:
            bytecodeOutput.deployedBytecode?.linkReferences ?? {},
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

      // The compiler input only carries project-local roots; imported
      // sources (node_modules, symlinked packages) were read from disk by
      // hypc. Recover their content the same way so library frames get real
      // line numbers.
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
