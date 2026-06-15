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
    const configuredHypcPath = path.join(this.tmpDir, "configured-hypc");
    const envHypcPath = path.join(this.tmpDir, "env-hypc");
    await writeHypcScript(
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
    await writeHypcScript(
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
    const hypcPath = path.join(this.tmpDir, "hypc");
    await writeHypcScript(hypcPath, "diagnostic { bad");
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
    const hypcPath = path.join(this.tmpDir, "hypc");
    const combinedOutput = JSON.stringify({
      contracts: {
        "contracts/Token.hyp:Token": {
          abi: "{ bad",
          bin: "0x6000",
          "bin-runtime": "0x00",
        },
      },
    });
    await writeHypcScript(hypcPath, combinedOutput);
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
  await fsExtra.writeFile(hypcPath, `#!/bin/sh\nprintf '%s' '${output}'\n`);
  await fsExtra.chmod(hypcPath, 0o755);
}
