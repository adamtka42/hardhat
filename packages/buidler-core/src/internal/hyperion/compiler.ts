import { execFile } from "child_process";
import * as fs from "fs";
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
  // `import "@theqrl/hardhat/console.hyp";`.
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  if (fs.existsSync(nodeModulesPath)) {
    args.push("--include-path", nodeModulesPath);

    // hypc canonicalizes import paths before checking them against the
    // allowed directories, so packages installed as symlinks (npm link,
    // file: installs) resolve outside the project and get rejected.
    // Explicitly allow the real paths of symlinked packages.
    const symlinkedPackagePaths = collectSymlinkedPackageRealPaths(
      nodeModulesPath
    );
    if (symlinkedPackagePaths.length > 0) {
      args.push("--allow-paths", symlinkedPackagePaths.join(","));
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

function collectSymlinkedPackageRealPaths(nodeModulesPath: string): string[] {
  const realPaths: string[] = [];

  const addIfSymlink = (entryPath: string) => {
    try {
      if (fs.lstatSync(entryPath).isSymbolicLink()) {
        realPaths.push(fs.realpathSync(entryPath));
      }
    } catch {
      // Broken symlinks and unreadable entries are ignored.
    }
  };

  let entries: string[];
  try {
    entries = fs.readdirSync(nodeModulesPath);
  } catch {
    return realPaths;
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
        addIfSymlink(path.join(entryPath, scopedEntry));
      }
    } else {
      addIfSymlink(entryPath);
    }
  }

  return realPaths;
}
