import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import {
  compileHyperion,
  HyperionInput,
} from "../../../src/internal/hyperion/compiler";
import { useTmpDir } from "../../helpers/fs";

describe("Hyperion compiler", function () {
  useTmpDir("hyperion-compiler");

  const previousHypcPath = process.env.HYPERION_HYPC_PATH;
  const previousHypcLegacyPath = process.env.HYPC_PATH;

  afterEach(function () {
    if (previousHypcPath === undefined) {
      delete process.env.HYPERION_HYPC_PATH;
    } else {
      process.env.HYPERION_HYPC_PATH = previousHypcPath;
    }

    if (previousHypcLegacyPath === undefined) {
      delete process.env.HYPC_PATH;
    } else {
      process.env.HYPC_PATH = previousHypcLegacyPath;
    }
  });

  it("uses the configured compiler path", async function () {
    let configuredHypcPath = path.join(this.tmpDir, "configured-hypc");
    let envHypcPath = path.join(this.tmpDir, "env-hypc");
    configuredHypcPath = await writeHypcScript(
      configuredHypcPath,
      JSON.stringify({
        contracts: {
          "contracts/Token.hyp:Token": {
            abi: "[]",
            bin: "0x6000",
            "bin-runtime": "0x00",
          },
        },
      })
    );
    envHypcPath = await writeHypcScript(
      envHypcPath,
      JSON.stringify({
        contracts: {
          "contracts/Token.hyp:Token": {
            abi: "{ bad",
            bin: "0x",
            "bin-runtime": "0x",
          },
        },
      })
    );
    process.env.HYPERION_HYPC_PATH = envHypcPath;

    const output = await compileHyperion(
      createEmptyInput(),
      this.tmpDir,
      configuredHypcPath
    );

    assert.isUndefined(output.errors);
    assert.equal(
      output.contracts["contracts/Token.hyp"].Token.bytecodeOutput.bytecode
        .object,
      "6000"
    );
  });

  it("returns a compiler error for invalid hypc JSON output", async function () {
    let hypcPath = path.join(this.tmpDir, "hypc");
    hypcPath = await writeHypcScript(hypcPath, "diagnostic { bad");
    process.env.HYPERION_HYPC_PATH = hypcPath;

    const output = await compileHyperion(createEmptyInput(), this.tmpDir);

    assert.lengthOf(output.errors, 1);
    assert.equal(output.errors[0].severity, "error");
    assert.include(
      output.errors[0].formattedMessage,
      "hypc returned invalid JSON output"
    );
  });

  it("returns a compiler error for invalid ABI JSON output", async function () {
    let hypcPath = path.join(this.tmpDir, "hypc");
    const combinedOutput = JSON.stringify({
      contracts: {
        "contracts/Token.hyp:Token": {
          abi: "{ bad",
          bin: "0x6000",
          "bin-runtime": "0x00",
        },
      },
    });
    hypcPath = await writeHypcScript(hypcPath, combinedOutput);
    process.env.HYPERION_HYPC_PATH = hypcPath;

    const output = await compileHyperion(createEmptyInput(), this.tmpDir);

    assert.lengthOf(output.errors, 1);
    assert.equal(output.errors[0].severity, "error");
    assert.include(
      output.errors[0].formattedMessage,
      "hypc returned invalid ABI JSON for contracts/Token.hyp:Token"
    );
  });
});

function createEmptyInput(): HyperionInput {
  return {
    language: "Hyperion",
    sourcePaths: [],
    sources: {},
    settings: {
      optimizer: {
        enabled: false,
        runs: 200,
      },
    },
  };
}

async function writeHypcScript(hypcPath: string, output: string) {
  const jsPath = `${hypcPath}.js`;
  await fsExtra.writeFile(
    jsPath,
    `process.stdout.write(${JSON.stringify(output)});\n`
  );

  if (process.platform === "win32") {
    const cmdPath = `${hypcPath}.cmd`;
    await fsExtra.writeFile(
      cmdPath,
      `@echo off\r\nnode "%~dp0${path.basename(jsPath)}"\r\n`
    );
    return cmdPath;
  }

  await fsExtra.writeFile(hypcPath, `#!/bin/sh\nnode "${jsPath}"\n`);
  await fsExtra.chmod(hypcPath, 0o755);
  return hypcPath;
}
