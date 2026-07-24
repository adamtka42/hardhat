import {
  HardhatQrlvmNetworkConfig,
  HttpNetworkConfig,
  IQrlProvider,
  NetworkConfig,
  ProjectPaths,
  QrlProvider,
} from "../../../types";
import { HARDHAT_QRLVM_NETWORK_NAME } from "../../constants";

import { HardhatQrlvmProvider } from "./hardhat-qrlvm";
import { HttpProvider } from "./http";

export function createProvider(
  networkName: string,
  networkConfig: NetworkConfig,
  paths?: ProjectPaths
): IQrlProvider {
  let provider: QrlProvider;

  if (networkName === HARDHAT_QRLVM_NETWORK_NAME) {
    const hardhatQrlvmConfig = networkConfig as HardhatQrlvmNetworkConfig;
    provider = new HardhatQrlvmProvider(hardhatQrlvmConfig, paths);
  } else {
    const httpNetConfig = networkConfig as HttpNetworkConfig;

    provider = new HttpProvider(
      httpNetConfig.url!,
      networkName,
      httpNetConfig.httpHeaders,
      httpNetConfig.timeout
    );
  }

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

  if (isHttpNetworkConfig) {
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
