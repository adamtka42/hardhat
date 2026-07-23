import {
  HttpNetworkConfig,
  IQrlProvider,
  NetworkConfig,
  ProjectPaths,
  QrlLocalNetworkConfig,
  QrlProvider,
} from "../../../types";

import { HttpProvider } from "./http";
import { QrlLocalHardhatProvider } from "./qrl-local";

export function createProvider(
  networkName: string,
  networkConfig: NetworkConfig,
  paths?: ProjectPaths
): IQrlProvider {
  let provider: QrlProvider;

  if (isQrlLocalNetworkConfig(networkConfig)) {
    provider = new QrlLocalHardhatProvider(networkConfig, paths);
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
  const {
    createQrlTransactionNormalizationProvider,
  } = require("./transactions");

  const isHttpNetworkConfig = "url" in netConfig;
  const isLocalNetworkConfig = isQrlLocalNetworkConfig(netConfig);

  if (isHttpNetworkConfig && !isLocalNetworkConfig) {
    const httpNetConfig = netConfig as Partial<HttpNetworkConfig>;

    const accounts = httpNetConfig.accounts;
    if (Array.isArray(accounts)) {
      provider = createLocalAccountsProvider(provider, accounts);
    }
  }

  provider = createSenderProvider(provider, netConfig.from);
  provider = createQrlTransactionNormalizationProvider(provider);

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
