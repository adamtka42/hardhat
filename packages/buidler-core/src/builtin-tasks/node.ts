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
  config: ResolvedHardhatConfig,
  networkName: string,
  networkConfig: HardhatQrlvmNetworkConfig
): IQrlProvider {
  log("Creating Hardhat QRLVM provider for the JSON-RPC server");

  return lazyObject(() =>
    createProvider(networkName, networkConfig, config.paths)
  );
}

function logHardhatQrlvmAccounts(networkConfig: HardhatQrlvmNetworkConfig) {
  if (networkConfig.accounts === undefined) {
    return;
  }

  // tslint:disable-next-line: no-console
  console.log("Accounts");
  // tslint:disable-next-line: no-console
  console.log("========");

  // Q-addresses and balances ONLY — local accounts carry no key material
  // today, and no secret (seeds included) must ever be printed here.
  for (const [index, account] of networkConfig.accounts.entries()) {
    // tslint:disable-next-line: no-console
    console.log(
      `Account #${index}: ${account.address} (${account.balance ?? "0"} wei)\n`
    );
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
    .setAction(async ({ hostname, port }, { hardhatArguments, config }) => {
      const networkName = HARDHAT_QRLVM_NETWORK_NAME;
      const networkConfig = config.networks[HARDHAT_QRLVM_NETWORK_NAME];

      if (
        hardhatArguments.network !== undefined &&
        hardhatArguments.network !== HARDHAT_QRLVM_NETWORK_NAME
      ) {
        throw new HardhatError(
          ERRORS.BUILTIN_TASKS.JSONRPC_UNSUPPORTED_NETWORK
        );
      }

      if (networkConfig === undefined || "url" in networkConfig) {
        throw new HardhatError(
          ERRORS.BUILTIN_TASKS.JSONRPC_UNSUPPORTED_NETWORK
        );
      }

      try {
        const hardhatQrlvmConfig = networkConfig as HardhatQrlvmNetworkConfig;
        const serverConfig: JsonRpcServerConfig = {
          hostname,
          port,
          provider: _createHardhatQrlvmProvider(
            config,
            networkName,
            hardhatQrlvmConfig
          ),
        };

        const server = new JsonRpcServer(serverConfig);

        const { port: actualPort, address } = await server.listen();

        // tslint:disable-next-line: no-console
        console.log(
          chalk.green(
            `Started HTTP and WebSocket JSON-RPC server at http://${address}:${actualPort}/`
          )
        );

        // tslint:disable-next-line: no-console
        console.log();

        logHardhatQrlvmAccounts(hardhatQrlvmConfig);

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
    });
}
