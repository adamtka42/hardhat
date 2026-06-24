import { IQrlProvider } from "../../../types";
import { isValidQrlAddress, normalizeQrlAddress } from "../../qrl/address";
import { HardhatError } from "../errors";
import { ERRORS } from "../errors-list";

import { createChainIdGetter } from "./provider-utils";
import { wrapSend } from "./wrapper";

export interface JsonRpcTransactionData {
  from?: string;
  to?: string;
  gas?: string | number;
  gasLimit?: string | number;
  gasPrice?: string | number;
  maxFeePerGas?: string | number;
  maxPriorityFeePerGas?: string | number;
  value?: string | number;
  data?: string;
  nonce?: string | number;
  chainId?: string | number;
}

// QRL ML-DSA-87 transaction signature descriptor used by local and Ledger signing.
export const ML_DSA_87_DESCRIPTOR = new Uint8Array([0x01, 0x00, 0x00]);
export const EMPTY_EXTRA_PARAMS = new Uint8Array();
const HEX_DATA_REGEX = /^(0x)?[0-9a-fA-F]*$/;

export function createLocalAccountsProvider(
  provider: IQrlProvider,
  extendedSeeds: string[]
) {
  const seeds = [...extendedSeeds];
  const addresses = seeds.map((seed) =>
    normalizeQrlAddress(seedToQrlAccount(seed).address)
  );

  const getChainId = createChainIdGetter(provider);

  function getSeed(address: string): string | undefined {
    for (let i = 0; i < addresses.length; i++) {
      if (addresses[i].toLowerCase() === address.toLowerCase()) {
        return seeds[i];
      }
    }
  }

  return wrapSend(provider, async (method: string, params: any[]) => {
    if (method === "qrl_accounts" || method === "qrl_requestAccounts") {
      return [...addresses];
    }

    if (method === "qrl_sign") {
      const [address, data] = params;

      if (address !== undefined) {
        validateTransactionAddress(address);

        if (data === undefined) {
          throw new HardhatError(ERRORS.NETWORK.QRLSIGN_MISSING_DATA_PARAM);
        }

        validateHexData(data);

        const seed = getSeed(address);

        if (seed === undefined) {
          throw new HardhatError(ERRORS.NETWORK.NOT_LOCAL_ACCOUNT, {
            account: address,
          });
        }

        return signQrlMessage(data, seed);
      }
    }

    if (method === "qrl_sendTransaction" && params.length > 0) {
      const tx: JsonRpcTransactionData = params[0];

      if (tx.gas === undefined && tx.gasLimit === undefined) {
        throw new HardhatError(
          ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
          { param: "gas" }
        );
      }

      if (tx.maxFeePerGas === undefined && tx.gasPrice === undefined) {
        throw new HardhatError(
          ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
          { param: "maxFeePerGas" }
        );
      }

      if (tx.maxPriorityFeePerGas === undefined && tx.gasPrice === undefined) {
        throw new HardhatError(
          ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
          { param: "maxPriorityFeePerGas" }
        );
      }

      validateTransactionAddress(tx.from);
      validateTransactionAddress(tx.to);

      if (tx.from === undefined) {
        throw new HardhatError(
          ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
          { param: "from" }
        );
      }

      if (tx.nonce === undefined) {
        tx.nonce = await provider.send("qrl_getTransactionCount", [
          tx.from,
          "pending",
        ]);
      }

      const seed = getSeed(tx.from);

      if (seed === undefined) {
        throw new HardhatError(ERRORS.NETWORK.NOT_LOCAL_ACCOUNT, {
          account: tx.from,
        });
      }

      const chainId = await getChainId();

      const rawTransaction = await getSignedTransaction(tx, chainId, seed);

      return provider.send("qrl_sendRawTransaction", [rawTransaction]);
    }

    return provider.send(method, params);
  });
}

export function createSenderProvider(provider: IQrlProvider, from?: string) {
  let addresses = from === undefined ? undefined : [normalizeQrlAddress(from)];

  return wrapSend(provider, async (method: string, params: any[]) => {
    if (
      method === "qrl_sendTransaction" ||
      method === "qrl_call" ||
      method === "qrl_estimateGas"
    ) {
      const tx: JsonRpcTransactionData = params[0];

      if (tx !== undefined && tx.from === undefined) {
        const [senderAccount] = await getAccounts();

        if (senderAccount !== undefined) {
          tx.from = senderAccount;
        } else if (method === "qrl_sendTransaction") {
          throw new HardhatError(ERRORS.NETWORK.NO_REMOTE_ACCOUNT_AVAILABLE);
        }
      }

      if (tx !== undefined) {
        validateTransactionAddress(tx.from);
        validateTransactionAddress(tx.to);
      }
    }

    return provider.send(method, params);
  });

  async function getAccounts(): Promise<string[]> {
    if (addresses !== undefined) {
      return addresses;
    }

    addresses = ((await provider.send("qrl_accounts")) as string[]).map(
      normalizeQrlAddress
    );
    return addresses;
  }
}

function validateTransactionAddress(address: string | undefined) {
  if (address !== undefined && !isValidQrlAddress(address)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, { address });
  }
}

function validateHexData(value: string) {
  if (typeof value !== "string" || !HEX_DATA_REGEX.test(value)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_HEX_DATA, { value });
  }

  const normalized =
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (normalized.length % 2 !== 0) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_HEX_DATA, { value });
  }
}

async function getSignedTransaction(
  tx: JsonRpcTransactionData,
  chainId: number,
  seed: string
): Promise<string> {
  const { signTransaction } = require("@theqrl/web3-qrl-accounts");
  const transaction = createQrlDynamicFeeTransaction(tx, chainId);

  const signed = await signTransaction(transaction, seed);
  return signed.rawTransaction;
}

export function createQrlDynamicFeeTransaction(
  tx: JsonRpcTransactionData,
  chainId: number
): any {
  const { FeeMarketEIP1559Transaction } = require("@theqrl/web3-qrl-accounts");
  const data = tx.data ?? "0x";

  validateHexData(data);

  return FeeMarketEIP1559Transaction.fromTxData({
    type: "0x2",
    chainId: tx.chainId ?? chainId,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit ?? tx.gas,
    maxFeePerGas: tx.maxFeePerGas ?? tx.gasPrice,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? tx.gasPrice,
    to: tx.to,
    value: tx.value,
    data,
    accessList: [],
  });
}

export function encodeQrlSignedTransaction(
  transaction: any,
  signature: Uint8Array,
  publicKey: Uint8Array
): string {
  const signed = transaction._processAuthValues(
    ML_DSA_87_DESCRIPTOR,
    EMPTY_EXTRA_PARAMS,
    signature,
    publicKey
  );

  return `0x${Buffer.from(signed.serialize()).toString("hex")}`;
}

function seedToQrlAccount(seed: string): any {
  const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
  return seedToAccount(seed);
}

function signQrlMessage(data: string, seed: string): string {
  return seedToQrlAccount(seed).sign(data).signature;
}
