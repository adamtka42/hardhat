import { assert } from "chai";
import path from "path";

import { TASK_CLEAN } from "../../../../src/builtin-tasks/task-names";
import { HardhatContext } from "../../../../src/internal/context";
import { loadConfigAndTasks } from "../../../../src/internal/core/config/config-loading";
import { ERRORS } from "../../../../src/internal/core/errors-list";
import { resetHardhatContext } from "../../../../src/internal/reset";
import { useEnvironment } from "../../../helpers/environment";
import { expectHardhatError } from "../../../helpers/errors";
import {
  getFixtureProjectPath,
  useFixtureProject,
} from "../../../helpers/project";

describe("config loading", function () {
  describe("default config path", function () {
    useFixtureProject("config-project");
    useEnvironment();

    it("should load the default config if none is given", function () {
      assert.isDefined(this.env.config.networks.qrl);
      assert.equal(this.env.config.defaultNetwork, "custom");
      assert.equal(
        (this.env.config.networks.qrl as any).url,
        "http://127.0.0.1:33462"
      );
    });
  });

  describe("Config validation", function () {
    describe("When the config is invalid", function () {
      useFixtureProject("invalid-config");

      beforeEach(function () {
        HardhatContext.createHardhatContext();
      });

      afterEach(function () {
        resetHardhatContext();
      });

      it("Should throw the right error", function () {
        expectHardhatError(
          () => loadConfigAndTasks(),
          ERRORS.GENERAL.INVALID_CONFIG
        );
      });
    });
  });

  describe("custom config path", function () {
    useFixtureProject("custom-config-file");

    beforeEach(function () {
      HardhatContext.createHardhatContext();
    });

    afterEach(function () {
      resetHardhatContext();
    });

    it("should accept a relative path from the CWD", function () {
      const config = loadConfigAndTasks({ config: "config.js" });

      assert.equal(
        config.paths.configFile,
        path.normalize(path.join(process.cwd(), "config.js"))
      );
    });

    it("should accept an absolute path", async function () {
      const fixtureDir = await getFixtureProjectPath("custom-config-file");
      const config = loadConfigAndTasks({
        config: path.join(fixtureDir, "config.js"),
      });

      assert.equal(
        config.paths.configFile,
        path.normalize(path.join(process.cwd(), "config.js"))
      );
    });
  });

  describe("Tasks loading", function () {
    useFixtureProject("config-project");
    useEnvironment();

    it("Should define the default tasks", function () {
      assert.containsAllKeys(this.env.tasks, [
        TASK_CLEAN,
        "flatten",
        "compile",
        "help",
        "run",
        "test",
      ]);
    });

    it("Should load custom tasks", function () {
      assert.containsAllKeys(this.env.tasks, ["example", "example2"]);
    });
  });

  describe("Config env", function () {
    useFixtureProject("config-project");

    afterEach(function () {
      resetHardhatContext();
    });

    it("should remove everything from global state after loading", function () {
      const globalAsAny: any = global;

      HardhatContext.createHardhatContext();
      loadConfigAndTasks();

      assert.isUndefined(globalAsAny.internalTask);
      assert.isUndefined(globalAsAny.task);
      assert.isUndefined(globalAsAny.types);
      assert.isUndefined(globalAsAny.extendEnvironment);
      assert.isUndefined(globalAsAny.usePlugin);

      resetHardhatContext();

      HardhatContext.createHardhatContext();
      loadConfigAndTasks();

      assert.isUndefined(globalAsAny.internalTask);
      assert.isUndefined(globalAsAny.task);
      assert.isUndefined(globalAsAny.types);
      assert.isUndefined(globalAsAny.extendEnvironment);
      assert.isUndefined(globalAsAny.usePlugin);
      resetHardhatContext();
    });
  });

  describe("Config that imports the library", function () {
    useFixtureProject("config-imports-lib-project");

    beforeEach(function () {
      HardhatContext.createHardhatContext();
    });

    afterEach(function () {
      resetHardhatContext();
    });

    it("should accept a relative path from the CWD", function () {
      expectHardhatError(
        () => loadConfigAndTasks(),
        ERRORS.GENERAL.LIB_IMPORTED_FROM_THE_CONFIG
      );
    });
  });
});
