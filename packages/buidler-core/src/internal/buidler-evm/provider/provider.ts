import debug from "debug";
import { EventEmitter } from "events";
import fsExtra from "fs-extra";
import path from "path";

import {
  HardhatQrlvmAccountConfig,
  HardhatQrlvmNetworkConfig,
  IQrlProvider,
  ProjectPaths,
} from "../../../types";
import { HardhatError } from "../../core/errors";
import { ERRORS } from "../../core/errors-list";
import { numberToRpcQuantity } from "../../core/providers/provider-utils";
import { decodeQrlFunctionResult } from "../../qrl/abi";
import { isValidQrlAddress } from "../../qrl/address";
import {
  buildQrlStackTraceLines,
  loadQrlDebugInfo,
  QrlStackTraceDecoder,
} from "../stack-traces";
import { printQrlConsoleLog } from "../stack-traces/consoleLogger";

import { loadQrlJsRuntime } from "./runtime";

const log = debug("buidler:core:qrl:stack-traces");

const DEFAULT_CHAIN_ID = 1;
const DEFAULT_BLOCK_GAS_LIMIT = 30000000;

export class HardhatQrlvmProvider extends EventEmitter implements IQrlProvider {
  private readonly _provider: any;
  private readonly _accounts: string[];
  private readonly _chainId: number;
  private readonly _blockGasLimit: number;
  private readonly _stackTracesEnabled: boolean;
  private readonly _accountConfigs: HardhatQrlvmAccountConfig[];
  private readonly _cachePath?: string;
  private readonly _projectRoot?: string;
  private _stackTraceDecoder?: QrlStackTraceDecoder | null;
  private _stackTraceCacheMtime?: number;
  private _stackTraceFailures = 0;

  constructor(config: HardhatQrlvmNetworkConfig, paths?: ProjectPaths) {
    super();
    this._cachePath = paths?.cache;
    this._projectRoot = paths?.root;

    const { vmQrl, utilQrl } = loadQrlJsRuntime(
      "hardhatqrlvm",
      config.qrlJsMonorepoPath
    );
    const consoleLogSupported =
      (vmQrl as any).QRL_CONSOLE_LOG_SUPPORTED === true;
    if (config.consoleLog === true && !consoleLogSupported) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded QRL runtime does not support contract console logging. Update the bundled runtime or rebuild the qrljs-monorepo override to enable it."
      );
    }

    const timeControlsSupported =
      (vmQrl as any).QRL_TIME_CONTROLS_SUPPORTED === true;
    if (config.initialDate !== undefined && !timeControlsSupported) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded QRL runtime does not support time controls. Update the bundled runtime or rebuild the qrljs-monorepo override to enable initialDate."
      );
    }

    const txFailureFlagsSupported =
      (vmQrl as any).QRL_TX_FAILURE_FLAGS_SUPPORTED === true;
    if (
      (config.throwOnTransactionFailures !== undefined ||
        config.throwOnCallFailures !== undefined) &&
      !txFailureFlagsSupported
    ) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded QRL runtime does not support transaction failure flags. Update the bundled runtime or rebuild the qrljs-monorepo override to enable them."
      );
    }

    const rpcCompatSupported = (vmQrl as any).QRL_RPC_COMPAT_SUPPORTED === true;
    const rpcCompletionSupported =
      (vmQrl as any).QRL_RPC_COMPLETION_SUPPORTED === true;
    if (
      config.allowUnlimitedContractSize !== undefined &&
      !rpcCompatSupported
    ) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded QRL runtime does not support allowUnlimitedContractSize. Update the bundled runtime or rebuild the qrljs-monorepo override to enable it."
      );
    }
    const debugTraceSupported =
      (vmQrl as any).QRL_DEBUG_TRACE_SUPPORTED === true;
    if (config.stackTraces === true && !debugTraceSupported) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded QRL runtime does not support execution tracing. Update the bundled runtime or rebuild the qrljs-monorepo override to enable stack traces."
      );
    }
    this._stackTracesEnabled =
      config.stackTraces !== false && debugTraceSupported;

    this._chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this._blockGasLimit = config.blockGasLimit ?? DEFAULT_BLOCK_GAS_LIMIT;
    this._accountConfigs = config.accounts ?? [];
    this._accounts = (config.accounts ?? []).map((account) =>
      normalizeLocalAccountAddress(utilQrl, account)
    );

    this._provider = new vmQrl.QRLLocalProvider({
      accounts: (config.accounts ?? []).map((account) => ({
        address: utilQrl.QRLAddress.fromString(account.address),
        balance: parseLocalAccountBalance(account.balance),
        nonce:
          account.nonce === undefined
            ? undefined
            : toRuntimeBigInt(account.nonce),
      })),
      automine: config.automine ?? true,
      initialTimestamp:
        config.initialDate === undefined || !timeControlsSupported
          ? undefined
          : parseInitialDate(config.initialDate),
      throwOnTransactionFailures: config.throwOnTransactionFailures,
      throwOnCallFailures: config.throwOnCallFailures,
      allowUnlimitedContractSize: config.allowUnlimitedContractSize,
      rawTransactionSigner: rpcCompletionSupported
        ? createRawTransactionSigner(utilQrl, this._chainId)
        : undefined,
      defaultContext: {
        chainId: toRuntimeBigInt(this._chainId),
        gasLimit: toRuntimeBigInt(this._blockGasLimit),
        noBaseFee: true,
      },
      onConsoleLog:
        config.consoleLog === false || !consoleLogSupported
          ? undefined
          : (data: Uint8Array) => printQrlConsoleLog(data),
      // qrl_subscribe push notifications surface as EIP-1193-style
      // "notification" events; the standalone WebSocket server forwards
      // them to the owning client connection.
      onSubscriptionEvent: (event: { subscription: string; result: unknown }) =>
        this.emit("notification", event),
    });
  }

  public async send(method: string, params: any[] = []): Promise<any> {
    switch (method) {
      case "qrl_chainId":
        return numberToRpcQuantity(this._chainId);
      case "qrl_accounts":
      case "qrl_requestAccounts":
        return [...this._accounts];
      case "qrl_gasPrice":
        return "0x0";
      case "qrl_getStackTraceFailuresCount":
        return this._stackTraceFailures;
      case "qrl_sign":
        return this._signWithLocalSeed(params);
      default:
        try {
          return await this._provider.request({ method, params });
        } catch (error) {
          const enriched = enrichQrlProviderError(error);
          if (this._stackTracesEnabled) {
            try {
              await this._appendStackTrace(enriched, method, params);
            } catch (stackTraceError) {
              this._stackTraceFailures += 1;
              log("Failed to generate a QRL stack trace: %O", stackTraceError);
              // Stack trace decoding must never mask the original error.
            }
          }
          // Rethrow of the local provider's own error, enriched in place.
          // tslint:disable-next-line only-hardhat-error
          throw enriched;
        }
    }
  }

  private async _appendStackTrace(
    error: any,
    method: string,
    params: any[]
  ): Promise<void> {
    if (
      error === undefined ||
      error === null ||
      typeof error.message !== "string" ||
      error.code !== -32000
    ) {
      return;
    }

    let rootFrame: any;
    if (typeof error.transactionHash === "string") {
      rootFrame = await this._provider.traceTransactionFrames(
        error.transactionHash
      );
    } else if (
      (method === "qrl_call" || method === "qrl_estimateGas") &&
      params[0] !== undefined
    ) {
      rootFrame =
        method === "qrl_estimateGas"
          ? await this._provider.traceEstimateGasFrames(params[0], params[1])
          : await this._provider.traceCallFrames(params[0], params[1]);
    } else {
      return;
    }

    if (typeof rootFrame?.traceError === "string") {
      this._stackTraceFailures += 1;
      log("QRL frame collector failed: %s", rootFrame.traceError);
      return;
    }

    const decoder = this._getStackTraceDecoder();
    if (decoder === undefined) {
      return;
    }

    const lines = await buildQrlStackTraceLines(rootFrame, decoder);
    if (lines.length > 0) {
      error.message = `${error.message}\n${lines.join("\n")}`;
    }
  }

  private async _signWithLocalSeed(params: any[]): Promise<string> {
    const [address, data] = params;
    if (typeof address !== "string" || !isValidQrlAddress(address)) {
      throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ADDRESS, {
        address: String(address),
      });
    }
    if (data === undefined) {
      throw new HardhatError(ERRORS.NETWORK.QRLSIGN_MISSING_DATA_PARAM);
    }
    if (typeof data !== "string" || !QRL_HEX_DATA_REGEX.test(data)) {
      throw new HardhatError(ERRORS.NETWORK.INVALID_HEX_DATA, { value: data });
    }
    const normalizedData =
      data.startsWith("0x") || data.startsWith("0X") ? data.slice(2) : data;
    if (normalizedData.length % 2 !== 0) {
      throw new HardhatError(ERRORS.NETWORK.INVALID_HEX_DATA, { value: data });
    }

    const account = this._accountConfigs.find(
      (candidate) =>
        typeof address === "string" &&
        candidate.address.toLowerCase() === address.toLowerCase()
    );
    if (account === undefined || account.seed === undefined) {
      throw new HardhatError(ERRORS.NETWORK.NOT_LOCAL_ACCOUNT, {
        account: `${address}`,
      });
    }

    const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
    let wallet: any;
    try {
      wallet = seedToAccount(account.seed);
    } catch {
      throw new HardhatError(ERRORS.NETWORK.NOT_LOCAL_ACCOUNT, {
        account: `${address} (the configured seed is invalid)`,
      });
    }
    if (wallet.address.toLowerCase() !== account.address.toLowerCase()) {
      // The configured seed derives a DIFFERENT address — a config mistake
      // that must fail loudly instead of signing as someone else.
      throw new HardhatError(ERRORS.NETWORK.NOT_LOCAL_ACCOUNT, {
        account: `${address} (the configured seed derives ${wallet.address})`,
      });
    }

    return wallet.sign(data).signature;
  }

  private _getStackTraceDecoder(): QrlStackTraceDecoder | undefined {
    if (this._cachePath === undefined) {
      return undefined;
    }

    // Reload when the compile cache changes (or first appears), so a
    // recompilation within the same HRE refreshes the source maps.
    let mtime: number | undefined;
    try {
      mtime = fsExtra.statSync(
        path.join(this._cachePath, "compiler-output.json")
      ).mtimeMs;
    } catch {
      mtime = undefined;
    }

    if (
      this._stackTraceDecoder === undefined ||
      mtime !== this._stackTraceCacheMtime
    ) {
      this._stackTraceCacheMtime = mtime;
      const debugInfo = loadQrlDebugInfo(this._cachePath, this._projectRoot);
      this._stackTraceDecoder =
        debugInfo === undefined ? null : new QrlStackTraceDecoder(debugInfo);
    }
    return this._stackTraceDecoder ?? undefined;
  }
}

const ERROR_STRING_SELECTOR = "0x08c379a0";
const QRL_HEX_DATA_REGEX = /^(0x|0X)?[0-9a-fA-F]*$/;

function createRawTransactionSigner(utilQrl: any, chainId: number): any {
  const accountsEntry = require.resolve("@theqrl/web3-qrl-accounts");
  const {
    addressFromPublicKeyAndDescriptor,
    descriptorFromBytes,
    verifyMLDSA87Signature,
  } = require(path.join(path.dirname(accountsEntry), "qrl_wallet.js"));

  return {
    chainId: toRuntimeBigInt(chainId),
    hash: (tx: any) => tx.getMessageToSign(),
    verify: (tx: any) =>
      verifyMLDSA87Signature(
        tx.signature,
        tx.getMessageToSign(),
        tx.publicKey,
        descriptorFromBytes(tx.descriptor)
      ),
    sender: (tx: any) =>
      utilQrl.QRLAddress.fromBytes(
        Uint8Array.from(
          addressFromPublicKeyAndDescriptor(
            tx.publicKey,
            descriptorFromBytes(tx.descriptor)
          )
        )
      ),
  };
}
const PANIC_SELECTOR = "0x4e487b71";
const PANIC_DESCRIPTIONS: { [code: string]: string } = {
  "0": "generic compiler panic",
  "1": "assertion failed",
  "17": "arithmetic underflow or overflow",
  "18": "division or modulo by zero",
  "33": "invalid enum conversion",
  "34": "incorrectly encoded storage byte array",
  "49": "pop on an empty array",
  "50": "array index out of bounds",
  "65": "too much memory allocated",
  "81": "call to an uninitialized internal function",
};

/**
 * Adds the decoded revert reason and the failed transaction hash to local
 * provider errors, keeping `code`, `data`, and `transactionHash` intact so
 * callers can still decode custom errors and fetch the receipt.
 */
function enrichQrlProviderError(error: any): any {
  if (error === undefined || error === null || typeof error !== "object") {
    return error;
  }

  const details: string[] = [];

  const reason = decodeQrlRevertReason(error.data);
  if (reason !== undefined) {
    details.push(reason);
  }

  if (typeof error.transactionHash === "string") {
    details.push(`tx: ${error.transactionHash}`);
  }

  if (details.length > 0 && typeof error.message === "string") {
    error.message = `${error.message} (${details.join(", ")})`;
  }

  return error;
}

function decodeQrlRevertReason(data: unknown): string | undefined {
  if (typeof data !== "string" || !data.startsWith("0x")) {
    return undefined;
  }

  const body = `0x${data.slice(ERROR_STRING_SELECTOR.length)}`;

  try {
    if (data.startsWith(ERROR_STRING_SELECTOR)) {
      const [reason] = decodeQrlFunctionResult(
        REVERT_REASON_ABI,
        "Error(string)",
        body
      );
      return `reason: '${reason}'`;
    }

    if (data.startsWith(PANIC_SELECTOR)) {
      const [code] = decodeQrlFunctionResult(
        REVERT_PANIC_ABI,
        "Panic(uint256)",
        body
      );
      const description = PANIC_DESCRIPTIONS[code.toString(10)];
      const suffix = description === undefined ? "" : ` (${description})`;
      return `panic code: 0x${code.toString(16)}${suffix}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

// Synthetic fragments reusing the standard QRL ABI machinery, mirroring the
// console-log approach: the revert payload types double as outputs so
// `decodeQrlFunctionResult` can decode the error body.
const REVERT_REASON_ABI = [
  {
    type: "function",
    name: "Error",
    inputs: [{ name: "reason", type: "string" }],
    outputs: [{ name: "reason", type: "string" }],
    stateMutability: "view",
  },
];

const REVERT_PANIC_ABI = [
  {
    type: "function",
    name: "Panic",
    inputs: [{ name: "code", type: "uint256" }],
    outputs: [{ name: "code", type: "uint256" }],
    stateMutability: "view",
  },
];

function normalizeLocalAccountAddress(
  utilQrl: any,
  account: HardhatQrlvmAccountConfig
): string {
  return utilQrl.QRLAddress.fromString(account.address).toString();
}

function parseLocalAccountBalance(balance: string | number | undefined): any {
  if (balance === undefined) {
    return toRuntimeBigInt(0);
  }

  if (typeof balance === "number") {
    return toRuntimeBigInt(balance);
  }

  return toRuntimeBigInt(balance);
}

function toRuntimeBigInt(value: any): any {
  return (global as any).BigInt(value);
}

function parseInitialDate(initialDate: string): any {
  const milliseconds = Date.parse(initialDate);
  if (Number.isNaN(milliseconds)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_INITIAL_DATE, {
      value: initialDate,
    });
  }

  return toRuntimeBigInt(Math.floor(milliseconds / 1000));
}
