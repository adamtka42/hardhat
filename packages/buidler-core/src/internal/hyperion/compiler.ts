import { execFile } from "child_process";
import * as fs from "fs";
import fsExtra from "fs-extra";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { HyperionOptimizerConfig } from "../../types";

import { resolveHypcPath } from "./compiler-version";

const execFileAsync = promisify(execFile);

// Standard JSON gives access to linkReferences (external library
// placeholders), which the legacy combined-json output does not carry.
// Note the output namespace is `qrvm`, not `evm`.
//
// F10 owns this generic outputSelection/adapter/cache plumbing; features
// needing more compiler output (e.g. F3's `qrvm.methodIdentifiers`)
// register their fields HERE and read them from the cached compiler
// output — no parallel preservation paths.
const HYPERION_OUTPUT_SELECTION = [
  "abi",
  "qrvm.bytecode.object",
  "qrvm.bytecode.linkReferences",
  "qrvm.bytecode.sourceMap",
  "qrvm.deployedBytecode.object",
  "qrvm.deployedBytecode.linkReferences",
  "qrvm.deployedBytecode.sourceMap",
  // Deterministic compilation metadata (embeds literal sources); the
  // foundation for reproducible builds and future source verification.
  "metadata",
];

// The FULL Hyperion standard JSON input: exactly what hypc receives, and
// exactly what lands in cache/compiler-input.json — so a cached input can
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

export async function compileHyperion(
  input: HyperionInput,
  projectRoot: string,
  compilerPath?: string
): Promise<any> {
  const hypcPath = resolveHypcPath(compilerPath, projectRoot);
  // The input IS the standard JSON — passed through verbatim.
  const standardJsonInput = input;

  // The input is passed through a temporary file instead of stdin so the
  // exec call stays a simple argv invocation on every platform.
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardhat-hypc-in-"));
  const inputFile = path.join(inputDir, "input.json");
  fs.writeFileSync(inputFile, JSON.stringify(standardJsonInput));

  const args = ["--standard-json", inputFile, "--base-path", projectRoot];

  // Allow library imports from installed packages, e.g.
  // `import "@theqrl/hardhat/console.hyp";`. hypc reports ambiguous imports
  // if the same package exists under both base-path and include-path, so expose
  // a filtered temporary include root instead of the whole node_modules tree.
  const nodeModulesInclude = prepareNodeModulesIncludePath(projectRoot);
  if (nodeModulesInclude !== undefined) {
    args.push("--include-path", nodeModulesInclude.path);

    // hypc canonicalizes import paths before checking them against the
    // allowed directories, so packages installed as symlinks (npm link,
    // file: installs) resolve outside the project and get rejected.
    // Explicitly allow the real paths of symlinked packages.
    if (nodeModulesInclude.allowPaths.length > 0) {
      args.push("--allow-paths", nodeModulesInclude.allowPaths.join(","));
    }
  }

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(hypcPath, args, {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024 * 50,
      shell: process.platform === "win32",
    });
    stdout = result.stdout.toString();
    stderr = result.stderr.toString();
  } catch (error) {
    const anyError = error as any;
    const output = [anyError.stdout, anyError.stderr, anyError.message]
      .filter((part) => part !== undefined && part !== "")
      .join("\n");

    return {
      errors: [
        {
          severity: "error",
          formattedMessage: output,
        },
      ],
    };
  } finally {
    nodeModulesInclude?.cleanup();
    fsExtra.removeSync(inputDir);
  }

  return adaptStandardJsonOutput(stdout, stderr);
}

function adaptStandardJsonOutput(stdout: string, stderr: string): any {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    const message =
      stdout !== ""
        ? stdout
        : stderr !== ""
        ? stderr
        : "hypc did not return JSON output";

    return {
      errors: [
        {
          severity: "error",
          formattedMessage: message,
        },
      ],
    };
  }

  const compilerMessages = stdout.slice(0, jsonStart).trim();
  let standardOutput: any;
  try {
    standardOutput = JSON.parse(stdout.slice(jsonStart));
  } catch (error) {
    return {
      errors: [
        {
          severity: "error",
          formattedMessage: `hypc returned invalid JSON output: ${
            (error as Error).message
          }`,
        },
      ],
    };
  }
  const output: any = {
    contracts: {},
    // Per-source ASTs (and source ids), kept in the cached compiler output
    // for the stack trace decoder.
    sources: standardOutput.sources !== undefined ? standardOutput.sources : {},
  };

  const contracts =
    standardOutput.contracts !== undefined ? standardOutput.contracts : {};

  for (const sourceName of Object.keys(contracts)) {
    for (const contractName of Object.keys(contracts[sourceName])) {
      const contractOutput = contracts[sourceName][contractName];
      const qrvm = contractOutput.qrvm !== undefined ? contractOutput.qrvm : {};

      if (output.contracts[sourceName] === undefined) {
        output.contracts[sourceName] = {};
      }

      output.contracts[sourceName][contractName] = {
        abi: contractOutput.abi !== undefined ? contractOutput.abi : [],
        metadata: contractOutput.metadata,
        bytecodeOutput: {
          bytecode: adaptBytecodeOutput(qrvm.bytecode),
          deployedBytecode: adaptBytecodeOutput(qrvm.deployedBytecode),
        },
      };
    }
  }

  // Standard JSON reports compiler diagnostics in its own errors array; the
  // compile task consumes their severity and formattedMessage directly.
  output.errors = Array.isArray(standardOutput.errors)
    ? [...standardOutput.errors]
    : [];

  const extraMessages = [compilerMessages, stderr].filter((msg) => msg !== "");
  output.errors.push(
    ...extraMessages.map((msg) => ({
      severity: "warning",
      formattedMessage: msg,
    }))
  );

  if (output.errors.length === 0) {
    delete output.errors;
  }

  return output;
}

function adaptBytecodeOutput(
  bytecodeOutput: any
): {
  object: string;
  linkReferences: any;
  sourceMap?: string;
} {
  return {
    object: stripHexPrefix(
      bytecodeOutput !== undefined && bytecodeOutput.object !== undefined
        ? bytecodeOutput.object
        : ""
    ),
    linkReferences:
      bytecodeOutput !== undefined &&
      bytecodeOutput.linkReferences !== undefined
        ? bytecodeOutput.linkReferences
        : {},
    sourceMap:
      bytecodeOutput !== undefined ? bytecodeOutput.sourceMap : undefined,
  };
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

interface NodeModulesIncludePath {
  path: string;
  allowPaths: string[];
  cleanup: () => void;
}

function prepareNodeModulesIncludePath(
  projectRoot: string
): NodeModulesIncludePath | undefined {
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    return undefined;
  }

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "hardhat-hypc-includes-")
  );
  const allowPaths: string[] = [];
  let linkedPackages = 0;

  const cleanup = () => {
    fsExtra.removeSync(tempRoot);
  };

  const linkPackage = (packageName: string, packagePath: string) => {
    if (fs.existsSync(path.join(projectRoot, packageName))) {
      return;
    }

    const linkPath = path.join(tempRoot, packageName);
    fsExtra.ensureDirSync(path.dirname(linkPath));
    fs.symlinkSync(packagePath, linkPath, "dir");
    linkedPackages++;

    try {
      if (fs.lstatSync(packagePath).isSymbolicLink()) {
        allowPaths.push(fs.realpathSync(packagePath));
      }
    } catch {
      // Broken symlinks and unreadable entries are ignored.
    }
  };

  let entries: string[];
  try {
    entries = fs.readdirSync(nodeModulesPath);
  } catch {
    cleanup();
    return undefined;
  }

  for (const entry of entries) {
    const entryPath = path.join(nodeModulesPath, entry);

    if (entry.startsWith("@")) {
      let scopedEntries: string[];
      try {
        scopedEntries = fs.readdirSync(entryPath);
      } catch {
        continue;
      }
      for (const scopedEntry of scopedEntries) {
        linkPackage(
          path.join(entry, scopedEntry),
          path.join(entryPath, scopedEntry)
        );
      }
    } else {
      linkPackage(entry, entryPath);
    }
  }

  if (linkedPackages === 0) {
    cleanup();
    return undefined;
  }

  return {
    path: tempRoot,
    allowPaths,
    cleanup,
  };
}
