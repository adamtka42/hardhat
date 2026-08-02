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

export function rpcQuantityFrom(value: string | number | bigint) {
  if (typeof value === "string") {
    if (value.match(/^0x[0-9a-fA-F]+$/) !== null) {
      return value;
    }

    if (isDecimalRpcQuantity(value)) {
      return `0x${decimalStringToHex(value)}`;
    }

    return value;
  }

  return `0x${value.toString(16)}`;
}

function isDecimalRpcQuantity(value: any): value is string {
  return typeof value === "string" && value.match(/^[0-9]+$/) !== null;
}

function decimalStringToHex(value: string) {
  let digits = value.replace(/^0+/, "");
  if (digits === "") {
    return "0";
  }

  let hex = "";
  while (digits.length > 0) {
    let carry = 0;
    let quotient = "";

    for (const char of digits) {
      const digit = char.charCodeAt(0) - "0".charCodeAt(0);
      const current = carry * 10 + digit;
      const quotientDigit = Math.floor(current / 16);
      carry = current % 16;

      if (quotient !== "" || quotientDigit !== 0) {
        quotient += quotientDigit.toString(10);
      }
    }

    hex = carry.toString(16) + hex;
    digits = quotient;
  }

  return hex;
}

const QRL_TRANSACTION_QUANTITY_FIELDS = [
  "gas",
  "gasLimit",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "value",
  "nonce",
  "chainId",
];

export function normalizeQrlTransactionQuantities(tx: any) {
  if (tx === undefined || tx === null) {
    return;
  }

  for (const field of QRL_TRANSACTION_QUANTITY_FIELDS) {
    const value = tx[field];
    if (
      typeof value === "number" ||
      typeof value === "bigint" ||
      isDecimalRpcQuantity(value)
    ) {
      tx[field] = rpcQuantityFrom(value);
    }
  }
}

export function createChainIdGetter(provider: IQrlProvider) {
  let cachedChainId: number | undefined;

  return async function getRealChainId(): Promise<number> {
    if (cachedChainId === undefined) {
      const id = await provider.send("qrl_chainId");
      cachedChainId = rpcQuantityToNumber(id);
    }

    return cachedChainId;
  };
}
