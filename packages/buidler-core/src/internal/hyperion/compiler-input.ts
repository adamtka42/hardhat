import { HyperionOptimizerConfig } from "../../types";

import { DependencyGraph } from "./dependencyGraph";

// Standard JSON gives access to linkReferences (external library
// placeholders), which the legacy combined-json output does not carry.
// Note the output namespace is `qrvm`, not `evm`.
//
// F10 owns this generic outputSelection/adapter/cache plumbing; features
// needing more compiler output (e.g. F3's `qrvm.methodIdentifiers`)
// register their fields HERE and read them from the cached compiler
// output - no parallel preservation paths.
const HYPERION_OUTPUT_SELECTION = [
  "abi",
  "qrvm.bytecode.object",
  "qrvm.bytecode.linkReferences",
  "qrvm.bytecode.sourceMap",
  "qrvm.deployedBytecode.object",
  "qrvm.deployedBytecode.linkReferences",
  "qrvm.deployedBytecode.sourceMap",
  "qrvm.deployedBytecode.immutableReferences",
  "qrvm.methodIdentifiers",
  "metadata",
];

// The FULL Hyperion standard JSON input: exactly what hypc receives, and
// exactly what lands in cache/compiler-input.json - so a cached input can
// faithfully reproduce its compilation.
export interface HyperionInput {
  language: "Hyperion";
  sources: { [sourceName: string]: { content: string } };
  settings: {
    optimizer: { enabled: boolean; runs?: number };
    metadata: { useLiteralContent: true };
    outputSelection: { "*": { "*": string[]; "": string[] } };
  };
}

export function getInputFromDependencyGraph(
  graph: DependencyGraph,
  optimizer: HyperionOptimizerConfig
): HyperionInput {
  const sources: HyperionInput["sources"] = {};
  for (const file of graph.getResolvedFiles()) {
    sources[file.globalName] = {
      content: file.content,
    };
  }

  return buildHyperionStandardJsonInput(sources, optimizer);
}

/**
 * Builds the complete standard JSON input from the dependency graph's
 * sources. Single construction point: the compile task passes the result
 * UNMODIFIED to `compileHyperion` and to the compiler-input cache.
 */
export function buildHyperionStandardJsonInput(
  sources: HyperionInput["sources"],
  optimizer: HyperionOptimizerConfig
): HyperionInput {
  return {
    language: "Hyperion",
    sources,
    settings: {
      optimizer: optimizer.enabled
        ? { enabled: true, runs: optimizer.runs }
        : { enabled: false },
      // useLiteralContent makes the metadata self-contained and
      // deterministic: sources are embedded verbatim instead of being
      // referenced by URL.
      metadata: { useLiteralContent: true },
      outputSelection: {
        "*": {
          "*": HYPERION_OUTPUT_SELECTION,
          // Per-source AST, used by the stack trace decoder to resolve
          // function names for source locations.
          "": ["ast"],
        },
      },
    },
  };
}
