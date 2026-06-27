import { shake256 } from "js-sha3";

import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

const QRL_ADDRESS_REGEX = /^Q[0-9a-fA-F]{128}$/;
const HEX_REGEX = /^(0x)?[0-9a-fA-F]+$/;

export function qrlAddressFromSeed(seed: string): string {
  if (!HEX_REGEX.test(seed)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, {
      address: seed,
    });
  }

  try {
    const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
    return normalizeQrlAddress(seedToAccount(seed).address);
  } catch (_error) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, {
      address: seed,
    });
  }
}

export function isValidQrlAddress(address: string): boolean {
  if (!QRL_ADDRESS_REGEX.test(address)) {
    return false;
  }

  const body = address.slice(1);
  if (body === body.toLowerCase() || body === body.toUpperCase()) {
    return true;
  }

  return address === toQrlChecksumAddress(address);
}

export function toQrlChecksumAddress(address: string): string {
  if (!QRL_ADDRESS_REGEX.test(address)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, { address });
  }

  const body = address.slice(1).toLowerCase();
  const hash = shake256(body, 512);
  let result = "Q";

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    result +=
      /[a-f]/.test(char) && parseInt(hash[i], 16) >= 8
        ? char.toUpperCase()
        : char;
  }

  return result;
}

export function normalizeQrlAddress(address: string): string {
  if (!isValidQrlAddress(address)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, { address });
  }

  return toQrlChecksumAddress(address);
}

export function qrlAddressToBytes(address: string): Uint8Array {
  if (!isValidQrlAddress(address)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, { address });
  }

  return Uint8Array.from(Buffer.from(address.slice(1), "hex"));
}
