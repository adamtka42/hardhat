import chalk from "chalk";
import fsExtra from "fs-extra";
import path from "path";

import {
  getArtifactFromContractOutput,
  saveArtifact,
} from "../internal/artifacts";
import {
  COMPILER_INPUT_FILENAME,
  COMPILER_OUTPUT_FILENAME,
} from "../internal/constants";
import { internalTask, task, types } from "../internal/core/config/config-env";
import { HardhatError } from "../internal/core/errors";
import { ERRORS } from "../internal/core/errors-list";
import { compileHyperion, HyperionInput } from "../internal/hyperion/compiler";
import { DependencyGraph } from "../internal/hyperion/dependencyGraph";
import { Resolver } from "../internal/hyperion/resolver";
import { glob } from "../internal/util/glob";
import { pluralize } from "../internal/util/strings";
import { ResolvedHardhatConfig } from "../types";

import {
  TASK_BUILD_ARTIFACTS,
  TASK_COMPILE,
  TASK_COMPILE_CHECK_CACHE,
  TASK_COMPILE_COMPILE,
  TASK_COMPILE_GET_COMPILER_INPUT,
  TASK_COMPILE_GET_DEPENDENCY_GRAPH,
  TASK_COMPILE_GET_RESOLVED_SOURCES,
  TASK_COMPILE_GET_SOURCE_PATHS,
  TASK_COMPILE_RUN_COMPILER,
} from "./task-names";
import { areArtifactsCached, cacheHardhatConfig } from "./utils/cache";

async function cacheCompilerJsonFiles(
  config: ResolvedHardhatConfig,
  input: any,
  output: any
) {
  await fsExtra.ensureDir(config.paths.cache);

  // TODO: This could be much better. It feels somewhat hardcoded
  await fsExtra.writeFile(
    path.join(config.paths.cache, COMPILER_INPUT_FILENAME),
    JSON.stringify(input, undefined, 2),
    {
      encoding: "utf8",
    }
  );

  await fsExtra.writeFile(
    path.join(config.paths.cache, COMPILER_OUTPUT_FILENAME),
    JSON.stringify(output, undefined, 2),
    {
      encoding: "utf8",
    }
  );
}

function isConsoleLogError(error: any): boolean {
  return (
    error.type === "TypeError" &&
    typeof error.message === "string" &&
    error.message.includes("log") &&
    error.message.includes("type(library console)")
  );
}

export default function () {
  internalTask(TASK_COMPILE_GET_SOURCE_PATHS, async (_, { config }) => {
    return glob(path.join(config.paths.sources, "**/*.hyp"));
  });

  internalTask(
    TASK_COMPILE_GET_RESOLVED_SOURCES,
    async (_, { config, run }) => {
      const resolver = new Resolver(config.paths.root);
      const paths = await run(TASK_COMPILE_GET_SOURCE_PATHS);
      return Promise.all(
        paths.map((p: string) => resolver.resolveProjectSourceFile(p))
      );
    }
  );

  internalTask(
    TASK_COMPILE_GET_DEPENDENCY_GRAPH,
    async (_, { config, run }) => {
      const resolver = new Resolver(config.paths.root);
      const localFiles = await run(TASK_COMPILE_GET_RESOLVED_SOURCES);

      return DependencyGraph.createFromResolvedFiles(resolver, localFiles);
    }
  );

  internalTask(TASK_COMPILE_GET_COMPILER_INPUT, async (_, { config, run }) => {
    const sourcePaths: string[] = await run(TASK_COMPILE_GET_SOURCE_PATHS);
    const sources: HyperionInput["sources"] = {};

    for (const sourcePath of sourcePaths) {
      const sourceName = path.relative(config.paths.root, sourcePath);
      sources[sourceName] = {
        content: await fsExtra.readFile(sourcePath, { encoding: "utf8" }),
      };
    }

    return {
      language: "Hyperion",
      sourcePaths,
      sources,
      settings: {
        optimizer: config.hyperion.optimizer,
      },
    };
  });

  internalTask(TASK_COMPILE_RUN_COMPILER)
    .addParam(
      "input",
      "The compiler standard JSON input",
      undefined,
      types.json
    )
    .setAction(async ({ input }: { input: HyperionInput }, { config }) => {
      return compileHyperion(
        input,
        config.paths.root,
        config.hyperion.compilerPath
      );
    });

  internalTask(TASK_COMPILE_COMPILE, async (_, { config, run }) => {
    const input = await run(TASK_COMPILE_GET_COMPILER_INPUT);

    console.log("Compiling Hyperion sources...");
    const output = await run(TASK_COMPILE_RUN_COMPILER, { input });

    let hasErrors = false;
    let hasConsoleLogErrors = false;
    if (output.errors) {
      for (const error of output.errors) {
        hasErrors = hasErrors || error.severity === "error";
        if (error.severity === "error") {
          hasErrors = true;

          if (isConsoleLogError(error)) {
            hasConsoleLogErrors = true;
          }

          console.error(chalk.red(error.formattedMessage));
        } else {
          console.log("\n");
          console.warn(chalk.yellow(error.formattedMessage));
        }
      }
    }

    if (hasConsoleLogErrors) {
      console.error(
        chalk.red(
          `The console.log call you made isn’t supported. See the QRL Hardhat documentation for the list of supported methods.`
        )
      );
      console.log();
    }

    if (hasErrors || !output.contracts) {
      throw new HardhatError(ERRORS.BUILTIN_TASKS.COMPILE_FAILURE);
    }

    await cacheCompilerJsonFiles(config, input, output);

    await cacheHardhatConfig(config.paths, config.hyperion);

    return output;
  });

  internalTask(TASK_COMPILE_CHECK_CACHE, async ({ force }, { config, run }) => {
    if (force) {
      return false;
    }

    // The dependency graph includes every transitively imported file, so
    // changes to imported libraries (e.g. under node_modules) also
    // invalidate the cache, not just changes to project-local sources.
    let sourceTimestamps: number[];
    try {
      const dependencyGraph: DependencyGraph = await run(
        TASK_COMPILE_GET_DEPENDENCY_GRAPH
      );

      sourceTimestamps = dependencyGraph
        .getResolvedFiles()
        .map((file) => file.lastModificationDate.getTime());
    } catch (error) {
      // Never let the cache check break a build that would compile fine:
      // hypc resolves imports on its own, so if the resolver fails here we
      // just recompile instead of risking a stale cache hit.
      console.warn(
        chalk.yellow(
          "Could not resolve Hyperion dependencies for cache checking, recompiling."
        )
      );
      return false;
    }

    return areArtifactsCached(sourceTimestamps, config.hyperion, config.paths);
  });

  internalTask(TASK_BUILD_ARTIFACTS, async ({ force }, { config, run }) => {
    const sources = await run(TASK_COMPILE_GET_SOURCE_PATHS);

    if (sources.length === 0) {
      console.log("No Hyperion source file available.");
      return;
    }

    const isCached: boolean = await run(TASK_COMPILE_CHECK_CACHE, { force });

    if (isCached) {
      console.log(
        "All contracts have already been compiled, skipping compilation."
      );
      return;
    }

    const compilationOutput = await run(TASK_COMPILE_COMPILE);

    if (compilationOutput === undefined) {
      return;
    }

    await fsExtra.ensureDir(config.paths.artifacts);
    let numberOfContracts = 0;
    const contractNameCounts = getContractNameCounts(
      compilationOutput.contracts
    );

    for (const [sourceName, file] of Object.entries<any>(
      compilationOutput.contracts
    )) {
      for (const [contractName, contractOutput] of Object.entries(file)) {
        const artifact = getArtifactFromContractOutput(
          contractName,
          contractOutput,
          sourceName
        );
        numberOfContracts += 1;

        await saveArtifact(
          config.paths.artifacts,
          artifact,
          contractNameCounts[contractName] === 1
        );
      }
    }

    console.log(
      "Compiled",
      numberOfContracts,
      pluralize(numberOfContracts, "contract"),
      "successfully"
    );
  });

  task(TASK_COMPILE, "Compiles the entire project, building all artifacts")
    .addFlag("force", "Force compilation ignoring cache")
    .setAction(async ({ force: force }: { force: boolean }, { run }) =>
      run(TASK_BUILD_ARTIFACTS, { force })
    );
}

function getContractNameCounts(
  contracts: any
): { [contractName: string]: number } {
  const counts: { [contractName: string]: number } = {};

  for (const file of Object.values<any>(contracts)) {
    for (const contractName of Object.keys(file)) {
      counts[contractName] = (counts[contractName] ?? 0) + 1;
    }
  }

  return counts;
}
