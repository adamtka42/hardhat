import { EventEmitter } from "events";
import path from "path";

import {
  IQrlProvider,
  QrlLocalAccountConfig,
  QrlLocalNetworkConfig,
} from "../../../types";
import { printQrlConsoleLog } from "../../qrl/console-log";
import { HardhatError } from "../errors";
import { ERRORS } from "../errors-list";

import { numberToRpcQuantity } from "./provider-utils";

const DEFAULT_CHAIN_ID = 1;
const DEFAULT_BLOCK_GAS_LIMIT = 30000000;

interface QrlJsModules {
  vmQrl: any;
  utilQrl: any;
}

export class QrlLocalHardhatProvider extends EventEmitter
  implements IQrlProvider {
  private readonly _provider: any;
  private readonly _accounts: string[];
  private readonly _chainId: number;
  private readonly _blockGasLimit: number;

  constructor(config: QrlLocalNetworkConfig) {
    super();

    const { vmQrl, utilQrl } = loadQrlJsModules(config);
    const consoleLogSupported =
      (vmQrl as any).QRL_CONSOLE_LOG_SUPPORTED === true;
    if (config.consoleLog === true && !consoleLogSupported) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded qrljs-monorepo build does not support contract console logging. Rebuild qrljs-monorepo to enable it."
      );
    }

    const timeControlsSupported =
      (vmQrl as any).QRL_TIME_CONTROLS_SUPPORTED === true;
    if (config.initialDate !== undefined && !timeControlsSupported) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded qrljs-monorepo build does not support time controls. Rebuild qrljs-monorepo to enable initialDate."
      );
    }
    this._chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this._blockGasLimit = config.blockGasLimit ?? DEFAULT_BLOCK_GAS_LIMIT;
    this._accounts = (config.accounts ?? []).map((account) =>
      normalizeLocalAccountAddress(utilQrl, account)
    );

    this._provider = new vmQrl.QRLLocalProvider({
      accounts: (config.accounts ?? []).map((account) => ({
        address: utilQrl.QRLAddress.fromString(account.address),
        balance: parseLocalAccountBalance(account.balance),
        nonce:
          account.nonce === undefined
            ? undefined
            : toRuntimeBigInt(account.nonce),
      })),
      automine: config.automine ?? true,
      initialTimestamp:
        config.initialDate === undefined || !timeControlsSupported
          ? undefined
          : parseInitialDate(config.initialDate),
      defaultContext: {
        chainId: toRuntimeBigInt(this._chainId),
        gasLimit: toRuntimeBigInt(this._blockGasLimit),
        noBaseFee: true,
      },
      onConsoleLog:
        config.consoleLog === false || !consoleLogSupported
          ? undefined
          : (data: Uint8Array) => printQrlConsoleLog(data),
    });
  }

  public async send(method: string, params: any[] = []): Promise<any> {
    if (method.startsWith("eth_")) {
      throw new HardhatError(ERRORS.NETWORK.LEGACY_ETH_RPC_UNSUPPORTED, {
        method,
      });
    }

    switch (method) {
      case "qrl_chainId":
        return numberToRpcQuantity(this._chainId);
      case "qrl_accounts":
      case "qrl_requestAccounts":
        return [...this._accounts];
      case "qrl_gasPrice":
        return "0x0";
      case "qrl_sendRawTransaction":
        throw new HardhatError(ERRORS.GENERAL.UNSUPPORTED_OPERATION, {
          operation: "qrl_sendRawTransaction on qrlLocal",
        });
      default:
        return this._provider.request({ method, params });
    }
  }
}

function loadQrlJsModules(config: QrlLocalNetworkConfig): QrlJsModules {
  const configuredPath =
    config.qrlJsMonorepoPath ?? process.env.QRLJS_MONOREPO_PATH;

  if (configuredPath === undefined) {
    throwQrlJsMonorepoUnavailable(
      "<unset>",
      "qrlLocal requires a built qrljs-monorepo. Set networks.qrlLocal.qrlJsMonorepoPath or QRLJS_MONOREPO_PATH, or run with --network qrl / HARDHAT_DEFAULT_NETWORK=qrl to use an HTTP node"
    );
  }

  const monorepoPath = path.resolve(configuredPath);
  const vmPath = path.join(monorepoPath, "packages/vm/dist/cjs/index.js");
  const utilPath = path.join(monorepoPath, "packages/util/dist/cjs/index.js");

  let vm;
  let util;

  try {
    vm = require(vmPath);
    util = require(utilPath);
  } catch (error) {
    throwQrlJsMonorepoUnavailable(monorepoPath, error.message);
  }

  if (vm.qrl?.QRLLocalProvider === undefined) {
    throwQrlJsMonorepoUnavailable(
      monorepoPath,
      "packages/vm does not export qrl.QRLLocalProvider"
    );
  }

  if (util.qrl?.QRLAddress === undefined) {
    throwQrlJsMonorepoUnavailable(
      monorepoPath,
      "packages/util does not export qrl.QRLAddress"
    );
  }

  return { vmQrl: vm.qrl, utilQrl: util.qrl };
}

function throwQrlJsMonorepoUnavailable(
  monorepoPath: string,
  message: string
): never {
  throw new HardhatError(ERRORS.NETWORK.QRLJS_MONOREPO_UNAVAILABLE, {
    path: monorepoPath,
    network: "qrlLocal",
    message,
  });
}

function normalizeLocalAccountAddress(
  utilQrl: any,
  account: QrlLocalAccountConfig
): string {
  return utilQrl.QRLAddress.fromString(account.address).toString();
}

function parseLocalAccountBalance(balance: string | number | undefined): any {
  if (balance === undefined) {
    return toRuntimeBigInt(0);
  }

  if (typeof balance === "number") {
    return toRuntimeBigInt(balance);
  }

  return toRuntimeBigInt(balance);
}

function toRuntimeBigInt(value: any): any {
  return (global as any).BigInt(value);
}

function parseInitialDate(initialDate: string): any {
  const milliseconds = Date.parse(initialDate);
  if (Number.isNaN(milliseconds)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_INITIAL_DATE, {
      value: initialDate,
    });
  }

  return toRuntimeBigInt(Math.floor(milliseconds / 1000));
}
