import {
  InvalidArgumentsError,
  InvalidInputError,
  MethodNotFoundError,
} from "../errors";
import {
  OptionalBlockTag,
  optionalBlockTag,
  rpcCallRequest,
  RpcCallRequest,
  rpcHash,
  validateParams,
} from "../input";
import { CallParams, HardhatNode, QrlTraceConfig } from "../node";

export interface DebugModuleConfig {
  chainId: bigint;
  addressFromBytes: (value: Uint8Array) => any;
  defaultGasLimit: bigint;
  noBaseFee?: boolean;
  createTransaction: (data: Record<string, any>) => any;
  effectiveGasPrice: (transaction: any, context: Record<string, any>) => bigint;
}

// tslint:disable only-hardhat-error

export class DebugModule {
  constructor(
    private readonly _config: DebugModuleConfig,
    private readonly _node: HardhatNode
  ) {}

  public async processRequest(
    method: string,
    params: any[] = []
  ): Promise<any> {
    switch (method) {
      case "debug_traceCall":
        return this._traceCallAction(...this._traceCallParams(params));

      case "debug_traceTransaction":
        return this._traceTransactionAction(
          ...this._traceTransactionParams(params)
        );
    }

    throw new MethodNotFoundError(`Method ${method} not found`);
  }

  private _traceCallParams(
    params: any[]
  ): [RpcCallRequest, OptionalBlockTag, QrlTraceConfig] {
    if (params.length < 1 || params.length > 3) {
      throw new InvalidArgumentsError(
        "debug_traceCall expects a call, optional block tag, and optional config"
      );
    }
    const [request, blockTag] = validateParams(
      params.slice(0, 2),
      rpcCallRequest,
      optionalBlockTag
    );
    return [request, blockTag, parseTraceConfig(params[2])];
  }

  private async _traceCallAction(
    request: RpcCallRequest,
    blockTag: OptionalBlockTag,
    traceConfig: QrlTraceConfig
  ): Promise<any> {
    this._validateStateBlockTag(blockTag);
    const call = await this._createCall(request, blockTag === "pending");
    return this._node.debugTraceCall(call, traceConfig, {
      usePendingState: blockTag === "pending",
    });
  }

  private _traceTransactionParams(params: any[]): [Uint8Array, QrlTraceConfig] {
    if (params.length < 1 || params.length > 2) {
      throw new InvalidArgumentsError(
        "debug_traceTransaction expects a hash and optional config"
      );
    }
    const [hash] = validateParams([params[0]], rpcHash);
    return [hash, parseTraceConfig(params[1])];
  }

  private async _traceTransactionAction(
    hash: Uint8Array,
    traceConfig: QrlTraceConfig
  ): Promise<any> {
    return this._node.debugTraceTransaction(hash, traceConfig);
  }

  private async _createCall(
    request: RpcCallRequest,
    usePendingState: boolean
  ): Promise<CallParams> {
    if (request.from === undefined) {
      throw new InvalidArgumentsError(
        "debug_traceCall requires a QRL from address"
      );
    }
    if (request.to === undefined) {
      throw new InvalidArgumentsError(
        "debug_traceCall requires a QRL to address"
      );
    }

    const sender = this._config.addressFromBytes(request.from);
    const nonce = usePendingState
      ? await this._node.getPendingAccountNonce(sender)
      : await this._node.getAccountNonce(sender);
    const gasLimit = resolveGasLimit(request, this._config.defaultGasLimit);
    const transaction = this._config.createTransaction({
      chainId: this._config.chainId,
      nonce,
      gasTipCap: request.maxPriorityFeePerGas ?? (global as any).BigInt(0),
      gasFeeCap: request.maxFeePerGas ?? (global as any).BigInt(0),
      gasLimit,
      to: this._config.addressFromBytes(request.to),
      value: request.value ?? (global as any).BigInt(0),
      data: request.data ?? new Uint8Array(0),
    });
    const latestBlock = await this._node.getLatestBlock();
    const gasPrice = this._config.effectiveGasPrice(transaction, {
      chainId: this._config.chainId,
      baseFee: latestBlock.header.baseFee,
      coinbase: await this._node.getCoinbaseAddress(),
      blockNumber: latestBlock.header.number,
      timestamp: latestBlock.header.timestamp,
      gasLimit: await this._node.getBlockGasLimit(),
      noBaseFee: this._config.noBaseFee ?? true,
    });

    return {
      to: transaction.to,
      from: sender,
      gasLimit: transaction.gasLimit,
      gasPrice,
      value: transaction.value,
      data: transaction.data,
    };
  }

  private _validateStateBlockTag(blockTag: OptionalBlockTag): void {
    if (
      blockTag !== undefined &&
      blockTag !== "latest" &&
      blockTag !== "pending"
    ) {
      throw new InvalidInputError(
        `Received unsupported QRL state block param ${blockTag.toString()}. Only latest and pending are supported.`
      );
    }
  }
}

function resolveGasLimit(
  request: RpcCallRequest,
  defaultGasLimit: bigint
): bigint {
  if (
    request.gas !== undefined &&
    request.gasLimit !== undefined &&
    request.gas !== request.gasLimit
  ) {
    throw new InvalidArgumentsError("QRL gas and gasLimit cannot differ");
  }
  return request.gas ?? request.gasLimit ?? defaultGasLimit;
}

function parseTraceConfig(raw: unknown): QrlTraceConfig {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidArgumentsError("trace config must be an object");
  }

  const config: any = raw;
  if (config.tracer !== undefined) {
    throw new InvalidArgumentsError("custom tracers are not supported");
  }
  if (config.disableStorage === false) {
    throw new InvalidArgumentsError("storage capture is not supported");
  }
  validateOptionalBoolean(config, "disableStack");
  validateOptionalBoolean(config, "enableMemory");
  validateOptionalBoolean(config, "disableStorage");

  return {
    disableStack: config.disableStack === true,
    enableMemory: config.enableMemory === true,
    limit: parseTraceLimit(config.limit),
  };
}

function validateOptionalBoolean(
  config: Record<string, unknown>,
  name: string
): void {
  if (config[name] !== undefined && typeof config[name] !== "boolean") {
    throw new InvalidArgumentsError(`${name} must be a boolean`);
  }
}

function parseTraceLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  let limit: number;
  if (typeof value === "number") {
    limit = value;
  } else if (
    typeof value === "string" &&
    (/^0x[0-9a-fA-F]+$/.test(value) || /^[0-9]+$/.test(value))
  ) {
    limit = Number((global as any).BigInt(value));
  } else {
    throw new InvalidArgumentsError(
      "trace limit must be a non-negative integer"
    );
  }

  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new InvalidArgumentsError(
      "trace limit must be a non-negative integer"
    );
  }
  return limit;
}
