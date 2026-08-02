import { execFile } from "child_process";
import * as fs from "fs";
import fsExtra from "fs-extra";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { HyperionConfig } from "../../types";
import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

import { HyperionCompilerDownloader } from "./compiler-downloader";
import { HyperionInput } from "./compiler-input";
import {
  LocalCompilerIdentity,
  ResolvedHyperionCompiler,
} from "./compiler-types";
import { getCompilerFingerprint, resolveHypcPath } from "./compiler-version";

const execFileAsync = promisify(execFile);

export const HYPERION_COMPILER_REPOSITORY_ENV =
  "HYPERION_COMPILER_REPOSITORY_URL";

const DEFAULT_HYPERION_COMPILER_REPOSITORY_URL: string | undefined = undefined;

export class Compiler {
  private _resolvedCompiler?: Promise<ResolvedHyperionCompiler>;

  constructor(
    private readonly _config: HyperionConfig,
    private readonly _projectRoot: string,
    private readonly _cacheDir: string
  ) {}

  public async compile(input: HyperionInput): Promise<any> {
    const compiler = await this.getCompiler();
    return compileHyperion(input, this._projectRoot, compiler.path);
  }

  public async getCompiler(): Promise<ResolvedHyperionCompiler> {
    if (this._resolvedCompiler === undefined) {
      this._resolvedCompiler = this._resolveCompiler();
    }

    return this._resolvedCompiler;
  }

  private async _resolveCompiler(): Promise<ResolvedHyperionCompiler> {
    const repositoryUrl =
      this._config.compilerRepositoryUrl ??
      process.env[HYPERION_COMPILER_REPOSITORY_ENV] ??
      DEFAULT_HYPERION_COMPILER_REPOSITORY_URL;
    const hasExplicitLocalCompiler =
      this._config.compilerPath !== undefined ||
      process.env.HYPERION_HYPC_PATH !== undefined ||
      process.env.HYPC_PATH !== undefined;

    if (
      this._config.version !== "local" &&
      repositoryUrl !== undefined &&
      !hasExplicitLocalCompiler
    ) {
      const downloader = new HyperionCompilerDownloader(
        repositoryUrl,
        path.join(this._cacheDir, "hyperion-compilers")
      );
      return downloader.resolve(this._config.version);
    }

    const selectedPath = resolveHypcPath(
      this._config.compilerPath,
      this._projectRoot
    );
    const fingerprint = await getCompilerFingerprint(
      selectedPath,
      this._projectRoot
    );
    if (fingerprint === undefined) {
      throw new HardhatError(ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_NOT_FOUND, {
        path: selectedPath,
      });
    }

    const identity: LocalCompilerIdentity = fingerprint;
    return {
      path: fingerprint.resolvedPath,
      source: "local",
      version:
        this._config.version === "local" ? undefined : this._config.version,
      longVersion: fingerprint.longVersion,
      identity,
    };
  }
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
        methodIdentifiers: qrvm.methodIdentifiers ?? {},
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
  immutableReferences: any;
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
    immutableReferences:
      bytecodeOutput !== undefined &&
      bytecodeOutput.immutableReferences !== undefined
        ? bytecodeOutput.immutableReferences
        : {},
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
