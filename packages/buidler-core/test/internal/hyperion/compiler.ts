import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import {
  buildHyperionStandardJsonInput,
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
      JSON.stringify(createStandardJsonOutput({ bytecodeObject: "0x6000" }))
    );
    envHypcPath = await writeHypcScript(
      envHypcPath,
      JSON.stringify(createStandardJsonOutput({ bytecodeObject: "0xbad" }))
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

  it("uses a filtered node_modules include path", async function () {
    const argsPath = path.join(this.tmpDir, "hypc-args.json");
    let hypcPath = path.join(this.tmpDir, "hypc-args");
    hypcPath = await writeHypcArgsScript(
      hypcPath,
      argsPath,
      JSON.stringify({ contracts: {} })
    );

    await fsExtra.ensureDir(
      path.join(this.tmpDir, "node_modules", "@theqrl", "hardhat")
    );
    await fsExtra.ensureDir(
      path.join(this.tmpDir, "node_modules", "@theqrl", "qrl-contracts")
    );
    await fsExtra.ensureDir(path.join(this.tmpDir, "@theqrl", "qrl-contracts"));

    const output = await compileHyperion(
      createEmptyInput(),
      this.tmpDir,
      hypcPath
    );

    assert.isUndefined(output.errors);

    const captured: CapturedHypcArgs = JSON.parse(
      await fsExtra.readFile(argsPath, "utf8")
    );
    const includePathIndex = captured.args.indexOf("--include-path");
    assert.isAtLeast(includePathIndex, 0);
    assert.notEqual(
      captured.args[includePathIndex + 1],
      path.join(this.tmpDir, "node_modules")
    );
    assert.isTrue(captured.hasHardhatPackage);
    assert.isFalse(captured.hasDuplicateQrlContractsPackage);
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

  it("passes through standard JSON compiler errors", async function () {
    let hypcPath = path.join(this.tmpDir, "hypc");
    const standardOutput = createStandardJsonOutput({
      bytecodeObject: "0x6000",
    });
    standardOutput.errors = [
      {
        severity: "error",
        type: "TypeError",
        message: "Bad thing happened",
        formattedMessage: "TypeError: Bad thing happened",
      },
    ];
    hypcPath = await writeHypcScript(hypcPath, JSON.stringify(standardOutput));
    process.env.HYPERION_HYPC_PATH = hypcPath;

    const output = await compileHyperion(createEmptyInput(), this.tmpDir);

    assert.lengthOf(output.errors, 1);
    assert.equal(output.errors[0].severity, "error");
    assert.equal(output.errors[0].type, "TypeError");
    assert.equal(
      output.errors[0].formattedMessage,
      "TypeError: Bad thing happened"
    );
  });

  it("preserves link references from the compiler output", async function () {
    let hypcPath = path.join(this.tmpDir, "hypc");
    const linkReferences = {
      "contracts/MathLib.hyp": {
        MathLib: [{ start: 128, length: 64 }],
      },
    };
    const standardOutput = createStandardJsonOutput({
      bytecodeObject: "0x6000",
      linkReferences,
    });
    hypcPath = await writeHypcScript(hypcPath, JSON.stringify(standardOutput));
    process.env.HYPERION_HYPC_PATH = hypcPath;

    const output = await compileHyperion(createEmptyInput(), this.tmpDir);

    assert.isUndefined(output.errors);
    const bytecodeOutput =
      output.contracts["contracts/Token.hyp"].Token.bytecodeOutput;
    assert.deepEqual(bytecodeOutput.bytecode.linkReferences, linkReferences);
    assert.deepEqual(
      bytecodeOutput.deployedBytecode.linkReferences,
      linkReferences
    );
  });
});

interface CapturedHypcArgs {
  args: string[];
  hasHardhatPackage: boolean;
  hasDuplicateQrlContractsPackage: boolean;
}

function createStandardJsonOutput(options: {
  bytecodeObject: string;
  linkReferences?: any;
}): any {
  const linkReferences =
    options.linkReferences !== undefined ? options.linkReferences : {};

  return {
    contracts: {
      "contracts/Token.hyp": {
        Token: {
          abi: [],
          qrvm: {
            bytecode: {
              object: options.bytecodeObject,
              linkReferences,
            },
            deployedBytecode: {
              object: "0x00",
              linkReferences,
            },
          },
        },
      },
    },
  };
}

function createEmptyInput(): HyperionInput {
  return buildHyperionStandardJsonInput(
    {},
    {
      enabled: false,
      runs: 200,
    }
  );
}

async function writeHypcArgsScript(
  hypcPath: string,
  argsPath: string,
  output: string
) {
  const jsPath = `${hypcPath}.js`;
  await fsExtra.writeFile(
    jsPath,
    `const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const includePathIndex = args.indexOf("--include-path");
const includePath = includePathIndex === -1 ? undefined : args[includePathIndex + 1];
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify({
  args,
  hasHardhatPackage: includePath !== undefined && fs.existsSync(path.join(includePath, "@theqrl", "hardhat")),
  hasDuplicateQrlContractsPackage: includePath !== undefined && fs.existsSync(path.join(includePath, "@theqrl", "qrl-contracts")),
}));
process.stdout.write(${JSON.stringify(output)});
`
  );

  if (process.platform === "win32") {
    const cmdPath = `${hypcPath}.cmd`;
    await fsExtra.writeFile(
      cmdPath,
      `@echo off
node "%~dp0${path.basename(jsPath)}" %*
`
    );
    return cmdPath;
  }

  await fsExtra.writeFile(
    hypcPath,
    `#!/bin/sh
node "${jsPath}" "$@"
`
  );
  await fsExtra.chmod(hypcPath, 0o755);
  return hypcPath;
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
