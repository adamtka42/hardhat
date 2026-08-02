import chalk from "chalk";
import debug from "debug";

import {
  JsonRpcServer,
  JsonRpcServerConfig,
} from "../internal/buidler-evm/jsonrpc/server";
import { HARDHAT_QRLVM_NETWORK_NAME } from "../internal/constants";
import { task, types } from "../internal/core/config/config-env";
import { HardhatError } from "../internal/core/errors";
import { ERRORS } from "../internal/core/errors-list";
import { createProvider } from "../internal/core/providers/construction";
import { lazyObject } from "../internal/util/lazy";
import {
  HardhatQrlvmNetworkConfig,
  IQrlProvider,
  ResolvedHardhatConfig,
} from "../types";

import { TASK_NODE } from "./task-names";

const log = debug("buidler:core:tasks:node");

function _createHardhatQrlvmProvider(
  config: ResolvedHardhatConfig
): IQrlProvider {
  log("Creating Hardhat QRLVM Provider");

  const networkName = HARDHAT_QRLVM_NETWORK_NAME;
  const networkConfig = config.networks[
    networkName
  ] as HardhatQrlvmNetworkConfig;

  return lazyObject(() => {
    log("Creating hardhatqrlvm provider for JSON-RPC server");
    return createProvider(
      networkName,
      { loggingEnabled: true, ...networkConfig },
      config.paths
    );
  });
}

function logHardhatQrlvmAccounts(networkConfig: HardhatQrlvmNetworkConfig) {
  if (networkConfig.accounts === undefined) {
    return;
  }

  console.log("Accounts");
  console.log("========");

  // QRL account seeds must never be printed here.
  for (const [index, account] of networkConfig.accounts.entries()) {
    const address = account.address;
    const balance = account.balance ?? "0";

    console.log(`Account #${index}: ${address} (${balance} wei)
`);
  }
}

export default function () {
  task(TASK_NODE, "Starts a JSON-RPC server on top of the local QRL network")
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
    .setAction(
      async ({ hostname, port }, { network, hardhatArguments, config }) => {
        if (
          network.name !== HARDHAT_QRLVM_NETWORK_NAME &&
          // We normally set the default network as hardhatArguments.network,
          // so this check isn't enough, and we add the next one. This has the
          // effect of `--network <defaultNetwork>` being a false negative, but
          // not a big deal.
          hardhatArguments.network !== undefined &&
          hardhatArguments.network !== config.defaultNetwork
        ) {
          throw new HardhatError(
            ERRORS.BUILTIN_TASKS.JSONRPC_UNSUPPORTED_NETWORK
          );
        }

        try {
          const serverConfig: JsonRpcServerConfig = {
            hostname,
            port,
            provider: _createHardhatQrlvmProvider(config),
          };

          const server = new JsonRpcServer(serverConfig);

          const { port: actualPort, address } = await server.listen();

          console.log(
            chalk.green(
              `Started HTTP and WebSocket JSON-RPC server at http://${address}:${actualPort}/`
            )
          );

          console.log();

          const networkConfig = config.networks[
            HARDHAT_QRLVM_NETWORK_NAME
          ] as HardhatQrlvmNetworkConfig;
          logHardhatQrlvmAccounts(networkConfig);

          // Graceful shutdown: close the HTTP/WS servers and exit cleanly.
          const shutdown = () => {
            server
              .close()
              .then(() => process.exit(0))
              .catch(() => process.exit(1));
          };
          process.once("SIGINT", shutdown);
          process.once("SIGTERM", shutdown);

          await server.waitUntilClosed();
        } catch (error) {
          if (HardhatError.isHardhatError(error)) {
            throw error;
          }

          throw new HardhatError(
            ERRORS.BUILTIN_TASKS.JSONRPC_SERVER_ERROR,
            {
              error: error.message,
            },
            error
          );
        }
      }
    );
}
