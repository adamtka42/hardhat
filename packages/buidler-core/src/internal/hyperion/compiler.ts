import { execFile } from "child_process";
import * as fs from "fs";
import fsExtra from "fs-extra";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { HyperionOptimizerConfig } from "../../types";

const execFileAsync = promisify(execFile);

const HYPERION_OUTPUTS = "abi,bin,bin-runtime";

export interface HyperionInput {
  language: "Hyperion";
  sourcePaths: string[];
  sources: { [sourceName: string]: { content: string } };
  settings: {
    optimizer: HyperionOptimizerConfig;
  };
}

export async function compileHyperion(
  input: HyperionInput,
  projectRoot: string,
  compilerPath?: string
): Promise<any> {
  const hypcPath =
    compilerPath !== undefined
      ? compilerPath
      : process.env.HYPERION_HYPC_PATH !== undefined
      ? process.env.HYPERION_HYPC_PATH
      : process.env.HYPC_PATH !== undefined
      ? process.env.HYPC_PATH
      : "hypc";
  const args = [
    "--combined-json",
    HYPERION_OUTPUTS,
    "--base-path",
    projectRoot,
  ];

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

  if (input.settings.optimizer.enabled) {
    args.push(
      "--optimize",
      "--optimize-runs",
      `${input.settings.optimizer.runs}`
    );
  }

  args.push(...input.sourcePaths);

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
  }

  return adaptCombinedJsonOutput(stdout, stderr);
}

function adaptCombinedJsonOutput(stdout: string, stderr: string): any {
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
  let combinedOutput: any;
  try {
    combinedOutput = JSON.parse(stdout.slice(jsonStart));
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
  };

  const contracts =
    combinedOutput.contracts !== undefined ? combinedOutput.contracts : {};

  for (const fullName of Object.keys(contracts)) {
    const separator = fullName.lastIndexOf(":");
    const sourceName =
      separator === -1 ? fullName : fullName.slice(0, separator);
    const contractName =
      separator === -1 ? fullName : fullName.slice(separator + 1);
    const contractOutput = contracts[fullName];
    let abi: any;
    try {
      abi =
        typeof contractOutput.abi === "string"
          ? JSON.parse(contractOutput.abi)
          : contractOutput.abi;
    } catch (error) {
      return {
        errors: [
          {
            severity: "error",
            formattedMessage: `hypc returned invalid ABI JSON for ${fullName}: ${
              (error as Error).message
            }`,
          },
        ],
      };
    }

    if (output.contracts[sourceName] === undefined) {
      output.contracts[sourceName] = {};
    }

    output.contracts[sourceName][contractName] = {
      abi,
      bytecodeOutput: {
        bytecode: {
          object: stripHexPrefix(
            contractOutput.bin !== undefined ? contractOutput.bin : ""
          ),
          linkReferences: {},
        },
        deployedBytecode: {
          object: stripHexPrefix(
            contractOutput["bin-runtime"] !== undefined
              ? contractOutput["bin-runtime"]
              : ""
          ),
          linkReferences: {},
        },
      },
    };
  }

  const warnings = [compilerMessages, stderr].filter((msg) => msg !== "");
  if (warnings.length > 0) {
    output.errors = warnings.map((msg) => ({
      severity: "warning",
      formattedMessage: msg,
    }));
  }

  return output;
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
