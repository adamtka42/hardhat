#!/usr/bin/env node
import chalk from "chalk";
import debug from "debug";
import semver from "semver";
import "source-map-support/register";

import { TASK_HELP } from "../../builtin-tasks/task-names";
import { TaskArguments } from "../../types";
import { HARDHAT_NAME } from "../constants";
import { HardhatContext } from "../context";
import { loadConfigAndTasks } from "../core/config/config-loading";
import { HardhatError, HardhatPluginError } from "../core/errors";
import { ERRORS, getErrorCode } from "../core/errors-list";
import { getEnvHardhatArguments } from "../core/params/env-variables";
import { HARDHAT_PARAM_DEFINITIONS } from "../core/params/hardhat-params";
import { isCwdInsideProject } from "../core/project-structure";
import { Environment } from "../core/runtime-environment";
import { loadTsNodeIfPresent } from "../core/typescript-support";
import { getPackageJson, PackageJson } from "../util/packageInfo";

import { ArgumentsParser } from "./ArgumentsParser";
import { enableEmoji } from "./emoji";
import { createProject } from "./project-creation";

const log = debug("hardhat:core:cli");

async function printVersionMessage(packageJson: PackageJson) {
  console.log(packageJson.version);
}

function ensureValidNodeVersion(packageJson: PackageJson) {
  const requirement = packageJson.engines.node;
  if (!semver.satisfies(process.version, requirement)) {
    throw new HardhatError(ERRORS.GENERAL.INVALID_NODE_VERSION, {
      requirement,
    });
  }
}

async function main() {
  // We first accept this argument anywhere, so we know if the user wants
  // stack traces before really parsing the arguments.
  let showStackTraces = process.argv.includes("--show-stack-traces");

  try {
    const packageJson = await getPackageJson();

    ensureValidNodeVersion(packageJson);

    const envVariableArguments = getEnvHardhatArguments(
      HARDHAT_PARAM_DEFINITIONS,
      process.env
    );

    const argumentsParser = new ArgumentsParser();

    const {
      hardhatArguments,
      taskName: parsedTaskName,
      unparsedCLAs,
    } = argumentsParser.parseHardhatArguments(
      HARDHAT_PARAM_DEFINITIONS,
      envVariableArguments,
      process.argv.slice(2)
    );

    if (hardhatArguments.verbose) {
      debug.enable("hardhat*");
    }

    if (hardhatArguments.emoji) {
      enableEmoji();
    }

    showStackTraces = hardhatArguments.showStackTraces;

    if (
      hardhatArguments.config === undefined &&
      !isCwdInsideProject() &&
      process.stdout.isTTY === true
    ) {
      await createProject();
      return;
    }

    // --version is a special case
    if (hardhatArguments.version) {
      await printVersionMessage(packageJson);
      return;
    }

    loadTsNodeIfPresent();

    const ctx = HardhatContext.createHardhatContext();
    const config = loadConfigAndTasks(hardhatArguments);

    const envExtenders = ctx.extendersManager.getExtenders();
    const taskDefinitions = ctx.tasksDSL.getTaskDefinitions();

    let taskName = parsedTaskName !== undefined ? parsedTaskName : "help";

    let taskArguments: TaskArguments;

    // --help is a also special case
    if (hardhatArguments.help && taskName !== TASK_HELP) {
      taskArguments = { task: taskName };
      taskName = TASK_HELP;
    } else {
      const taskDefinition = taskDefinitions[taskName];

      if (taskDefinition === undefined) {
        throw new HardhatError(ERRORS.ARGUMENTS.UNRECOGNIZED_TASK, {
          task: taskName,
        });
      }

      taskArguments = argumentsParser.parseTaskArguments(
        taskDefinition,
        unparsedCLAs
      );
    }

    // TODO: This is here for backwards compatibility
    // There are very few projects using this.
    if (hardhatArguments.network === undefined) {
      hardhatArguments.network = config.defaultNetwork;
    }

    const env = new Environment(
      config,
      hardhatArguments,
      taskDefinitions,
      envExtenders
    );

    ctx.setHardhatRuntimeEnvironment(env);

    await env.run(taskName, taskArguments);

    log(`Killing Hardhat after successfully running task ${taskName}`);
  } catch (error) {
    let isHardhatError = false;

    if (HardhatError.isHardhatError(error)) {
      isHardhatError = true;
      console.error(chalk.red(`Error ${error.message}`));
    } else if (HardhatPluginError.isHardhatPluginError(error)) {
      isHardhatError = true;
      console.error(
        chalk.red(`Error in plugin ${error.pluginName}: ${error.message}`)
      );
    } else if (error instanceof Error) {
      console.error(chalk.red("An unexpected error occurred:"));
      showStackTraces = true;
    } else {
      console.error(chalk.red("An unexpected error occurred."));
      showStackTraces = true;
    }

    console.log("");

    if (showStackTraces) {
      console.error(error.stack);
    } else {
      if (!isHardhatError) {
        console.error(
          `If you think this is a bug in Hardhat, please report it here: https://github.com/cyyber/hardhat/issues/new`
        );
      }

      if (HardhatError.isHardhatError(error)) {
        const link = `https://github.com/cyyber/hardhat#${getErrorCode(
          error.errorDescriptor
        )}`;

        console.error(
          `For more info go to ${link} or run ${HARDHAT_NAME} with --show-stack-traces`
        );
      } else {
        console.error(
          `For more info run ${HARDHAT_NAME} with --show-stack-traces`
        );
      }
    }

    process.exit(1);
  }
}

main()
  .then(() => process.exit(process.exitCode))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
