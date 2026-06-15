import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

import { TASK_COMPILE } from "../../src/builtin-tasks/task-names";
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

describe("Compile task", function () {
  useFixtureProject("contracts-project");
  useEnvironment();

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
