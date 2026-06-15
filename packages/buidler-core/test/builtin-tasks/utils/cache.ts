import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import {
  areArtifactsCached,
  cacheHardhatConfig,
} from "../../../src/builtin-tasks/utils/cache";
import {
  COMPILER_INPUT_FILENAME,
  COMPILER_OUTPUT_FILENAME,
} from "../../../src/internal/constants";
import { HyperionConfig, ProjectPaths } from "../../../src/types";
import { useTmpDir } from "../../helpers/fs";

describe("Compile cache utils", function () {
  useTmpDir("compile-cache-utils");

  let paths: ProjectPaths;

  beforeEach(async function () {
    paths = {
      root: this.tmpDir,
      configFile: path.join(this.tmpDir, "hardhat.config.js"),
      cache: path.join(this.tmpDir, "cache"),
      artifacts: path.join(this.tmpDir, "artifacts"),
      sources: path.join(this.tmpDir, "contracts"),
      tests: path.join(this.tmpDir, "test"),
    };

    await fsExtra.ensureDir(paths.artifacts);
    await fsExtra.ensureDir(paths.cache);
    await fsExtra.writeJson(path.join(paths.cache, COMPILER_INPUT_FILENAME), {
      sources: {},
    });
    await fsExtra.writeJson(path.join(paths.cache, COMPILER_OUTPUT_FILENAME), {
      contracts: {},
    });
  });

  it("reloads the cached Hyperion config after it changes", async function () {
    const firstConfig = createHyperionConfig("/tmp/hypc-a");
    const secondConfig = createHyperionConfig("/tmp/hypc-b");

    await cacheHardhatConfig(paths, firstConfig);
    assert.isTrue(await areArtifactsCached([0], firstConfig, paths));

    await cacheHardhatConfig(paths, secondConfig);

    assert.isTrue(await areArtifactsCached([0], secondConfig, paths));
  });
});

function createHyperionConfig(compilerPath: string): HyperionConfig {
  return {
    version: "local",
    compilerPath,
    optimizer: {
      enabled: false,
      runs: 200,
    },
  };
}
