import { assert } from "chai";
import { execFile } from "child_process";
import { createHash } from "crypto";
import fsExtra from "fs-extra";
import * as http from "http";
import { keccak_256 } from "js-sha3";
import path from "path";
import { promisify } from "util";

import { ERRORS } from "../../../src/internal/core/errors-list";
import { compileHyperion } from "../../../src/internal/hyperion/compiler";
import {
  HyperionCompilerBuild,
  HyperionCompilersManifest,
} from "../../../src/internal/hyperion/compiler-downloader";
import {
  HYPERION_COMPILER_REPOSITORY_ENV,
  resolveHyperionCompiler,
} from "../../../src/internal/hyperion/compiler-resolver";
import { DownloadedCompilerIdentity } from "../../../src/internal/hyperion/compiler-types";
import { HyperionConfig } from "../../../src/types";
import { expectHardhatErrorAsync } from "../../helpers/errors";
import { useTmpDir } from "../../helpers/fs";

const execFileAsync = promisify(execFile);
const VERSION = "1.2.3";
const LONG_VERSION = "1.2.3+commit.abcdef12";
const BUILD_PATH = "builds/hypc-1.2.3";
const COMPILER = Buffer.from(
  `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "hypc, the hyperion compiler commandline interface"
  echo "Version: ${LONG_VERSION}"
  exit 0
fi
cat <<'JSON'
{"contracts":{"contracts/A.hyp":{"A":{"abi":[],"qrvm":{"bytecode":{"object":"00","linkReferences":{}},"deployedBytecode":{"object":"00","linkReferences":{}}}}}},"sources":{"contracts/A.hyp":{"id":0}}}
JSON
`
);

describe("Hyperion compiler resolver and downloader", function () {
  useTmpDir("hyperion-compiler-downloader");

  let server: http.Server | undefined;
  let repositoryUrl: string;
  let manifest: HyperionCompilersManifest;
  let compilerRequests: number;
  let manifestRequests: number;
  const environmentVariables = [
    "HYPERION_HYPC_PATH",
    "HYPC_PATH",
    HYPERION_COMPILER_REPOSITORY_ENV,
  ];
  let savedEnvironment: Array<string | undefined>;

  beforeEach(async function () {
    savedEnvironment = environmentVariables.map((name) => process.env[name]);
    environmentVariables.forEach((name) => delete process.env[name]);

    compilerRequests = 0;
    manifestRequests = 0;
    manifest = createManifest(COMPILER);
    server = http.createServer((request, response) => {
      if (request.url === "/list.json") {
        manifestRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(manifest));
        return;
      }
      if (request.url === `/${BUILD_PATH}`) {
        compilerRequests += 1;
        response.end(COMPILER);
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as any;
    repositoryUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async function () {
    if (server !== undefined) {
      await closeServer(server);
      server = undefined;
    }

    environmentVariables.forEach((name, index) => {
      const value = savedEnvironment[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  it("downloads, verifies, executes, and reuses a compiler", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const config = createConfig(repositoryUrl);
    const first = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    assert.equal(first.source, "downloaded");
    assert.equal(first.version, VERSION);
    assert.equal(first.longVersion, LONG_VERSION);
    assert.isTrue(await fsExtra.pathExists(first.path));
    assert.equal(compilerRequests, 1);
    assert.equal(manifestRequests, 1);

    const execution = await execFileAsync(first.path, ["--version"]);
    assert.include(execution.stdout.toString(), LONG_VERSION);

    const output = await compileHyperion(
      {
        language: "Hyperion",
        sourcePaths: ["contracts/A.hyp"],
        sources: {
          "contracts/A.hyp": { content: "contract A {}" },
        },
        settings: {
          optimizer: { enabled: false, runs: 200 },
        },
      },
      this.tmpDir,
      first.path
    );
    assert.equal(
      output.contracts["contracts/A.hyp"].A.bytecodeOutput.bytecode.object,
      "00"
    );

    const second = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );
    assert.equal(second.path, first.path);
    assert.equal(compilerRequests, 1);
    assert.equal(manifestRequests, 1);

    await closeServer(server!);
    server = undefined;

    const offline = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );
    assert.equal(offline.path, first.path);
    assert.deepEqual(offline.identity, first.identity);
  });

  it("accepts an 0x-prefixed keccak256 checksum", async function () {
    manifest = createManifest(COMPILER);
    const build = manifest.builds[0];
    delete build.checksum;
    delete build.checksumAlgorithm;
    build.keccak256 = `0x${keccak_256(COMPILER)}`;

    const resolved = await resolveHyperionCompiler(
      createConfig(repositoryUrl),
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    const identity = resolved.identity as DownloadedCompilerIdentity;
    assert.equal(identity.checksumAlgorithm, "keccak256");
    assert.equal(identity.checksum, keccak_256(COMPILER));
  });

  it("redownloads a cached compiler when its contents are corrupted", async function () {
    const config = createConfig(repositoryUrl);
    const first = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );
    await fsExtra.writeFile(first.path, "corrupted");

    const repaired = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    assert.equal(repaired.path, first.path);
    assert.equal(compilerRequests, 2);
    assert.deepEqual(await fsExtra.readFile(repaired.path), COMPILER);
  });

  it("restores execute permissions on a valid cached compiler", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const config = createConfig(repositoryUrl);
    const first = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );
    await fsExtra.chmod(first.path, 0o644);

    const cached = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    assert.equal(cached.path, first.path);
    assert.equal(compilerRequests, 1);
    const execution = await execFileAsync(cached.path, ["--version"]);
    assert.include(execution.stdout.toString(), LONG_VERSION);
  });

  it("removes a download that doesn't match the manifest checksum", async function () {
    manifest = createManifest(COMPILER, "0".repeat(64));

    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          createConfig(repositoryUrl),
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_INVALID_CHECKSUM
    );

    assert.equal(compilerRequests, 1);
    const downloadedFiles = await findFiles(
      path.join(this.tmpDir, "cache", "hyperion-compilers")
    );
    assert.notInclude(downloadedFiles, "hypc-1.2.3");
  });

  it("uses the compiler repository URL from the environment", async function () {
    const config = createConfig(repositoryUrl);
    delete config.compilerRepositoryUrl;
    process.env[HYPERION_COMPILER_REPOSITORY_ENV] = repositoryUrl;

    const resolved = await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    assert.equal(resolved.source, "downloaded");
    assert.equal(compilerRequests, 1);
  });

  it("refreshes a cached manifest when the requested version is missing", async function () {
    const config = createConfig(repositoryUrl);
    await resolveHyperionCompiler(
      config,
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );
    assert.equal(manifestRequests, 1);

    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          { ...config, version: "9.9.9" },
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_VERSION_NOT_FOUND
    );
    assert.equal(manifestRequests, 2);
  });

  it("reports a version missing from the repository", async function () {
    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          { ...createConfig(repositoryUrl), version: "9.9.9" },
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_VERSION_NOT_FOUND,
      "9.9.9"
    );
    assert.equal(compilerRequests, 0);
  });

  it("reports a release that references a missing build as a repository error", async function () {
    manifest.builds = [];

    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          createConfig(repositoryUrl),
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_REPOSITORY_ERROR,
      "missing build"
    );
  });

  it("rejects a compiler build URL outside the repository", async function () {
    const build = manifest.builds[0];
    build.path = "../outside/hypc";
    manifest.releases[VERSION] = build.path;

    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          createConfig(repositoryUrl),
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_REPOSITORY_ERROR
    );
    assert.equal(compilerRequests, 0);
  });

  it("rejects repository URLs containing a query", async function () {
    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          createConfig(`${repositoryUrl}?channel=nightly`),
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_REPOSITORY_ERROR,
      "query or fragment"
    );
    assert.equal(compilerRequests, 0);
  });

  it("prefers an explicitly configured local compiler", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const localCompiler = path.join(this.tmpDir, "local-hypc");
    await fsExtra.writeFile(localCompiler, COMPILER, { mode: 0o755 });
    const resolved = await resolveHyperionCompiler(
      {
        ...createConfig(repositoryUrl),
        compilerPath: localCompiler,
      },
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    assert.equal(resolved.source, "local");
    assert.equal(resolved.path, localCompiler);
    assert.equal(resolved.longVersion, LONG_VERSION);
    assert.equal(compilerRequests, 0);
  });

  it("prefers a local compiler selected through the environment", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const localCompiler = path.join(this.tmpDir, "env-hypc");
    await fsExtra.writeFile(localCompiler, COMPILER, { mode: 0o755 });
    process.env.HYPERION_HYPC_PATH = localCompiler;

    const resolved = await resolveHyperionCompiler(
      createConfig(repositoryUrl),
      this.tmpDir,
      path.join(this.tmpDir, "cache")
    );

    assert.equal(resolved.source, "local");
    assert.equal(resolved.path, localCompiler);
    assert.equal(compilerRequests, 0);
  });

  it("reports a missing local compiler separately from download errors", async function () {
    await expectHardhatErrorAsync(
      () =>
        resolveHyperionCompiler(
          {
            ...createConfig(repositoryUrl),
            compilerPath: path.join(this.tmpDir, "missing-hypc"),
          },
          this.tmpDir,
          path.join(this.tmpDir, "cache")
        ),
      ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_NOT_FOUND
    );
  });
});

function createConfig(repositoryUrl: string): HyperionConfig {
  return {
    version: VERSION,
    compilerRepositoryUrl: repositoryUrl,
    optimizer: {
      enabled: false,
      runs: 200,
    },
  };
}

function createManifest(
  compiler: Buffer,
  checksum: string = createHash("sha256").update(compiler).digest("hex"),
  checksumAlgorithm: "keccak256" | "sha256" = "sha256"
): HyperionCompilersManifest {
  const build: HyperionCompilerBuild = {
    path: BUILD_PATH,
    version: VERSION,
    longVersion: LONG_VERSION,
    checksum,
    checksumAlgorithm,
  };
  return {
    builds: [build],
    releases: {
      [VERSION]: BUILD_PATH,
    },
    latestRelease: VERSION,
  };
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function findFiles(root: string): Promise<string[]> {
  if (!(await fsExtra.pathExists(root))) {
    return [];
  }

  const entries = await fsExtra.readdir(root);
  const descendants = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry);
      const stats = await fsExtra.stat(entryPath);
      return stats.isDirectory() ? findFiles(entryPath) : [entry];
    })
  );
  return ([] as string[]).concat(...descendants);
}
