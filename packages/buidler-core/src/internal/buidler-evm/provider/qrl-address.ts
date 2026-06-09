export const QRL_ADDRESS_PREFIX = "Q";
export const QRL_ADDRESS_BYTES = 64;
export const QRL_ADDRESS_HEX_LENGTH = QRL_ADDRESS_BYTES * 2;

const INTERNAL_EVM_ADDRESS_BYTES = 20;
const QRL_ADDRESS_REGEX = /^Q[0-9a-fA-F]{128}$/;

export const QRL_ZERO_ADDRESS = `${QRL_ADDRESS_PREFIX}${"0".repeat(
  QRL_ADDRESS_HEX_LENGTH
)}`;

export function isQrlAddress(address: unknown): address is string {
  return typeof address === "string" && QRL_ADDRESS_REGEX.test(address);
}

export function qrlAddressToInternalBuffer(address: string): Buffer {
  const addressBytes = Buffer.from(
    address.slice(QRL_ADDRESS_PREFIX.length),
    "hex"
  );
  return addressBytes.slice(QRL_ADDRESS_BYTES - INTERNAL_EVM_ADDRESS_BYTES);
}

export function internalBufferToQrlAddress(address: Buffer): string {
  const normalized = Buffer.alloc(QRL_ADDRESS_BYTES);
  const addressBytes = address.slice(-QRL_ADDRESS_BYTES);

  addressBytes.copy(normalized, QRL_ADDRESS_BYTES - addressBytes.length);

  return `${QRL_ADDRESS_PREFIX}${normalized.toString("hex")}`;
}
