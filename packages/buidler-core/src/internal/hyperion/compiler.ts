import { execFile } from "child_process";
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
  projectRoot: string
): Promise<any> {
  const hypcPath =
    process.env.HYPERION_HYPC_PATH !== undefined
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
  const combinedOutput = JSON.parse(stdout.slice(jsonStart));
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
    const abi =
      typeof contractOutput.abi === "string"
        ? JSON.parse(contractOutput.abi)
        : contractOutput.abi;

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
