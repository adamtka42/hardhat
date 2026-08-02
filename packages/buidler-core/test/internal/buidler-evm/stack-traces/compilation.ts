import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import { loadQrlDebugInfo } from "../../../../src/internal/buidler-evm/stack-traces/compiler-to-model";
import {
  COMPILER_INPUT_FILENAME,
  COMPILER_OUTPUT_FILENAME,
} from "../../../../src/internal/constants";
import { useTmpDir } from "../../../helpers/fs";

describe("QRL stack trace debug info", function () {
  useTmpDir("qrl-stack-trace-debug-info");

  it("loads diagnostic compiler fields and uses the cached version fallback", async function () {
    const ast = {
      nodeType: "SourceUnit",
      nodes: [
        {
          nodeType: "ContractDefinition",
          name: "Probe",
          contractKind: "library",
          src: "0:20:0",
          nodes: [],
        },
      ],
    };
    const contract = {
      abi: [{ type: "fallback", stateMutability: "nonpayable" }],
      methodIdentifiers: { "probe()": "12345678" },
      bytecodeOutput: {
        bytecode: {
          object: "5f00",
          sourceMap: "0:20:0;0:20:0",
          linkReferences: {},
        },
        deployedBytecode: {
          object: "5f00",
          sourceMap: "0:20:0;0:20:0",
          linkReferences: {},
          immutableReferences: { "1": [{ start: 1, length: 1 }] },
        },
      },
    };
    await fsExtra.writeJson(path.join(this.tmpDir, COMPILER_INPUT_FILENAME), {
      sources: { "Probe.hyp": { content: "library Probe {}" } },
    });
    await fsExtra.writeJson(path.join(this.tmpDir, COMPILER_OUTPUT_FILENAME), {
      contracts: { "Probe.hyp": { Probe: contract } },
      sources: { "Probe.hyp": { id: 0, ast } },
    });
    await fsExtra.writeJson(
      path.join(this.tmpDir, "last-compiler-config.json"),
      {
        hyperion: { version: "local" },
        compiler: { longVersion: "0.2.0-test+commit.123" },
      }
    );

    const info = loadQrlDebugInfo(this.tmpDir)!;
    assert.lengthOf(info.contracts, 1);
    assert.deepInclude(info.contracts[0], {
      contractKind: "library",
      compilerVersion: "0.2.0-test+commit.123",
      methodIdentifiers: { "probe()": "12345678" },
      immutableReferences: { "1": [{ start: 1, length: 1 }] },
    });
  });

  it("prefers the per-contract metadata compiler version", async function () {
    await fsExtra.writeJson(path.join(this.tmpDir, COMPILER_INPUT_FILENAME), {
      sources: { "Probe.hyp": { content: "contract Probe {}" } },
    });
    await fsExtra.writeJson(path.join(this.tmpDir, COMPILER_OUTPUT_FILENAME), {
      contracts: {
        "Probe.hyp": {
          Probe: {
            abi: [],
            metadata: JSON.stringify({ compiler: { version: "0.3.0-meta" } }),
            bytecodeOutput: {},
          },
        },
      },
      sources: {},
    });
    await fsExtra.writeJson(
      path.join(this.tmpDir, "last-compiler-config.json"),
      {
        hyperion: { version: "0.2.0-config" },
        compiler: { longVersion: "0.2.0-cache" },
      }
    );

    const info = loadQrlDebugInfo(this.tmpDir)!;
    assert.equal(info.contracts[0].compilerVersion, "0.3.0-meta");
  });
});
