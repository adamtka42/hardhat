import { IQrlProvider } from "../../../types";

import { normalizeQrlTransactionQuantities } from "./provider-utils";
import { wrapSend } from "./wrapper";

const QRL_TRANSACTION_METHODS = [
  "qrl_sendTransaction",
  "qrl_call",
  "qrl_estimateGas",
];

export function createQrlTransactionNormalizationProvider(
  provider: IQrlProvider
): IQrlProvider {
  return wrapSend(provider, async (method: string, params: any[]) => {
    if (QRL_TRANSACTION_METHODS.includes(method)) {
      normalizeQrlTransactionQuantities(params[0]);
    }

    return provider.send(method, params);
  });
}
