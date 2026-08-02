import { assert } from "chai";

import {
  getInputFromDependencyGraph,
  HyperionInput,
} from "../../../src/internal/hyperion/compiler-input";
import { DependencyGraph } from "../../../src/internal/hyperion/dependencyGraph";
import {
  ResolvedFile,
  Resolver,
} from "../../../src/internal/hyperion/resolver";

describe("Hyperion compiler input", function () {
  it("constructs the standard JSON input from a dependency graph", async function () {
    const optimizer = {
      runs: 200,
      enabled: false,
    };
    const first = new ResolvedFile(
      "the/global/name.hyp",
      "/fake/absolute/path",
      "THE CONTENT1",
      new Date()
    );
    const second = new ResolvedFile(
      "the/global/name2.hyp",
      "/fake/absolute/path2",
      "THE CONTENT2",
      new Date()
    );
    const graph = await DependencyGraph.createFromResolvedFiles(
      new Resolver("."),
      [first, second]
    );

    const input = getInputFromDependencyGraph(graph, optimizer);

    const expected: HyperionInput = {
      language: "Hyperion",
      sources: {
        [first.globalName]: { content: first.content },
        [second.globalName]: { content: second.content },
      },
      settings: {
        optimizer: { enabled: false },
        metadata: { useLiteralContent: true },
        outputSelection: {
          "*": {
            "*": [
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
            ],
            "": ["ast"],
          },
        },
      },
    };

    assert.deepEqual(input, expected);
  });
});
