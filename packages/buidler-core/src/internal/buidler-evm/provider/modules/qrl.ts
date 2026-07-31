import { Block } from "../blockchain";
import {
  InvalidArgumentsError,
  InvalidInputError,
  MethodNotFoundError,
  QrlExecutionError,
} from "../errors";
import { parseLogFilter, QRLLogFilter } from "../filter";
import {
  BlockTag,
  blockTag as rpcBlockTag,
  OptionalBlockTag,
  optionalBlockTag,
  optionalBoolean,
  rpcAddress,
  rpcCallRequest,
  RpcCallRequest,
  rpcData,
  rpcHash,
  rpcQuantity,
  rpcStorageKey,
  rpcSubscribeRequest,
  RpcSubscribeRequest,
  rpcTransactionRequest,
  RpcTransactionRequest,
  validateParams,
} from "../input";
import { CallParams, HardhatNode } from "../node";
import {
  bufferToRpcData,
  getRpcBlock,
  getRpcTransaction,
  getRpcTransactionReceipt,
  numberToRpcQuantity,
  RpcBlockOutput,
  RpcLogOutput,
  RpcTransactionOutput,
  RpcTransactionReceiptOutput,
} from "../output";

import { ModulesLogger } from "./logger";

export interface QrlModuleConfig {
  chainId: bigint;
  addressFromBytes: (value: Uint8Array) => any;
  defaultGasLimit: bigint;
  noBaseFee?: boolean;
  createTransaction: (data: Record<string, any>) => any;
  transactionFromSerialized: (data: Uint8Array) => any;
  effectiveGasPrice: (transaction: any, context: Record<string, any>) => bigint;
}

interface QrlExecutionRequest {
  from?: Uint8Array;
  to?: Uint8Array;
  gas?: bigint;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  value?: bigint;
  data?: Uint8Array;
  nonce?: bigint;
}

// tslint:disable only-hardhat-error

export class QrlModule {
  constructor(
    private readonly _config: QrlModuleConfig,
    private readonly _node: HardhatNode,
    private readonly _throwOnTransactionFailures: boolean = true,
    private readonly _throwOnCallFailures: boolean = true,
    private readonly _logger?: ModulesLogger,
    private readonly _stackTracesEnabled: boolean = false
  ) {}

  public async processRequest(
    method: string,
    params: any[] = []
  ): Promise<any> {
    switch (method) {
      case "qrl_accounts":
        return this._accountsAction(...this._accountsParams(params));

      case "qrl_blockNumber":
        return this._blockNumberAction(...this._blockNumberParams(params));

      case "qrl_call":
        return this._callAction(...this._callParams(params));

      case "qrl_chainId":
        return this._chainIdAction(...this._chainIdParams(params));

      case "qrl_coinbase":
        return this._coinbaseAction(...this._coinbaseParams(params));

      case "qrl_estimateGas":
        return this._estimateGasAction(...this._estimateGasParams(params));

      case "qrl_gasPrice":
        return this._gasPriceAction(...this._gasPriceParams(params));

      case "qrl_getBalance":
        return this._getBalanceAction(...this._getBalanceParams(params));

      case "qrl_getBlockByHash":
        return this._getBlockByHashAction(
          ...this._getBlockByHashParams(params)
        );

      case "qrl_getBlockByNumber":
        return this._getBlockByNumberAction(
          ...this._getBlockByNumberParams(params)
        );

      case "qrl_getBlockTransactionCountByHash":
        return this._getBlockTransactionCountByHashAction(
          ...this._getBlockTransactionCountByHashParams(params)
        );

      case "qrl_getBlockTransactionCountByNumber":
        return this._getBlockTransactionCountByNumberAction(
          ...this._getBlockTransactionCountByNumberParams(params)
        );

      case "qrl_getCode":
        return this._getCodeAction(...this._getCodeParams(params));

      case "qrl_getFilterChanges":
        return this._getFilterChangesAction(
          ...this._getFilterChangesParams(params)
        );

      case "qrl_getFilterLogs":
        return this._getFilterLogsAction(...this._getFilterLogsParams(params));

      case "qrl_getLogs":
        return this._getLogsAction(...this._getLogsParams(params));

      case "qrl_getStorageAt":
        return this._getStorageAtAction(...this._getStorageAtParams(params));

      case "qrl_getTransactionByBlockHashAndIndex":
        return this._getTransactionByBlockHashAndIndexAction(
          ...this._getTransactionByBlockHashAndIndexParams(params)
        );

      case "qrl_getTransactionByBlockNumberAndIndex":
        return this._getTransactionByBlockNumberAndIndexAction(
          ...this._getTransactionByBlockNumberAndIndexParams(params)
        );

      case "qrl_getTransactionByHash":
        return this._getTransactionByHashAction(
          ...this._getTransactionByHashParams(params)
        );

      case "qrl_getTransactionCount":
        return this._getTransactionCountAction(
          ...this._getTransactionCountParams(params)
        );

      case "qrl_getTransactionReceipt":
        return this._getTransactionReceiptAction(
          ...this._getTransactionReceiptParams(params)
        );

      case "qrl_mining":
        return this._miningAction(...this._miningParams(params));

      case "qrl_newBlockFilter":
        return this._newBlockFilterAction(
          ...this._newBlockFilterParams(params)
        );

      case "qrl_newFilter":
        return this._newFilterAction(...this._newFilterParams(params));

      case "qrl_newPendingTransactionFilter":
        return this._newPendingTransactionFilterAction(
          ...this._newPendingTransactionFilterParams(params)
        );

      case "qrl_pendingTransactions":
        return this._pendingTransactionsAction(
          ...this._pendingTransactionsParams(params)
        );

      case "qrl_sendRawTransaction":
        return this._sendRawTransactionAction(
          ...this._sendRawTransactionParams(params)
        );

      case "qrl_sendTransaction":
        return this._sendTransactionAction(
          ...this._sendTransactionParams(params)
        );

      case "qrl_subscribe":
        return this._subscribeAction(...this._subscribeParams(params));

      case "qrl_syncing":
        return this._syncingAction(...this._syncingParams(params));

      case "qrl_uninstallFilter":
        return this._uninstallFilterAction(
          ...this._uninstallFilterParams(params)
        );

      case "qrl_unsubscribe":
        return this._unsubscribeAction(...this._unsubscribeParams(params));
    }

    throw new MethodNotFoundError(`Method ${method} not found`);
  }

  // qrl_accounts

  private _accountsParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _accountsAction(): Promise<string[]> {
    return this._node.getLocalAccountAddresses();
  }

  // qrl_blockNumber

  private _blockNumberParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _blockNumberAction(): Promise<string> {
    return numberToRpcQuantity(await this._node.getLatestBlockNumber());
  }

  // qrl_call

  private _callParams(params: any[]): [RpcCallRequest, OptionalBlockTag] {
    return validateParams(params, rpcCallRequest, optionalBlockTag);
  }

  private async _callAction(
    request: RpcCallRequest,
    blockTag: OptionalBlockTag
  ): Promise<string> {
    this._validateStateBlockTag(blockTag);
    if (request.from === undefined) {
      throw new InvalidArgumentsError("qrl_call requires a QRL from address");
    }
    if (request.to === undefined) {
      throw new InvalidArgumentsError("qrl_call requires a QRL to address");
    }

    const { transaction, sender } = await this._createTransaction(
      request,
      blockTag === "pending",
      this._config.defaultGasLimit
    );
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
    const call: CallParams = {
      to: transaction.to,
      from: sender,
      gasLimit: transaction.gasLimit,
      gasPrice,
      value: transaction.value,
      data: transaction.data,
    };
    const result = await this._node.runCall(call, {
      usePendingState: blockTag === "pending",
    });

    this._logCall(call);

    if (result.exceptionError !== undefined && this._throwOnCallFailures) {
      const traceFrame = this._stackTracesEnabled
        ? await this._traceCallFailure(call, blockTag === "pending")
        : undefined;
      throw new QrlExecutionError(
        result.exceptionError.message,
        bufferToRpcData(result.returnValue),
        undefined,
        traceFrame
      );
    }
    return bufferToRpcData(result.returnValue);
  }

  // qrl_chainId

  private _chainIdParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _chainIdAction(): Promise<string> {
    return numberToRpcQuantity(this._config.chainId);
  }

  // qrl_coinbase

  private _coinbaseParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _coinbaseAction(): Promise<string> {
    return (await this._node.getCoinbaseAddress()).toString();
  }

  // qrl_estimateGas

  private _estimateGasParams(
    params: any[]
  ): [RpcTransactionRequest, OptionalBlockTag] {
    return validateParams(params, rpcTransactionRequest, optionalBlockTag);
  }

  private async _estimateGasAction(
    request: RpcTransactionRequest,
    blockTag: OptionalBlockTag
  ): Promise<string> {
    this._validateStateBlockTag(blockTag);
    const { transaction, sender } = await this._createTransaction(
      request,
      blockTag === "pending",
      await this._node.getBlockGasLimit()
    );
    const result = await this._node.estimateGas(transaction, sender, {
      usePendingState: blockTag === "pending",
    });
    if (
      result.error !== undefined ||
      result.runTxResult?.executionError !== undefined ||
      result.runTxResult?.status === 0
    ) {
      const traceFrame = this._stackTracesEnabled
        ? await this._traceEstimateGasFailure(
            transaction,
            sender,
            blockTag === "pending"
          )
        : undefined;
      throw new QrlExecutionError(
        result.error?.message ?? "QRL gas estimation failed",
        result.runTxResult?.returnValue === undefined
          ? undefined
          : bufferToRpcData(result.runTxResult.returnValue),
        undefined,
        traceFrame
      );
    }
    return numberToRpcQuantity(result.estimation);
  }

  // qrl_gasPrice

  private _gasPriceParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _gasPriceAction(): Promise<string> {
    return numberToRpcQuantity(await this._node.getGasPrice());
  }

  // qrl_getBalance

  private _getBalanceParams(params: any[]): [Uint8Array, OptionalBlockTag] {
    return validateParams(params, rpcAddress, optionalBlockTag);
  }

  private async _getBalanceAction(
    addressBytes: Uint8Array,
    blockTag: OptionalBlockTag
  ): Promise<string> {
    this._validateStateBlockTag(blockTag);
    const address = this._config.addressFromBytes(addressBytes);
    const balance =
      blockTag === "pending"
        ? await this._node.getPendingAccountBalance(address)
        : await this._node.getAccountBalance(address);
    return numberToRpcQuantity(balance);
  }

  // qrl_getBlockByHash

  private _getBlockByHashParams(
    params: any[]
  ): [Uint8Array, boolean | undefined] {
    return validateParams(params, rpcHash, optionalBoolean);
  }

  private async _getBlockByHashAction(
    hash: Uint8Array,
    includeTransactions: boolean | undefined
  ): Promise<RpcBlockOutput | null> {
    const block = await this._node.getBlockByHash(hash);
    return block === undefined
      ? null
      : getRpcBlock(block, includeTransactions ?? false);
  }

  // qrl_getBlockByNumber

  private _getBlockByNumberParams(
    params: any[]
  ): [BlockTag, boolean | undefined] {
    return validateParams(params, rpcBlockTag, optionalBoolean);
  }

  private async _getBlockByNumberAction(
    tag: BlockTag,
    includeTransactions: boolean | undefined
  ): Promise<RpcBlockOutput | null> {
    const block = await this._resolveBlock(tag);
    return block === undefined
      ? null
      : getRpcBlock(block, includeTransactions ?? false);
  }

  // qrl_getBlockTransactionCountByHash

  private _getBlockTransactionCountByHashParams(params: any[]): [Uint8Array] {
    return validateParams(params, rpcHash);
  }

  private async _getBlockTransactionCountByHashAction(
    hash: Uint8Array
  ): Promise<string | null> {
    const block = await this._node.getBlockByHash(hash);
    return block === undefined
      ? null
      : numberToRpcQuantity(block.transactions.length);
  }

  // qrl_getBlockTransactionCountByNumber

  private _getBlockTransactionCountByNumberParams(params: any[]): [BlockTag] {
    return validateParams(params, rpcBlockTag);
  }

  private async _getBlockTransactionCountByNumberAction(
    tag: BlockTag
  ): Promise<string | null> {
    const block = await this._resolveBlock(tag);
    return block === undefined
      ? null
      : numberToRpcQuantity(block.transactions.length);
  }

  // qrl_getCode

  private _getCodeParams(params: any[]): [Uint8Array, OptionalBlockTag] {
    return validateParams(params, rpcAddress, optionalBlockTag);
  }

  private async _getCodeAction(
    addressBytes: Uint8Array,
    blockTagValue: OptionalBlockTag
  ): Promise<string> {
    this._validateStateBlockTag(blockTagValue);
    const address = this._config.addressFromBytes(addressBytes);
    const code =
      blockTagValue === "pending"
        ? await this._node.getPendingCode(address)
        : await this._node.getCode(address);
    return bufferToRpcData(code);
  }

  // qrl_getFilterChanges

  private _getFilterChangesParams(params: any[]): [bigint] {
    return validateParams(params, rpcQuantity);
  }

  private async _getFilterChangesAction(
    filterId: bigint
  ): Promise<string[] | RpcLogOutput[]> {
    const changes = await this._node.getFilterChanges(filterId);
    if (changes === undefined) {
      throw new InvalidInputError("QRL filter not found");
    }
    return changes;
  }

  // qrl_getFilterLogs

  private _getFilterLogsParams(params: any[]): [bigint] {
    return validateParams(params, rpcQuantity);
  }

  private async _getFilterLogsAction(
    filterId: bigint
  ): Promise<RpcLogOutput[]> {
    const logs = await this._node.getFilterLogs(filterId);
    if (logs === undefined) {
      throw new InvalidInputError("QRL filter not found");
    }
    return logs;
  }

  // qrl_getLogs

  private _getLogsParams(params: any[]): [QRLLogFilter] {
    if (params.length !== 1) {
      throw new InvalidArgumentsError("qrl_getLogs expects one filter object");
    }
    return [parseLogFilter(params[0])];
  }

  private async _getLogsAction(filter: QRLLogFilter): Promise<RpcLogOutput[]> {
    return this._node.getLogs(filter);
  }

  // qrl_getStorageAt

  private _getStorageAtParams(
    params: any[]
  ): [Uint8Array, Uint8Array, OptionalBlockTag] {
    return validateParams(params, rpcAddress, rpcStorageKey, optionalBlockTag);
  }

  private async _getStorageAtAction(
    addressBytes: Uint8Array,
    key: Uint8Array,
    blockTagValue: OptionalBlockTag
  ): Promise<string> {
    this._validateStateBlockTag(blockTagValue);
    const address = this._config.addressFromBytes(addressBytes);
    const value =
      blockTagValue === "pending"
        ? await this._node.getPendingStorageAt(address, key)
        : await this._node.getStorageAt(address, key);
    return bufferToRpcData(value);
  }

  // qrl_getTransactionByBlockHashAndIndex

  private _getTransactionByBlockHashAndIndexParams(
    params: any[]
  ): [Uint8Array, bigint] {
    return validateParams(params, rpcHash, rpcQuantity);
  }

  private async _getTransactionByBlockHashAndIndexAction(
    hash: Uint8Array,
    index: bigint
  ): Promise<RpcTransactionOutput | null> {
    return this._transactionAtIndex(
      await this._node.getBlockByHash(hash),
      index
    );
  }

  // qrl_getTransactionByBlockNumberAndIndex

  private _getTransactionByBlockNumberAndIndexParams(
    params: any[]
  ): [BlockTag, bigint] {
    return validateParams(params, rpcBlockTag, rpcQuantity);
  }

  private async _getTransactionByBlockNumberAndIndexAction(
    tag: BlockTag,
    index: bigint
  ): Promise<RpcTransactionOutput | null> {
    return this._transactionAtIndex(await this._resolveBlock(tag), index);
  }

  // qrl_getTransactionByHash

  private _getTransactionByHashParams(params: any[]): [Uint8Array] {
    return validateParams(params, rpcHash);
  }

  private async _getTransactionByHashAction(
    hash: Uint8Array
  ): Promise<RpcTransactionOutput | null> {
    const indexed = await this._node.getIndexedTransactionByHash(hash);
    if (indexed === undefined) {
      return null;
    }

    const receipt = await this._node.getTransactionReceipt(hash);
    const block = await this._node.getBlockByTransactionHash(hash);
    const foundIndex = block?.transactions.findIndex((transaction: any) =>
      bytesEqual(transaction.hash(), hash)
    );
    const index = foundIndex === -1 ? undefined : foundIndex;

    return getRpcTransaction(
      indexed.transaction,
      block,
      index,
      false,
      receipt?.from ?? indexed.sender
    );
  }

  // qrl_getTransactionCount

  private _getTransactionCountParams(
    params: any[]
  ): [Uint8Array, OptionalBlockTag] {
    return validateParams(params, rpcAddress, optionalBlockTag);
  }

  private async _getTransactionCountAction(
    addressBytes: Uint8Array,
    blockTag: OptionalBlockTag
  ): Promise<string> {
    this._validateStateBlockTag(blockTag);
    const address = this._config.addressFromBytes(addressBytes);
    const nonce =
      blockTag === "pending"
        ? await this._node.getPendingAccountNonce(address)
        : await this._node.getAccountNonce(address);
    return numberToRpcQuantity(nonce);
  }

  // qrl_getTransactionReceipt

  private _getTransactionReceiptParams(params: any[]): [Uint8Array] {
    return validateParams(params, rpcHash);
  }

  private async _getTransactionReceiptAction(
    hash: Uint8Array
  ): Promise<RpcTransactionReceiptOutput | null> {
    const receipt = await this._node.getTransactionReceipt(hash);
    return receipt === undefined ? null : getRpcTransactionReceipt(receipt);
  }

  // qrl_mining

  private _miningParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _miningAction(): Promise<boolean> {
    return false;
  }

  // qrl_newBlockFilter

  private _newBlockFilterParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _newBlockFilterAction(): Promise<string> {
    return numberToRpcQuantity(await this._node.newBlockFilter());
  }

  // qrl_newFilter

  private _newFilterParams(params: any[]): [QRLLogFilter] {
    if (params.length !== 1) {
      throw new InvalidArgumentsError(
        "qrl_newFilter expects one filter object"
      );
    }
    return [parseLogFilter(params[0])];
  }

  private async _newFilterAction(filter: QRLLogFilter): Promise<string> {
    return numberToRpcQuantity(await this._node.newFilter(filter));
  }

  // qrl_newPendingTransactionFilter

  private _newPendingTransactionFilterParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _newPendingTransactionFilterAction(): Promise<string> {
    return numberToRpcQuantity(await this._node.newPendingTransactionFilter());
  }

  // qrl_pendingTransactions

  private _pendingTransactionsParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _pendingTransactionsAction(): Promise<any[]> {
    const transactions = await this._node.getPendingTransactions();
    return Promise.all(
      transactions.map(async (transaction) => {
        const indexed = await this._node.getIndexedTransactionByHash(
          transaction.hash()
        );
        return {
          ...getRpcTransaction(
            transaction,
            undefined,
            undefined,
            false,
            indexed?.sender
          ),
          blockHash: null,
          blockNumber: null,
          transactionIndex: null,
        };
      })
    );
  }

  // qrl_sendRawTransaction

  private _sendRawTransactionParams(params: any[]): [Uint8Array] {
    return validateParams(params, rpcData);
  }

  private async _sendRawTransactionAction(
    serialized: Uint8Array
  ): Promise<string> {
    let transaction: any;
    try {
      transaction = this._config.transactionFromSerialized(serialized);
    } catch (error) {
      throw new InvalidArgumentsError(
        "Invalid raw QRL transaction: ".concat((error as Error).message)
      );
    }
    return this._submitTransaction(this._node.runRawTransaction(transaction));
  }

  // qrl_sendTransaction

  private _sendTransactionParams(params: any[]): [RpcTransactionRequest] {
    return validateParams(params, rpcTransactionRequest);
  }

  private async _sendTransactionAction(
    request: RpcTransactionRequest
  ): Promise<string> {
    const { transaction, sender } = await this._createTransaction(
      request,
      true,
      this._config.defaultGasLimit
    );
    return this._submitTransaction(
      this._node.runTransaction(transaction, sender)
    );
  }

  // qrl_subscribe

  private _subscribeParams(
    params: any[]
  ): [RpcSubscribeRequest, unknown | undefined] {
    if (params.length === 0) {
      throw new InvalidInputError(
        "Expected subscription name as first argument"
      );
    }
    if (params.length > 2) {
      throw new InvalidArgumentsError(
        "qrl_subscribe expects a type and optional arguments"
      );
    }
    const request = validateParams([params[0]], rpcSubscribeRequest)[0];
    return [request, params[1]];
  }

  private async _subscribeAction(
    request: RpcSubscribeRequest,
    options: unknown | undefined
  ): Promise<string> {
    switch (request) {
      case "newHeads":
        if (options !== undefined) {
          throw new InvalidArgumentsError(
            "qrl_subscribe newHeads does not accept arguments"
          );
        }
        return numberToRpcQuantity(this._node.newHeadsSubscription());

      case "newPendingTransactions":
        if (options !== undefined && typeof options !== "boolean") {
          throw new InvalidArgumentsError(
            "qrl_subscribe newPendingTransactions flag must be a boolean"
          );
        }
        return numberToRpcQuantity(
          this._node.newPendingTransactionsSubscription(options === true)
        );

      case "logs":
        return numberToRpcQuantity(
          this._node.newLogsSubscription(parseLogFilter(options ?? {}))
        );
    }
  }

  // qrl_syncing

  private _syncingParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _syncingAction(): Promise<boolean> {
    return false;
  }

  // qrl_uninstallFilter

  private _uninstallFilterParams(params: any[]): [bigint] {
    return validateParams(params, rpcQuantity);
  }

  private async _uninstallFilterAction(filterId: bigint): Promise<boolean> {
    return this._node.uninstallFilter(filterId);
  }

  // qrl_unsubscribe

  private _unsubscribeParams(params: any[]): [bigint] {
    return validateParams(params, rpcQuantity);
  }

  private async _unsubscribeAction(subscriptionId: bigint): Promise<boolean> {
    return this._node.unsubscribe(subscriptionId);
  }

  private async _createTransaction(
    request: QrlExecutionRequest,
    usePendingState: boolean,
    defaultGasLimit: bigint
  ): Promise<{ transaction: any; sender: any }> {
    if (request.from === undefined) {
      throw new InvalidArgumentsError(
        "QRL transaction request requires a from address"
      );
    }
    const sender = this._config.addressFromBytes(request.from);
    const nonce =
      request.nonce ??
      (usePendingState
        ? await this._node.getPendingAccountNonce(sender)
        : await this._node.getAccountNonce(sender));
    const gasLimit = this._resolveGasLimit(request, defaultGasLimit);
    const transaction = this._config.createTransaction({
      chainId: this._config.chainId,
      nonce,
      gasTipCap: request.maxPriorityFeePerGas ?? (global as any).BigInt(0),
      gasFeeCap: request.maxFeePerGas ?? (global as any).BigInt(0),
      gasLimit,
      to:
        request.to === undefined
          ? undefined
          : this._config.addressFromBytes(request.to),
      value: request.value ?? (global as any).BigInt(0),
      data: request.data ?? new Uint8Array(0),
    });
    return { transaction, sender };
  }

  private _resolveGasLimit(
    request: QrlExecutionRequest,
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

  private async _submitTransaction(
    resultPromise: Promise<any>
  ): Promise<string> {
    const result = await resultPromise;
    const hash = bufferToRpcData(result.transaction.hash());
    await this._logTransaction(result, hash);
    if (
      this._throwOnTransactionFailures &&
      result.block !== undefined &&
      result.runTxResult.status === 0
    ) {
      throw new QrlExecutionError(
        result.runTxResult.executionError?.message ?? "QRL transaction failed",
        bufferToRpcData(result.runTxResult.returnValue),
        hash
      );
    }
    return hash;
  }

  private async _traceCallFailure(
    call: CallParams,
    usePendingState: boolean
  ): Promise<any | undefined> {
    try {
      return await this._node.traceCallFrames(call, { usePendingState });
    } catch (_error) {
      this._node.recordStackTraceFailure();
      return undefined;
    }
  }

  private async _traceEstimateGasFailure(
    transaction: any,
    sender: any,
    usePendingState: boolean
  ): Promise<any | undefined> {
    try {
      return await this._node.traceEstimateGasFrames(transaction, sender, {
        usePendingState,
      });
    } catch (_error) {
      this._node.recordStackTraceFailure();
      return undefined;
    }
  }

  private _logCall(call: CallParams): void {
    if (this._logger === undefined) {
      return;
    }

    this._logger.logWithTitle("Contract call", call.to.toString());
    this._logger.logWithTitle("From", call.from.toString());
    this._logger.logWithTitle("To", call.to.toString());
    this._logger.logWithTitle("Value", `${call.value.toString()} wei`);
    this._logger.logWithTitle("Gas limit", call.gasLimit.toString());
  }

  private async _logTransaction(result: any, hash: string): Promise<void> {
    if (this._logger === undefined) {
      return;
    }

    const transaction = result.transaction;
    const indexed = await this._node.getIndexedTransactionByHash(
      transaction.hash()
    );

    this._logger.logWithTitle("Transaction", hash);
    if (indexed?.sender !== undefined) {
      this._logger.logWithTitle("From", indexed.sender.toString());
    }
    if (transaction.to === undefined) {
      this._logger.logWithTitle("Contract deployment", "<unknown>");
    } else {
      this._logger.logWithTitle("To", transaction.to.toString());
    }
    this._logger.logWithTitle("Value", `${transaction.value.toString(10)} wei`);
    this._logger.logWithTitle(
      "Gas used",
      `${result.runTxResult.gasUsed.toString(
        10
      )} of ${transaction.gasLimit.toString(10)}`
    );
    if (result.block !== undefined) {
      this._logger.logWithTitle(
        `Block #${result.block.header.number.toString(10)}`,
        bufferToRpcData(result.block.hash())
      );
    }
  }

  private async _resolveBlock(tag: BlockTag): Promise<Block | undefined> {
    if (tag === "latest") {
      return this._node.getLatestBlock();
    }
    if (tag === "pending") {
      return this._node.getPendingBlock();
    }
    if (tag === "earliest") {
      return this._node.getBlockByNumber((global as any).BigInt(0));
    }
    return this._node.getBlockByNumber(tag);
  }

  private _transactionAtIndex(
    block: Block | undefined,
    index: bigint
  ): RpcTransactionOutput | null {
    if (block === undefined) {
      return null;
    }
    const numericIndex = Number(index);
    const transaction = block.transactions[numericIndex];
    if (transaction === undefined) {
      return null;
    }
    return getRpcTransaction(
      transaction,
      block,
      numericIndex,
      false,
      block.receipts[numericIndex]?.from
    );
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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}
