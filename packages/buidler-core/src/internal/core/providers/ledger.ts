import { IQrlProvider, QrlLedgerAccountsConfig } from "../../../types";
import { HardhatError } from "../errors";
import { ERRORS } from "../errors-list";

import {
  createQrlDynamicFeeTransaction,
  EMPTY_EXTRA_PARAMS,
  encodeQrlSignedTransaction,
  JsonRpcTransactionData,
  ML_DSA_87_DESCRIPTOR,
} from "./accounts";
import { createChainIdGetter } from "./provider-utils";
import { wrapSend } from "./wrapper";

const CLA = 0xe0;
const INS_GET_VERSION = 0x03;
const INS_GET_PUBLIC_KEY = 0x05;
const INS_SIGN_TX = 0x06;
const P1_START = 0x00;
const P1_CONFIRM = 0x01;
const P1_MORE_TX = 0x01;
const P1_LAST_TX = 0x02;
const P2_LAST = 0x00;
const STATUS_OK = 0x9000;
const MAX_APDU_SIZE = 255;
const HARDENED_OFFSET = 0x80000000;
const QRL_ADDRESS_RESPONSE_LENGTH = 65;
const DEFAULT_MAX_DERIVATION_ACCOUNTS = 20;
const SIGNATURE_CHUNKS = 18;
const PUBLIC_KEY_CHUNKS = 11;

export interface LedgerTransport {
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer,
    statusList?: number[]
  ): Promise<Buffer | Uint8Array>;
  close?(): Promise<void>;
}

export interface LedgerTransportFactory {
  create(
    openTimeout?: number,
    listenTimeout?: number
  ): Promise<LedgerTransport>;
}

export interface LedgerProviderOptions {
  transportFactory?: LedgerTransportFactory;
}

export function createLedgerAccountsProvider(
  provider: IQrlProvider,
  config: QrlLedgerAccountsConfig,
  options: LedgerProviderOptions = {}
): IQrlProvider {
  const ledgerAccounts = config.accounts.map(normalizeQrlAddress);
  const paths: { [address: string]: string } = {};
  const getChainId = createChainIdGetter(provider);
  const app = new LazyQrlLedgerApp(options.transportFactory);

  function owns(address: string | undefined): boolean {
    return (
      address !== undefined &&
      ledgerAccounts.some(
        (ledgerAccount) => ledgerAccount.toLowerCase() === address.toLowerCase()
      )
    );
  }

  return wrapSend(provider, async (method: string, params: any[]) => {
    if (method === "qrl_accounts" || method === "qrl_requestAccounts") {
      const remoteAccounts = await getRemoteAccounts(provider, method, params);
      return mergeAccounts(remoteAccounts, ledgerAccounts);
    }

    if (method === "qrl_sendTransaction" && params.length > 0) {
      const tx: JsonRpcTransactionData = params[0];

      if (!owns(tx.from)) {
        return provider.send(method, params);
      }

      validateLedgerTransaction(tx);

      if (tx.nonce === undefined) {
        tx.nonce = await provider.send("qrl_getTransactionCount", [
          tx.from,
          "pending",
        ]);
      }

      const chainId = await getChainId();
      const transaction = createQrlDynamicFeeTransaction(tx, chainId);
      const path = await getPathForAccount(app, config, paths, tx.from!);
      const unsignedTx = transaction.getMessageToSign(
        ML_DSA_87_DESCRIPTOR,
        EMPTY_EXTRA_PARAMS,
        false
      );
      const publicKey = await app.getPublicKey(path);
      const signature = await app.signTransaction(path, unsignedTx);
      const rawTransaction = encodeQrlSignedTransaction(
        transaction,
        signature,
        publicKey
      );

      return provider.send("qrl_sendRawTransaction", [rawTransaction]);
    }

    return provider.send(method, params);
  });
}

async function getRemoteAccounts(
  provider: IQrlProvider,
  method: string,
  params: any[]
): Promise<string[]> {
  try {
    const result = await provider.send(method, params);
    return Array.isArray(result) ? result : [];
  } catch (_error) {
    return [];
  }
}

function mergeAccounts(remoteAccounts: string[], ledgerAccounts: string[]) {
  const result = [...remoteAccounts];
  for (const ledgerAccount of ledgerAccounts) {
    if (
      !result.some(
        (account) => account.toLowerCase() === ledgerAccount.toLowerCase()
      )
    ) {
      result.push(ledgerAccount);
    }
  }
  return result;
}

function validateLedgerTransaction(tx: JsonRpcTransactionData) {
  if (tx.gas === undefined && tx.gasLimit === undefined) {
    throw new HardhatError(ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY, {
      param: "gas",
    });
  }

  if (tx.maxFeePerGas === undefined && tx.gasPrice === undefined) {
    throw new HardhatError(ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY, {
      param: "maxFeePerGas",
    });
  }

  if (tx.maxPriorityFeePerGas === undefined && tx.gasPrice === undefined) {
    throw new HardhatError(ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY, {
      param: "maxPriorityFeePerGas",
    });
  }
}

async function getPathForAccount(
  app: LazyQrlLedgerApp,
  config: QrlLedgerAccountsConfig,
  paths: { [address: string]: string },
  address: string
): Promise<string> {
  const normalizedAddress = normalizeQrlAddress(address);
  const cacheKey = normalizedAddress.toLowerCase();

  if (paths[cacheKey] !== undefined) {
    return paths[cacheKey];
  }

  const maxAccounts =
    config.maxDerivationAccounts ?? DEFAULT_MAX_DERIVATION_ACCOUNTS;

  for (let index = 0; index <= maxAccounts; index++) {
    const path =
      config.derivationFunction !== undefined
        ? config.derivationFunction(index)
        : getDefaultDerivationPath(index);
    const derivedAddress = await app.getAddress(path);

    if (derivedAddress.toLowerCase() === normalizedAddress.toLowerCase()) {
      paths[cacheKey] = path;
      return path;
    }
  }

  throw new HardhatError(ERRORS.NETWORK.LEDGER_ACCOUNT_NOT_FOUND, {
    account: address,
  });
}

class LazyQrlLedgerApp {
  private _transportFactory?: LedgerTransportFactory;
  private _transport?: LedgerTransport;

  constructor(transportFactory?: LedgerTransportFactory) {
    this._transportFactory = transportFactory;
  }

  public async getAddress(path: string): Promise<string> {
    const response = await this._send(
      INS_GET_PUBLIC_KEY,
      P1_START,
      P2_LAST,
      packDerivationPath(path)
    );
    return parseAddress(response);
  }

  public async getPublicKey(path: string): Promise<Uint8Array> {
    await this._send(
      INS_GET_PUBLIC_KEY,
      P1_START,
      0x00,
      packDerivationPath(path)
    );

    const chunks: Uint8Array[] = [];
    for (let chunkIndex = 0; chunkIndex < PUBLIC_KEY_CHUNKS; chunkIndex++) {
      chunks.push(
        await this._send(
          INS_GET_PUBLIC_KEY,
          P1_START,
          chunkIndex + 1,
          Buffer.alloc(0)
        )
      );
    }
    return concatBytes(chunks);
  }

  public async signTransaction(
    path: string,
    unsignedTx: Uint8Array
  ): Promise<Uint8Array> {
    await this._send(INS_SIGN_TX, P1_START, 0x00, packDerivationPath(path));

    const chunks = splitIntoChunks(unsignedTx, MAX_APDU_SIZE);
    for (const chunk of chunks.slice(0, -1)) {
      await this._send(INS_SIGN_TX, P1_MORE_TX, 0x00, Buffer.from(chunk));
    }

    const signatureChunks: Uint8Array[] = [
      await this._send(
        INS_SIGN_TX,
        P1_LAST_TX,
        0x00,
        Buffer.from(chunks[chunks.length - 1])
      ),
    ];

    for (let chunkIndex = 1; chunkIndex < SIGNATURE_CHUNKS; chunkIndex++) {
      signatureChunks.push(
        await this._send(INS_SIGN_TX, P1_LAST_TX, chunkIndex, Buffer.alloc(0))
      );
    }

    return concatBytes(signatureChunks);
  }

  private async _send(
    ins: number,
    p1: number,
    p2: number,
    data: Buffer
  ): Promise<Uint8Array> {
    const transport = await this._getTransport();
    const response = await transport.send(CLA, ins, p1, p2, data, [STATUS_OK]);
    return toUint8Array(response);
  }

  private async _getTransport(): Promise<LedgerTransport> {
    if (this._transport !== undefined) {
      return this._transport;
    }

    if (this._transportFactory === undefined) {
      this._transportFactory = loadTransportFactory();
    }

    this._transport = await this._transportFactory.create(3000, 3000);
    await this._send(INS_GET_VERSION, P1_START, P2_LAST, Buffer.alloc(0));
    return this._transport;
  }
}

function loadTransportFactory(): LedgerTransportFactory {
  const speculosUrl = process.env.QRL_HARDHAT_LEDGER_SPECULOS_URL;
  if (speculosUrl !== undefined && speculosUrl !== "") {
    return new SpeculosTransportFactory(speculosUrl);
  }

  try {
    const transportPackage = "@ledgerhq/hw-transport-node-hid";
    return require(transportPackage).default;
  } catch (error) {
    throw new HardhatError(ERRORS.NETWORK.LEDGER_TRANSPORT_UNAVAILABLE, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

class SpeculosTransportFactory implements LedgerTransportFactory {
  private readonly _baseUrl: string;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl.replace(/\/$/, "");
  }

  public async create(): Promise<LedgerTransport> {
    const transport = new SpeculosTransport(this._baseUrl);
    await transport.connect();
    return transport;
  }
}

class SpeculosTransport implements LedgerTransport {
  private readonly _baseUrl: string;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  public async connect(): Promise<void> {
    const response = await this._fetch(`${this._baseUrl}/events`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new HardhatError(ERRORS.NETWORK.LEDGER_INVALID_RESPONSE, {
        message: `Speculos responded with status ${response.status}`,
      });
    }
  }

  public async send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Buffer = Buffer.alloc(0)
  ): Promise<Buffer> {
    if (
      ins === INS_SIGN_TX &&
      p1 === P1_LAST_TX &&
      p2 === 0 &&
      process.env.QRL_HARDHAT_LEDGER_SPECULOS_AUTO_APPROVE === "1"
    ) {
      this._autoApprove();
    }

    const apdu = Buffer.alloc(5 + data.length);
    apdu[0] = cla;
    apdu[1] = ins;
    apdu[2] = p1;
    apdu[3] = p2;
    apdu[4] = data.length;
    data.copy(apdu, 5);

    const response = await this._fetch(`${this._baseUrl}/apdu`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: apdu.toString("hex") }),
    });

    if (!response.ok) {
      throw new HardhatError(ERRORS.NETWORK.LEDGER_INVALID_RESPONSE, {
        message: `Speculos APDU failed with status ${response.status}`,
      });
    }

    const result = await response.json();
    const responseData = Buffer.from(result.data, "hex");

    if (responseData.length < 2) {
      throw new HardhatError(ERRORS.NETWORK.LEDGER_INVALID_RESPONSE, {
        message: "Speculos APDU response is too short",
      });
    }

    const status = responseData.readUInt16BE(responseData.length - 2);
    if (status !== STATUS_OK) {
      throw new HardhatError(ERRORS.NETWORK.LEDGER_INVALID_RESPONSE, {
        message: `Speculos APDU status 0x${status.toString(16)}`,
      });
    }

    return responseData.slice(0, responseData.length - 2);
  }

  private _autoApprove() {
    setTimeout(async () => {
      try {
        const screens = Number(
          process.env.QRL_HARDHAT_LEDGER_SPECULOS_APPROVE_SCREENS ?? "40"
        );
        for (let i = 0; i < screens; i++) {
          const eventText = await this._getEventText();
          if (eventText.includes("Sign transaction")) {
            await this._pressButton("both");
            return;
          }
          await this._pressButton("right");
          await sleep(250);
        }
      } catch (_error) {}
    }, 500);
  }

  private async _getEventText(): Promise<string> {
    const response = await this._fetch(`${this._baseUrl}/events`, {
      method: "GET",
    });

    if (!response.ok) {
      return "";
    }

    const result = await response.json();
    return Array.isArray(result.events)
      ? result.events
          .slice(-5)
          .map((event: { text?: string }) => event.text ?? "")
          .join("\n")
      : "";
  }

  private async _pressButton(button: "right" | "both") {
    await this._fetch(`${this._baseUrl}/button/${button}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "press-and-release" }),
    });
  }

  private async _fetch(url: string, init: any): Promise<any> {
    const fetch = require("node-fetch");
    return fetch(url, init);
  }
}

function getDefaultDerivationPath(index: number): string {
  return `m/44'/238'/0'/0/${index}`;
}

function packDerivationPath(path: string): Buffer {
  const parts = path.replace(/^m\//, "").split("/");
  if (parts.length !== 5) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_HD_PATH, { path });
  }

  const buffer = Buffer.alloc(21);
  buffer.writeUInt8(5, 0);

  parts.forEach((part, index) => {
    const hardened = part.endsWith("'");
    const parsed = Number.parseInt(part.replace("'", ""), 10);

    if (!Number.isSafeInteger(parsed)) {
      throw new HardhatError(ERRORS.NETWORK.INVALID_HD_PATH, { path });
    }

    buffer.writeUInt32BE(
      hardened ? parsed + HARDENED_OFFSET : parsed,
      1 + index * 4
    );
  });

  return buffer;
}

function parseAddress(response: Uint8Array): string {
  if (
    response.length < QRL_ADDRESS_RESPONSE_LENGTH ||
    response[0] !== "Q".charCodeAt(0)
  ) {
    throw new HardhatError(ERRORS.NETWORK.LEDGER_INVALID_RESPONSE, {
      message: `Invalid QRL address response length ${response.length}`,
    });
  }

  return normalizeQrlAddress(
    `Q${Buffer.from(response.slice(1, QRL_ADDRESS_RESPONSE_LENGTH)).toString(
      "hex"
    )}`
  );
}

function normalizeQrlAddress(address: string): string {
  if (!/^Q[0-9a-fA-F]{128}$/.test(address)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, { address });
  }

  return address;
}

function splitIntoChunks(message: Uint8Array, maxSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < message.length; offset += maxSize) {
    chunks.push(message.slice(offset, offset + maxSize));
  }

  return chunks.length === 0 ? [new Uint8Array()] : chunks;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function toUint8Array(value: Buffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
