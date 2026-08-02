import chalk, { Chalk } from "chalk";
import debug from "debug";
import { EventEmitter } from "events";
import fsExtra from "fs-extra";
import path from "path";
import util from "util";

import {
  HardhatQrlvmAccountConfig,
  HardhatQrlvmNetworkConfig,
  IQrlProvider,
  ProjectPaths,
} from "../../../types";
import { HardhatError } from "../../core/errors";
import { ERRORS } from "../../core/errors-list";
import { decodeQrlFunctionResult } from "../../qrl/abi";
import { isValidQrlAddress } from "../../qrl/address";
import {
  buildQrlStackTraceLines,
  loadQrlDebugInfo,
  QrlStackTraceDecoder,
} from "../stack-traces";
import {
  decodeQrlConsoleLog,
  printQrlConsoleLog,
} from "../stack-traces/consoleLogger";
import { Mutex } from "../vendor/await-semaphore";

import {
  BuidlerEVMProviderError,
  MethodNotFoundError,
  MethodNotSupportedError,
} from "./errors";
import { rpcHash, validateParams } from "./input";
import { BuidlerModule } from "./modules/buidler";
import { DebugModule } from "./modules/debug";
import { EvmModule } from "./modules/evm";
import { ModulesLogger } from "./modules/logger";
import { NetModule } from "./modules/net";
import { QrlModule } from "./modules/qrl";
import { Web3Module } from "./modules/web3";
import { HardhatNode } from "./node";
import { numberToRpcQuantity } from "./output";
import { loadQrlJsRuntime } from "./runtime";

interface AnsiEscapes {
  cursorHide: string;
  cursorPrevLine: string;
  eraseEndLine: string;
  cursorShow: string;
}

// tslint:disable-next-line: no-var-requires
const ansiEscapes: AnsiEscapes = require("ansi-escapes");

const log = debug("buidler:core:qrl:stack-traces");

const DEFAULT_CHAIN_ID = 1;
const DEFAULT_BLOCK_GAS_LIMIT = 30000000;

const PRIVATE_RPC_METHODS = new Set(["qrl_getStackTraceFailuresCount"]);

const QRL_EVM_METHODS = new Set([
  "qrl_increaseTime",
  "qrl_setNextBlockTimestamp",
  "qrl_mine",
  "qrl_revert",
  "qrl_snapshot",
]);

export class HardhatQrlvmProvider extends EventEmitter implements IQrlProvider {
  private _node?: HardhatNode;
  private _qrlModule?: QrlModule;
  private _netModule?: NetModule;
  private _web3Module?: Web3Module;
  private _evmModule?: EvmModule;
  private _buidlerModule?: BuidlerModule;
  private _debugModule?: DebugModule;
  private _accounts: string[] = [];
  private readonly _chainId: number;
  private readonly _blockGasLimit: number;
  private _stackTracesEnabled = false;
  private readonly _config: HardhatQrlvmNetworkConfig;
  private readonly _accountConfigs: HardhatQrlvmAccountConfig[];
  private readonly _cachePath?: string;
  private readonly _projectRoot?: string;
  private _stackTraceDecoder?: QrlStackTraceDecoder | null;
  private _stackTraceCacheMtime?: number;
  private readonly _mutex = new Mutex();
  private readonly _logger = new ModulesLogger();
  private readonly _loggingEnabled: boolean;
  private _methodBeingCollapsed?: string;
  private _methodCollapsedCount = 0;
  private _consoleLogMessages: string[] = [];

  constructor(config: HardhatQrlvmNetworkConfig, paths?: ProjectPaths) {
    super();
    this._config = config;
    this._cachePath = paths?.cache;
    this._projectRoot = paths?.root;
    this._chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this._blockGasLimit = config.blockGasLimit ?? DEFAULT_BLOCK_GAS_LIMIT;
    this._accountConfigs = config.accounts ?? [];
    this._loggingEnabled = config.loggingEnabled ?? false;
  }

  public async send(method: string, params: any[] = []): Promise<any> {
    const release = await this._mutex.acquire();

    try {
      if (this._loggingEnabled && !PRIVATE_RPC_METHODS.has(method)) {
        return await this._sendWithLogging(method, params);
      }

      return await this._send(method, params);
    } finally {
      release();
    }
  }

  private async _sendWithLogging(
    method: string,
    params: any[] = []
  ): Promise<any> {
    this._logger.clearLogs();
    this._consoleLogMessages = [];

    try {
      const result = await this._send(method, params);

      if (this._shouldCollapseMethod(method)) {
        this._logCollapsedMethod(method);
      } else {
        this._startCollapsingMethod(method);
        this._log(method, false, chalk.green);
      }

      const loggedSomething = this._logModuleMessages();
      if (loggedSomething) {
        this._stopCollapsingMethod();
        this._log("");
      }

      return result;
    } catch (error) {
      this._stopCollapsingMethod();

      if (
        error instanceof MethodNotFoundError ||
        error instanceof MethodNotSupportedError
      ) {
        this._log(`${method} - Method not supported`, false, chalk.red);
        // tslint:disable-next-line only-hardhat-error
        throw error;
      }

      this._log(method, false, chalk.red);

      const loggedSomething = this._logModuleMessages();
      if (loggedSomething) {
        this._log("");
      }

      if (
        BuidlerEVMProviderError.isBuidlerEVMProviderError(error) ||
        HardhatError.isHardhatError(error)
      ) {
        this._log(error.message, true);
      } else {
        this._logError(error, true);
        this._log("");
        this._log(
          "If you think this is a bug in Hardhat, please report it to the project maintainers.",
          true
        );
      }

      this._log("");
      // tslint:disable-next-line only-hardhat-error
      throw error;
    }
  }

  private _logCollapsedMethod(method: string): void {
    this._methodCollapsedCount += 1;

    process.stdout.write(
      // tslint:disable-next-line:prefer-template
      ansiEscapes.cursorHide +
        ansiEscapes.cursorPrevLine +
        chalk.green(`${method} (${this._methodCollapsedCount})`) +
        "\n" +
        ansiEscapes.eraseEndLine +
        ansiEscapes.cursorShow
    );
  }

  private _startCollapsingMethod(method: string): void {
    this._methodBeingCollapsed = method;
    this._methodCollapsedCount = 1;
  }

  private _stopCollapsingMethod(): void {
    this._methodBeingCollapsed = undefined;
    this._methodCollapsedCount = 0;
  }

  private _shouldCollapseMethod(method: string): boolean {
    return (
      method === this._methodBeingCollapsed &&
      !this._logger.hasLogs() &&
      this._methodCollapsedCount > 0
    );
  }

  private async _send(method: string, params: any[] = []): Promise<any> {
    await this._init();

    try {
      return await this._routeRequest(method, params);
    } catch (error) {
      const enriched = enrichQrlProviderError(error);
      if (this._stackTracesEnabled) {
        try {
          await this._appendStackTrace(enriched);
        } catch (stackTraceError) {
          this._node!.recordStackTraceFailure();
          log("Failed to generate a QRL stack trace: %O", stackTraceError);
          // Stack trace decoding must never mask the original error.
        }
      }
      // tslint:disable-next-line only-hardhat-error
      throw enriched;
    }
  }

  private async _routeRequest(method: string, params: any[]): Promise<any> {
    if (method === "qrl_requestAccounts") {
      return [...this._accounts];
    }

    if (method === "qrl_sign") {
      return this._signWithLocalSeed(params);
    }

    if (method === "qrl_getStackTraceFailuresCount") {
      return this._buidlerModule!.processRequest(method, params);
    }

    if (QRL_EVM_METHODS.has(method)) {
      return this._evmModule!.processRequest(method, params);
    }

    if (method.startsWith("debug_")) {
      return this._debugModule!.processRequest(method, params);
    }

    if (method.startsWith("qrl_")) {
      return this._qrlModule!.processRequest(method, params);
    }

    if (method.startsWith("net_")) {
      return this._netModule!.processRequest(method, params);
    }

    if (method.startsWith("web3_")) {
      return this._web3Module!.processRequest(method, params);
    }

    // tslint:disable-next-line only-hardhat-error
    throw new MethodNotFoundError(`Method ${method} not found`);
  }

  private async _init(): Promise<void> {
    if (this._node !== undefined) {
      return;
    }

    const config = this._config;
    const {
      blockQrl,
      evmQrl,
      stateQrl,
      txQrl,
      utilQrl,
      vmQrl,
    } = loadQrlJsRuntime("hardhatqrlvm", config.qrlJsMonorepoPath);
    const stackTracesSupported =
      typeof (vmQrl as any).createFrameCollector === "function";
    if (config.stackTraces === true && !stackTracesSupported) {
      // tslint:disable-next-line: no-console
      console.warn(
        "The loaded QRL runtime does not support execution tracing. Update the bundled runtime or rebuild the qrljs-monorepo override to enable stack traces."
      );
    }
    this._stackTracesEnabled =
      config.stackTraces !== false && stackTracesSupported;

    const initialTimestamp =
      config.initialDate === undefined
        ? undefined
        : parseInitialDate(config.initialDate);
    const accounts = this._accountConfigs.map((account) => ({
      address: utilQrl.QRLAddress.fromString(account.address),
      balance: parseLocalAccountBalance(account.balance),
      nonce:
        account.nonce === undefined
          ? undefined
          : toRuntimeBigInt(account.nonce),
    }));
    this._accounts = this._accountConfigs.map((account) =>
      normalizeLocalAccountAddress(utilQrl, account)
    );

    const rawTransactionSigner = createRawTransactionSigner(
      utilQrl,
      this._chainId
    );
    const context = {
      chainId: toRuntimeBigInt(this._chainId),
      gasLimit: toRuntimeBigInt(this._blockGasLimit),
      noBaseFee: true,
    };
    const consoleLogListener =
      config.consoleLog === false
        ? undefined
        : (data: Uint8Array) =>
            this._loggingEnabled
              ? this._logConsoleLog(data)
              : printQrlConsoleLog(data);

    const node = await HardhatNode.create(
      { blockQrl, evmQrl, stateQrl, txQrl, vmQrl },
      {
        accounts,
        automine: config.automine ?? true,
        genesisHeader:
          initialTimestamp === undefined
            ? undefined
            : { timestamp: initialTimestamp },
        rawTransactionSigner,
        context,
        allowUnlimitedContractSize: config.allowUnlimitedContractSize,
        consoleLogListener,
      }
    );

    const qrlModuleConfig = {
      chainId: toRuntimeBigInt(this._chainId),
      addressFromBytes: (value: Uint8Array) =>
        utilQrl.QRLAddress.fromBytes(value),
      defaultGasLimit: toRuntimeBigInt(this._blockGasLimit),
      noBaseFee: true,
      createTransaction: (data: Record<string, any>) =>
        new txQrl.QRLDynamicFeeTransaction(data),
      transactionFromSerialized: (data: Uint8Array) =>
        txQrl.QRLDynamicFeeTransaction.fromSerialized(data),
      effectiveGasPrice: (transaction: any, executionContext: any) =>
        vmQrl.effectiveQrlGasPrice(transaction, executionContext),
    };
    this._qrlModule = new QrlModule(
      qrlModuleConfig,
      node,
      config.throwOnTransactionFailures ?? true,
      config.throwOnCallFailures ?? true,
      this._loggingEnabled ? this._logger : undefined,
      this._stackTracesEnabled
    );
    this._debugModule = new DebugModule(qrlModuleConfig, node);
    this._netModule = new NetModule(toRuntimeBigInt(this._chainId));
    this._web3Module = new Web3Module();
    this._evmModule = new EvmModule(node, {
      addressFromBytes: (value: Uint8Array) =>
        utilQrl.QRLAddress.fromBytes(value),
    });
    this._buidlerModule = new BuidlerModule(node);

    const listener = (payload: { filterId: bigint; result: any }) => {
      this.emit("notification", {
        subscription: numberToRpcQuantity(payload.filterId),
        result: payload.result,
      });
    };

    // Handle qrl_subscribe events and proxy them to JSON-RPC/Web3 consumers.
    node.addListener("ethEvent", listener);

    this._node = node;
  }

  private async _appendStackTrace(error: any): Promise<void> {
    if (
      error === undefined ||
      error === null ||
      typeof error.message !== "string" ||
      error.code !== -32000
    ) {
      return;
    }

    let rootFrame = error.traceFrame;
    if (rootFrame === undefined) {
      if (typeof error.transactionHash !== "string") {
        return;
      }
      rootFrame = await this._node!.traceTransactionFrames(
        validateParams([error.transactionHash], rpcHash)[0]
      );
    }

    if (typeof rootFrame?.traceError === "string") {
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

  private _logModuleMessages(): boolean {
    if (this._consoleLogMessages.length > 0) {
      this._logger.log("");
      this._logger.log("console.log:");
      for (const message of this._consoleLogMessages) {
        this._logger.log(`  ${message}`);
      }
      this._consoleLogMessages = [];
    }

    const logs = this._logger.getLogs();
    if (logs.length === 0) {
      return false;
    }

    for (const msg of logs) {
      this._log(msg, true);
    }

    return true;
  }

  private _logConsoleLog(data: Uint8Array): void {
    let line = decodeQrlConsoleLog(data);
    if (line === undefined) {
      const selector =
        data.length >= 4
          ? `0x${Buffer.from(data.slice(0, 4)).toString("hex")}`
          : `0x${Buffer.from(data).toString("hex")}`;
      line = `console.log <unknown selector ${selector}>`;
    }

    this._consoleLogMessages.push(line);
  }

  private _logError(err: Error, logInRed = false): void {
    this._log(util.inspect(err), true, logInRed ? chalk.red : undefined);
  }

  private _log(msg: string, indent = false, color?: Chalk): void {
    if (indent) {
      msg = msg
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
    }

    if (color !== undefined) {
      // tslint:disable-next-line: no-console
      console.log(color(msg));
      return;
    }

    // tslint:disable-next-line: no-console
    console.log(msg);
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
