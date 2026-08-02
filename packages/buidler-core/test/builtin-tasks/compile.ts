import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import {
  TASK_COMPILE,
  TASK_COMPILE_CHECK_CACHE,
} from "../../src/builtin-tasks/task-names";
import { readArtifact } from "../../src/internal/artifacts";
import { useEnvironment } from "../helpers/environment";
import { useFixtureProject } from "../helpers/project";

const LOCAL_HYPC_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "hyperion",
  "build",
  "hypc",
  "hypc"
);

function resolveHypcPath(): string | undefined {
  if (process.env.HYPERION_HYPC_PATH !== undefined) {
    return process.env.HYPERION_HYPC_PATH;
  }

  if (process.env.HYPC_PATH !== undefined) {
    return process.env.HYPC_PATH;
  }

  if (fsExtra.pathExistsSync(LOCAL_HYPC_PATH)) {
    return LOCAL_HYPC_PATH;
  }

  return findExecutableOnPath("hypc");
}

function findExecutableOnPath(executable: string): string | undefined {
  const pathValue = process.env.PATH;
  const pathDirs =
    pathValue === undefined ? [] : pathValue.split(path.delimiter);

  for (const pathDir of pathDirs) {
    const candidate = path.join(pathDir, executable);
    if (fsExtra.pathExistsSync(candidate)) {
      return candidate;
    }
  }
}

function useHypcEnvironment() {
  const previousHypcPath = process.env.HYPERION_HYPC_PATH;

  before(function () {
    const hypcPath = resolveHypcPath();
    if (hypcPath === undefined) {
      this.skip();
      return;
    }

    process.env.HYPERION_HYPC_PATH = hypcPath;
  });

  after(function () {
    if (previousHypcPath === undefined) {
      delete process.env.HYPERION_HYPC_PATH;
    } else {
      process.env.HYPERION_HYPC_PATH = previousHypcPath;
    }
  });
}

describe("Compile task", function () {
  useFixtureProject("contracts-project");
  useEnvironment();
  useHypcEnvironment();

  beforeEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  afterEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  it("compiles Hyperion sources and writes artifacts", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    const artifact = await readArtifact(this.env.config.paths.artifacts, "A");

    assert.equal(artifact.contractName, "A");
    assert.deepEqual(artifact.abi, []);
    assert.match(artifact.bytecode, /^0x[0-9a-f]*$/i);
    assert.match(artifact.deployedBytecode, /^0x[0-9a-f]*$/i);
  });

  it("prints no version warning for the default local version", async function () {
    const warnings = captureConsoleWarn();
    try {
      await this.env.run(TASK_COMPILE, { force: true });
    } finally {
      warnings.restore();
    }

    assert.lengthOf(warnings.versionWarnings(), 0);
  });
});

describe("Compile task with comment/string phantom imports", function () {
  useFixtureProject("tricky-imports-project");
  useEnvironment();
  useHypcEnvironment();

  beforeEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  afterEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  it("caches despite imports inside comments and string literals", async function () {
    // Tricky.hyp spells nonexistent imports inside comments and string
    // literals. hypc compiles it fine; the dependency EXTRACTOR must not
    // hallucinate those files, or cache checking degrades to permanent
    // recompilation.
    await this.env.run(TASK_COMPILE, { force: true });

    const artifact = await readArtifact(
      this.env.config.paths.artifacts,
      "Tricky"
    );
    assert.equal(artifact.contractName, "Tricky");

    assert.isTrue(
      await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
    );
  });

  it("stores deterministic contract metadata in the compiler output cache", async function () {
    // F10.2: metadata (with useLiteralContent) is requested and preserved
    // through the standard-JSON adapter and the compiler cache, and is
    // byte-identical across rebuilds of identical sources.
    await this.env.run(TASK_COMPILE, { force: true });
    const firstOutput = await fsExtra.readJson(
      path.join(this.env.config.paths.cache, "compiler-output.json")
    );
    const firstMetadata =
      firstOutput.contracts["contracts/Tricky.hyp"].Tricky.metadata;
    assert.isString(firstMetadata);
    const parsed = JSON.parse(firstMetadata);
    assert.isDefined(parsed.settings);
    assert.equal(parsed.settings.metadata.useLiteralContent, true);
    // Literal content: the metadata embeds the sources themselves.
    assert.isDefined(
      parsed.sources["contracts/Tricky.hyp"].content,
      "metadata must embed literal source content"
    );

    await this.env.run(TASK_COMPILE, { force: true });
    const secondOutput = await fsExtra.readJson(
      path.join(this.env.config.paths.cache, "compiler-output.json")
    );
    assert.equal(
      secondOutput.contracts["contracts/Tricky.hyp"].Tricky.metadata,
      firstMetadata
    );
  });
});

describe("Compile task compiler version check", function () {
  useFixtureProject("compiler-version-project");
  useEnvironment();
  useHypcEnvironment();

  beforeEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  afterEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  it("warns exactly once per run on a version mismatch, also on cache hits", async function () {
    const firstRun = captureConsoleWarn();
    try {
      await this.env.run(TASK_COMPILE, { force: true });
    } finally {
      firstRun.restore();
    }

    assert.lengthOf(firstRun.versionWarnings(), 1);
    assert.include(firstRun.versionWarnings()[0], "0.0.1-version-check");

    // The compile itself succeeded despite the warning.
    const artifact = await readArtifact(this.env.config.paths.artifacts, "A");
    assert.equal(artifact.contractName, "A");

    // A cached run must still surface the same single warning.
    const secondRun = captureConsoleWarn();
    try {
      await this.env.run(TASK_COMPILE, { force: false });
    } finally {
      secondRun.restore();
    }

    assert.lengthOf(secondRun.versionWarnings(), 1);
  });
});

function captureConsoleWarn(): {
  versionWarnings: () => string[];
  restore: () => void;
} {
  const originalWarn = console.warn;
  const messages: string[] = [];
  console.warn = (...args: any[]) => {
    messages.push(args.join(" "));
  };

  return {
    versionWarnings: () =>
      messages.filter((message) => message.includes("claims version")),
    restore: () => {
      console.warn = originalWarn;
    },
  };
}

describe("Compile task with external libraries", function () {
  useFixtureProject("library-project");
  useEnvironment();
  useHypcEnvironment();

  beforeEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  afterEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  it("emits link references and placeholders for external libraries", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    const artifact = await readArtifact(
      this.env.config.paths.artifacts,
      "UsesMathLib"
    );

    const sourceNames = Object.keys(artifact.linkReferences);
    assert.lengthOf(sourceNames, 1);
    const libraryNames = Object.keys(artifact.linkReferences[sourceNames[0]]);
    assert.deepEqual(libraryNames, ["MathLib"]);

    const [position] = artifact.linkReferences[sourceNames[0]].MathLib;
    // The placeholder occupies the full 64-byte address slot regardless of
    // the reported length.
    const placeholder = artifact.bytecode.slice(
      2 + position.start * 2,
      2 + position.start * 2 + 128
    );
    assert.match(placeholder, /^__\$[0-9a-f]{122}\$__$/);

    const libraryArtifact = await readArtifact(
      this.env.config.paths.artifacts,
      "MathLib"
    );
    assert.deepEqual(libraryArtifact.linkReferences, {});
    assert.notInclude(libraryArtifact.bytecode, "__$");
  });
});

describe("Compile task cache", function () {
  useFixtureProject("cache-imports-project");
  useEnvironment();
  useHypcEnvironment();

  beforeEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  afterEach(async function () {
    await fsExtra.remove("artifacts");
    await fsExtra.remove("cache");
  });

  const libFilePath = () =>
    path.join(process.cwd(), "node_modules", "dep-lib", "Lib.hyp");
  const projectSourcePath = () =>
    path.join(process.cwd(), "contracts", "Consumer.hyp");

  async function withRestoredFile(
    filePath: string,
    action: (originalContent: string) => Promise<void>
  ) {
    const originalContent = await fsExtra.readFile(filePath, "utf8");
    try {
      await action(originalContent);
    } finally {
      await fsExtra.writeFile(filePath, originalContent);
    }
  }

  it("caches the exact standard JSON given to hypc, dependencies included", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    const cachedInput = await fsExtra.readJson(
      path.join(this.env.config.paths.cache, "compiler-input.json")
    );

    // The cached input is the REAL standard JSON: full settings and every
    // dependency-graph file, including the node_modules import.
    assert.equal(cachedInput.language, "Hyperion");
    assert.equal(cachedInput.settings.metadata.useLiteralContent, true);
    assert.isDefined(cachedInput.settings.outputSelection);
    assert.include(
      Object.keys(cachedInput.sources).join(","),
      "dep-lib/Lib.hyp"
    );
    assert.property(cachedInput.sources, "contracts/Consumer.hyp");
    assert.isString(cachedInput.sources["contracts/Consumer.hyp"].content);
    assert.isUndefined(cachedInput.sourcePaths);
  });

  it("reports a cache hit when nothing changed", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    assert.isTrue(
      await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
    );
  });

  it("invalidates the cache when an imported node_modules file changes", async function () {
    await this.env.run(TASK_COMPILE, { force: true });
    const before = await readArtifact(
      this.env.config.paths.artifacts,
      "Consumer"
    );

    await withRestoredFile(libFilePath(), async (originalContent) => {
      await fsExtra.writeFile(
        libFilePath(),
        `${originalContent}\n// modified\n`
      );

      assert.isFalse(
        await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
      );

      // A REGULAR compile (no force) must actually rebuild: the metadata
      // hash embedded in the bytecode changes with the imported source.
      await this.env.run(TASK_COMPILE, {});
      const after = await readArtifact(
        this.env.config.paths.artifacts,
        "Consumer"
      );
      assert.notEqual(after.bytecode, before.bytecode);
    });
  });

  it("invalidates the cache when a symlinked package file changes", async function () {
    const realPackageDir = path.join(process.cwd(), "linked-lib-src");
    const linkPath = path.join(process.cwd(), "node_modules", "linked-lib");
    const consumerPath = path.join(
      process.cwd(),
      "contracts",
      "LinkedConsumer.hyp"
    );

    await fsExtra.ensureDir(realPackageDir);
    await fsExtra.writeFile(
      path.join(realPackageDir, "package.json"),
      JSON.stringify({ name: "linked-lib", version: "1.0.0" })
    );
    await fsExtra.writeFile(
      path.join(realPackageDir, "Linked.hyp"),
      "pragma hyperion >=0.0;\n\ncontract Linked {}\n"
    );
    await fsExtra.symlink(realPackageDir, linkPath, "dir");
    await fsExtra.writeFile(
      consumerPath,
      'pragma hyperion >=0.0;\n\nimport "linked-lib/Linked.hyp";\n\ncontract LinkedConsumer {}\n'
    );

    try {
      await this.env.run(TASK_COMPILE, { force: true });
      assert.isTrue(
        await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
      );

      await fsExtra.writeFile(
        path.join(realPackageDir, "Linked.hyp"),
        "pragma hyperion >=0.0;\n\ncontract Linked { uint256 internal touched; }\n"
      );

      assert.isFalse(
        await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
      );
    } finally {
      await fsExtra.remove(consumerPath);
      await fsExtra.remove(linkPath);
      await fsExtra.remove(realPackageDir);
    }
  });

  it("invalidates the cache when a project source changes", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    await withRestoredFile(projectSourcePath(), async (originalContent) => {
      await fsExtra.writeFile(
        projectSourcePath(),
        `${originalContent}\n// modified\n`
      );

      assert.isFalse(
        await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
      );
    });
  });
});
