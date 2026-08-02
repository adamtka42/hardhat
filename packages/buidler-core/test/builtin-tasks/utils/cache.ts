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
import { CompilerFingerprint } from "../../../src/internal/hyperion/compiler-version";
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
    const fingerprint = createFingerprint("/tmp/hypc-a");

    await cacheHardhatConfig(paths, firstConfig, fingerprint);
    assert.isTrue(
      await areArtifactsCached([0], firstConfig, paths, fingerprint)
    );

    await cacheHardhatConfig(paths, secondConfig, fingerprint);

    assert.isTrue(
      await areArtifactsCached([0], secondConfig, paths, fingerprint)
    );
  });

  it("never reports a cache hit without a compiler fingerprint", async function () {
    const config = createHyperionConfig("/tmp/hypc-a");

    // A legacy cache has no stored fingerprint; an unresolvable binary has
    // none either. The two must not compare equal as a hit.
    await cacheHardhatConfig(paths, config);
    assert.isFalse(await areArtifactsCached([0], config, paths, undefined));

    // Even a fingerprint-carrying cache misses when the binary is gone.
    await cacheHardhatConfig(paths, config, createFingerprint("/tmp/hypc-a"));
    assert.isFalse(await areArtifactsCached([0], config, paths, undefined));
  });

  it("invalidates the cache when a downloaded compiler identity changes", async function () {
    const config = createHyperionConfig(
      undefined,
      "https://compilers.example/"
    );
    const identity = {
      source: "downloaded" as const,
      version: "1.2.3",
      longVersion: "1.2.3+commit.abcdef12",
      checksum: "11".repeat(32),
      checksumAlgorithm: "sha256" as const,
      repositoryUrl: "https://compilers.example/",
    };

    await cacheHardhatConfig(paths, config, identity);
    assert.isTrue(await areArtifactsCached([0], config, paths, identity));
    assert.isFalse(
      await areArtifactsCached([0], config, paths, {
        ...identity,
        checksum: "22".repeat(32),
      })
    );
  });

  it("invalidates the cache when the hypc binary fingerprint changes", async function () {
    const config = createHyperionConfig("/tmp/hypc-a");
    const fingerprint = createFingerprint("/tmp/hypc-a");

    await cacheHardhatConfig(paths, config, fingerprint);
    assert.isTrue(await areArtifactsCached([0], config, paths, fingerprint));

    // A rebuild at the same path with the same version string still misses:
    // mtime and size are part of the key.
    assert.isFalse(
      await areArtifactsCached([0], config, paths, {
        ...fingerprint,
        mtimeMs: 2000,
        size: 4097,
      })
    );

    // A different detected version misses even with identical stats.
    assert.isFalse(
      await areArtifactsCached([0], config, paths, {
        ...fingerprint,
        longVersion: "0.3.0+commit.22222222",
      })
    );

    // A cache written before fingerprints existed misses once and rebuilds.
    await cacheHardhatConfig(paths, config);
    assert.isFalse(await areArtifactsCached([0], config, paths, fingerprint));
  });
});

function createFingerprint(resolvedPath: string): CompilerFingerprint {
  return {
    source: "local",
    resolvedPath,
    longVersion: "0.2.0+commit.11111111",
    mtimeMs: 1000,
    size: 4096,
  };
}

function createHyperionConfig(
  compilerPath?: string,
  compilerRepositoryUrl?: string
): HyperionConfig {
  return {
    version: compilerRepositoryUrl === undefined ? "local" : "1.2.3",
    ...(compilerPath === undefined ? {} : { compilerPath }),
    ...(compilerRepositoryUrl === undefined ? {} : { compilerRepositoryUrl }),
    optimizer: {
      enabled: false,
      runs: 200,
    },
  };
}
