import { EventEmitter } from "events";
import path from "path";

import {
  IQrlProvider,
  QrlLocalAccountConfig,
  QrlLocalNetworkConfig,
} from "../../../types";
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
      defaultContext: {
        chainId: toRuntimeBigInt(this._chainId),
        gasLimit: toRuntimeBigInt(this._blockGasLimit),
        noBaseFee: true,
      },
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
      case "qrl_estimateGas":
        return this._estimateGas(params);
      case "qrl_sendRawTransaction":
        throw new HardhatError(ERRORS.GENERAL.UNSUPPORTED_OPERATION, {
          operation: "qrl_sendRawTransaction on qrlLocal",
        });
      default:
        return this._provider.request({ method, params });
    }
  }

  private _estimateGas(params: any[]): string {
    const tx = params[0];
    const requestedGas = tx?.gas ?? tx?.gasLimit;

    if (requestedGas !== undefined) {
      return normalizeRpcQuantity(requestedGas);
    }

    return numberToRpcQuantity(this._blockGasLimit);
  }
}

function loadQrlJsModules(config: QrlLocalNetworkConfig): QrlJsModules {
  const configuredPath =
    config.qrlJsMonorepoPath ?? process.env.QRLJS_MONOREPO_PATH;

  if (configuredPath === undefined) {
    throwQrlJsMonorepoUnavailable(
      "<unset>",
      "set networks.qrlLocal.qrlJsMonorepoPath or QRLJS_MONOREPO_PATH"
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

function normalizeRpcQuantity(value: string | number): string {
  if (typeof value === "number") {
    return numberToRpcQuantity(value);
  }

  if (value.startsWith("0x") || value.startsWith("0X")) {
    return `0x${toRuntimeBigInt(value).toString(16)}`;
  }

  return `0x${toRuntimeBigInt(value).toString(16)}`;
}
