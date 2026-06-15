import { IQrlProvider } from "../../../types";
import { HardhatError } from "../errors";
import { ERRORS } from "../errors-list";

export function rpcQuantityToNumber(quantity?: string) {
  if (quantity === undefined) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_RPC_QUANTITY_VALUE, {
      value: quantity,
    });
  }

  if (
    typeof quantity !== "string" ||
    quantity.match(/^0x(?:0|(?:[1-9a-fA-F][0-9a-fA-F]*))$/) === null
  ) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_RPC_QUANTITY_VALUE, {
      value: quantity,
    });
  }

  return parseInt(quantity.substring(2), 16);
}

export function numberToRpcQuantity(n: number) {
  const hex = n.toString(16);
  return `0x${hex}`;
}

export function createChainIdGetter(provider: IQrlProvider) {
  let cachedChainId: number | undefined;

  return async function getRealChainId(): Promise<number> {
    if (cachedChainId === undefined) {
      try {
        const id = await provider.send("qrl_chainId");
        cachedChainId = rpcQuantityToNumber(id);
      } catch (error) {
        // If qrl_chainId fails, fall back to net_version for older QRL nodes.
        const id: string = await provider.send("net_version");
        cachedChainId = id.startsWith("0x")
          ? rpcQuantityToNumber(id)
          : parseInt(id, 10);
      }
    }

    return cachedChainId;
  };
}
