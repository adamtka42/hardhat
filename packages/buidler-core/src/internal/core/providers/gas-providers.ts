import { IQrlProvider } from "../../../types";

import { numberToRpcQuantity, rpcQuantityToNumber } from "./provider-utils";
import { wrapSend } from "./wrapper";

export const DEFAULT_GAS_MULTIPLIER = 1;

export function createFixedGasProvider(
  provider: IQrlProvider,
  gasLimit: number
) {
  const rpcGasLimit = numberToRpcQuantity(gasLimit);

  return wrapSend(provider, async (method, params) => {
    if (method === "qrl_sendTransaction") {
      const tx = params[0];
      if (tx !== undefined && tx.gas === undefined) {
        tx.gas = rpcGasLimit;
      }
    }

    return provider.send(method, params);
  });
}

export function createFixedGasPriceProvider(
  provider: IQrlProvider,
  gasPrice: number
) {
  const rpcMaxFeePerGas = numberToRpcQuantity(gasPrice);

  return wrapSend(provider, async (method, params) => {
    if (method === "qrl_sendTransaction") {
      const tx = params[0];
      if (tx !== undefined && tx.maxFeePerGas === undefined) {
        tx.maxFeePerGas = rpcMaxFeePerGas;
      }
      if (tx !== undefined && tx.maxPriorityFeePerGas === undefined) {
        tx.maxPriorityFeePerGas = rpcMaxFeePerGas;
      }
      if (tx !== undefined && tx.gasPrice === undefined) {
        tx.gasPrice = rpcMaxFeePerGas;
      }
    }

    return provider.send(method, params);
  });
}

export function createAutomaticGasProvider(
  provider: IQrlProvider,
  gasMultiplier: number = DEFAULT_GAS_MULTIPLIER
) {
  const getMultipliedGasEstimation = createMultipliedGasEstimationGetter();

  return wrapSend(provider, async (method, params) => {
    if (method === "qrl_sendTransaction") {
      const tx = params[0];
      if (tx !== undefined && tx.gas === undefined) {
        tx.gas = await getMultipliedGasEstimation(
          provider,
          params,
          gasMultiplier
        );
      }
    }

    return provider.send(method, params);
  });
}

export function createAutomaticGasPriceProvider(provider: IQrlProvider) {
  let maxFeePerGas: string | undefined;

  return wrapSend(provider, async (method, params) => {
    if (method === "qrl_sendTransaction") {
      const tx = params[0];
      if (
        tx !== undefined &&
        (tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined)
      ) {
        if (maxFeePerGas === undefined) {
          maxFeePerGas = await provider.send("qrl_gasPrice");
        }

        if (tx.maxFeePerGas === undefined) {
          tx.maxFeePerGas = maxFeePerGas;
        }
        if (tx.maxPriorityFeePerGas === undefined) {
          tx.maxPriorityFeePerGas = maxFeePerGas;
        }
        if (tx.gasPrice === undefined) {
          tx.gasPrice = maxFeePerGas;
        }
      }
    }

    return provider.send(method, params);
  });
}

function createMultipliedGasEstimationGetter() {
  // We create this getter this way so this cache is recreated when the BRE
  // is reseted
  let cachedGasLimit: number | undefined;

  async function getBlockGasLimit(provider: IQrlProvider): Promise<number> {
    if (cachedGasLimit === undefined) {
      const latestBlock = await provider.send("qrl_getBlockByNumber", [
        "latest",
        false,
      ]);

      const fetchedGasLimit = rpcQuantityToNumber(latestBlock.gasLimit);

      // For future uses, we store a lower value in case the gas limit varies slightly
      cachedGasLimit = Math.floor(fetchedGasLimit * 0.95);

      return fetchedGasLimit;
    }

    return cachedGasLimit;
  }

  return async function getMultipliedGasEstimation(
    provider: IQrlProvider,
    params: any[],
    gasMultiplier: number
  ): Promise<string> {
    try {
      const realEstimation = await provider.send("qrl_estimateGas", params);

      if (gasMultiplier === 1) {
        return realEstimation;
      }

      const normalGas = rpcQuantityToNumber(realEstimation);
      const gasLimit = await getBlockGasLimit(provider);

      const multiplied = Math.floor(normalGas * gasMultiplier);
      const gas = multiplied > gasLimit ? gasLimit - 1 : multiplied;

      return numberToRpcQuantity(gas);
    } catch (error) {
      if (error.message.toLowerCase().includes("execution error")) {
        const blockGasLimit = await getBlockGasLimit(provider);
        return numberToRpcQuantity(blockGasLimit);
      }

      // tslint:disable-next-line only-hardhat-error
      throw error;
    }
  };
}
