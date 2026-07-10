import chalk from "chalk";
import debug from "debug";

import { QRL_LOCAL_NETWORK_NAME } from "../internal/constants";
import { task, types } from "../internal/core/config/config-env";
import { HardhatError } from "../internal/core/errors";
import { ERRORS } from "../internal/core/errors-list";
import { createProvider } from "../internal/core/providers/construction";
import {
  JsonRpcServer,
  JsonRpcServerConfig,
} from "../internal/qrl/jsonrpc/server";
import { lazyObject } from "../internal/util/lazy";
import {
  IQrlProvider,
  QrlLocalNetworkConfig,
  ResolvedHardhatConfig,
} from "../types";

import { TASK_NODE } from "./task-names";

const log = debug("buidler:core:tasks:node");

function _createQrlLocalProvider(
  config: ResolvedHardhatConfig,
  networkName: string,
  networkConfig: QrlLocalNetworkConfig
): IQrlProvider {
  log("Creating qrl-local provider for the JSON-RPC server");

  return lazyObject(() =>
    createProvider(networkName, networkConfig, config.paths)
  );
}

function logQrlLocalAccounts(networkConfig: QrlLocalNetworkConfig) {
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
      // The node always serves a qrl-local network: by default the one
      // named `qrlLocal`; `--network` is accepted only when it names a
      // qrl-local-type network. It never proxies to an HTTP network.
      const networkName =
        hardhatArguments.network !== undefined
          ? hardhatArguments.network
          : QRL_LOCAL_NETWORK_NAME;

      const networkConfig = config.networks[networkName];
      if (
        networkConfig === undefined ||
        (networkConfig as QrlLocalNetworkConfig).type !== "qrl-local"
      ) {
        throw new HardhatError(
          ERRORS.BUILTIN_TASKS.JSONRPC_UNSUPPORTED_NETWORK
        );
      }

      try {
        const qrlLocalConfig = networkConfig as QrlLocalNetworkConfig;
        const serverConfig: JsonRpcServerConfig = {
          hostname,
          port,
          provider: _createQrlLocalProvider(
            config,
            networkName,
            qrlLocalConfig
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

        logQrlLocalAccounts(qrlLocalConfig);

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
