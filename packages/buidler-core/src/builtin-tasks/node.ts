import { task, types } from "../internal/core/config/config-env";
import { HardhatError } from "../internal/core/errors";
import { ERRORS } from "../internal/core/errors-list";

import { TASK_NODE } from "./task-names";

export default function () {
  task(TASK_NODE, "Starts a local QRL JSON-RPC server")
    .addOptionalParam(
      "hostname",
      "The host to which to bind to for new connections",
      "localhost",
      types.string
    )
    .addOptionalParam(
      "port",
      "The port on which to listen for new connections",
      8545,
      types.int
    )
    .setAction(async () => {
      throw new HardhatError(ERRORS.NETWORK.QRL_IN_MEMORY_NODE_UNSUPPORTED);
    });
}
