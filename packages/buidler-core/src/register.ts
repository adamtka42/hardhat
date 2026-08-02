import debug from "debug";

import { HardhatContext } from "./internal/context";
import { loadConfigAndTasks } from "./internal/core/config/config-loading";
import { getEnvHardhatArguments } from "./internal/core/params/env-variables";
import { HARDHAT_PARAM_DEFINITIONS } from "./internal/core/params/hardhat-params";
import { Environment } from "./internal/core/runtime-environment";
import { loadTsNodeIfPresent } from "./internal/core/typescript-support";
import {
  disableReplWriterShowProxy,
  isNodeCalledWithoutAScript,
} from "./internal/util/console";

if (!HardhatContext.isCreated()) {
  // tslint:disable-next-line no-var-requires
  require("source-map-support/register");

  const ctx = HardhatContext.createHardhatContext();

  if (isNodeCalledWithoutAScript()) {
    disableReplWriterShowProxy();
  }

  loadTsNodeIfPresent();

  const hardhatArguments = getEnvHardhatArguments(
    HARDHAT_PARAM_DEFINITIONS,
    process.env
  );

  if (hardhatArguments.verbose) {
    debug.enable("hardhat*");
  }

  const config = loadConfigAndTasks(hardhatArguments);

  // TODO: This is here for backwards compatibility.
  // There are very few projects using this.
  if (hardhatArguments.network === undefined) {
    hardhatArguments.network = config.defaultNetwork;
  }

  const env = new Environment(
    config,
    hardhatArguments,
    ctx.tasksDSL.getTaskDefinitions(),
    ctx.extendersManager.getExtenders()
  );

  ctx.setHardhatRuntimeEnvironment(env);

  env.injectToGlobal();
}
