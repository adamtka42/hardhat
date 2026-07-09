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
});

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
  const libPackageJsonPath = () =>
    path.join(process.cwd(), "node_modules", "dep-lib", "package.json");
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

  it("reports a cache hit when nothing changed", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    assert.isTrue(
      await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
    );
  });

  it("invalidates the cache when an imported node_modules file changes", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    await withRestoredFile(libFilePath(), async (originalContent) => {
      await fsExtra.writeFile(
        libFilePath(),
        `${originalContent}\n// modified\n`
      );

      assert.isFalse(
        await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
      );
    });
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

  it("recompiles instead of failing when dependency resolution breaks", async function () {
    await this.env.run(TASK_COMPILE, { force: true });

    // Removing the package.json makes the resolver throw for the dep-lib
    // import; the cache check must degrade to a cache miss, not crash.
    const packageJsonContent = await fsExtra.readFile(
      libPackageJsonPath(),
      "utf8"
    );
    await fsExtra.remove(libPackageJsonPath());
    try {
      assert.isFalse(
        await this.env.run(TASK_COMPILE_CHECK_CACHE, { force: false })
      );
    } finally {
      await fsExtra.writeFile(libPackageJsonPath(), packageJsonContent);
    }
  });
});
