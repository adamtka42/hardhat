import {
  HttpNetworkConfig,
  IQrlProvider,
  NetworkConfig,
  QrlLocalNetworkConfig,
  QrlProvider,
} from "../../../types";
import { LEGACY_IN_MEMORY_NETWORK_NAME } from "../../constants";
import { HardhatError } from "../errors";
import { ERRORS } from "../errors-list";

import { HttpProvider } from "./http";
import { QrlLocalHardhatProvider } from "./qrl-local";

export function createProvider(
  networkName: string,
  networkConfig: NetworkConfig
): IQrlProvider {
  let provider: QrlProvider;

  if (networkName === LEGACY_IN_MEMORY_NETWORK_NAME) {
    throw new HardhatError(ERRORS.NETWORK.QRL_IN_MEMORY_NODE_UNSUPPORTED);
  }

  if (isQrlLocalNetworkConfig(networkConfig)) {
    provider = new QrlLocalHardhatProvider(networkConfig);
    return wrapQrlProvider(provider, networkConfig);
  }

  const httpNetConfig = networkConfig as HttpNetworkConfig;

  provider = new HttpProvider(
    httpNetConfig.url!,
    networkName,
    httpNetConfig.httpHeaders,
    httpNetConfig.timeout
  );

  return wrapQrlProvider(provider, networkConfig);
}

export function wrapQrlProvider(
  provider: IQrlProvider,
  netConfig: Partial<NetworkConfig>
): IQrlProvider {
  // These dependencies are lazy-loaded because they are really big.
  // We use require() instead of import() here, because we need it to be sync.

  const {
    createLocalAccountsProvider,
    createSenderProvider,
  } = require("./accounts");

  const {
    createAutomaticGasPriceProvider,
    createAutomaticGasProvider,
    createFixedGasPriceProvider,
    createFixedGasProvider,
  } = require("./gas-providers");

  const { createChainIdValidationProvider } = require("./chainId");

  const isHttpNetworkConfig = "url" in netConfig;
  const isLocalNetworkConfig = isQrlLocalNetworkConfig(netConfig);

  if (isHttpNetworkConfig && !isLocalNetworkConfig) {
    const httpNetConfig = netConfig as Partial<HttpNetworkConfig>;

    const accounts = httpNetConfig.accounts;
    if (Array.isArray(accounts)) {
      provider = createLocalAccountsProvider(provider, accounts);
    } else if (isLedgerAccountsConfig(accounts)) {
      const { createLedgerAccountsProvider } = require("./ledger");
      provider = createLedgerAccountsProvider(provider, accounts);
    }
  }

  provider = createSenderProvider(provider, netConfig.from);

  if (netConfig.gas === undefined || netConfig.gas === "auto") {
    provider = createAutomaticGasProvider(provider, netConfig.gasMultiplier);
  } else {
    provider = createFixedGasProvider(provider, netConfig.gas);
  }

  if (netConfig.gasPrice === undefined || netConfig.gasPrice === "auto") {
    provider = createAutomaticGasPriceProvider(provider);
  } else {
    provider = createFixedGasPriceProvider(provider, netConfig.gasPrice);
  }

  if (isHttpNetworkConfig) {
    if (netConfig.chainId !== undefined) {
      return createChainIdValidationProvider(provider, netConfig.chainId);
    }
  }

  return provider;
}

function isQrlLocalNetworkConfig(
  netConfig: Partial<NetworkConfig>
): netConfig is QrlLocalNetworkConfig {
  return (netConfig as any).type === "qrl-local";
}

function isLedgerAccountsConfig(accounts: any): boolean {
  return (
    accounts !== undefined &&
    accounts !== null &&
    typeof accounts === "object" &&
    accounts.type === "ledger"
  );
}
