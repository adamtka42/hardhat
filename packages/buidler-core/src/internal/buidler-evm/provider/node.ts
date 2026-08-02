import EventEmitter from "events";
import { promisify } from "util";

import { createQrlConsoleLogTraceListener } from "../stack-traces/consoleLogger";

import { Block, Blockchain } from "./blockchain";
import { InvalidArgumentsError, InvalidInputError } from "./errors";
import {
  collectMatchingLogs,
  maxBigInt,
  parseSubscriptionBound,
  QRL_FILTER_DEADLINE_MS,
  QRLInstalledFilter,
  QRLLogFilter,
  QRLSubscription,
  resolveInstalledFilterMinimum,
  resolveInstalledFilterStart,
  resolveLogFilterBlock,
} from "./filter";
import {
  bufferToRpcData,
  getRpcDebugTrace,
  getRpcLog,
  getRpcTransaction,
  numberToRpcQuantity,
  RpcLogOutput,
} from "./output";

export interface QrlNodeRuntime {
  blockQrl: {
    QRLBlock: new (data?: any) => Block;
    genQRLTransactionsRoot: (
      transactions: readonly any[]
    ) => Promise<Uint8Array>;
    genQRLReceiptsRoot: (receipts: readonly any[]) => Promise<Uint8Array>;
  };
  evmQrl: {
    QRLEVM: new (options?: any) => any;
  };
  stateQrl: {
    QRLStateManager: new (options?: any) => any;
  };
  txQrl?: {
    QRLDynamicFeeTransaction: new (data?: any) => any;
  };
  vmQrl: {
    QRLVM: new (options?: any) => any;
    createQRLReceiptFromRunTxResult: (options: any) => any;
    createFrameCollector?: (
      root: QrlTraceFrame
    ) => {
      listener: any;
      readonly lastError?: Error;
    };
    createRawStructLogCollector?: (
      config: QrlTraceConfig
    ) => {
      listener: any;
      finish: (rootExecutionGas?: any) => any[];
    };
    qrlOpcodeName?: (opcode: number) => string;
  };
}

export interface HardhatNodeOptions {
  genesis?: Record<string, any>;
  genesisHeader?: Record<string, any>;
  context?: Record<string, any>;
  accounts?: LocalAccount[];
  automine?: boolean;
  rawTransactionSigner?: QrlNodeSigner;
  allowUnlimitedContractSize?: boolean;
  consoleLogListener?: (input: any) => void;
  filterNow?: () => number;
}

export interface QrlNodeSigner {
  chainId: bigint;
  hash: (transaction: any) => Uint8Array;
  verify: (transaction: any) => boolean | Promise<boolean>;
  sender: (transaction: any) => any | Promise<any>;
}

export interface LocalAccount {
  address: any;
  balance?: bigint | string;
  nonce?: bigint | number;
}

export interface CallParams {
  to: any;
  from: any;
  gasLimit: bigint;
  gasPrice: bigint;
  value: bigint;
  data: Uint8Array;
}

export interface RunCallOptions {
  usePendingState?: boolean;
  traceListener?: any;
  emitConsoleLogs?: boolean;
}

export interface RunTransactionResult {
  transaction: any;
  runTxResult: any;
  receipt?: any;
  block?: Block;
}

export interface RunTransactionInNewBlockResult {
  transaction: any;
  runTxResult: any;
  receipt: any;
  block: Block;
}

export interface IndexedQrlTransaction {
  transaction: any;
  sender: any;
}

export interface MineBlockOptions {
  timestamp?: bigint;
  gasLimit?: bigint;
  baseFee?: bigint;
  coinbase?: any;
}

export interface EstimateGasOptions {
  usePendingState?: boolean;
}

export interface EstimateGasResult {
  estimation: bigint;
  runTxResult?: any;
  error?: Error;
}

export interface QrlTraceConfig {
  disableStack?: boolean;
  enableMemory?: boolean;
  limit?: number;
}

export interface QrlTransactionReplayResult {
  gasUsed: bigint;
  gasLimit: bigint;
  returnValue: Uint8Array;
  failed: boolean;
  errorMessage?: string;
}

export interface QrlTraceFrame {
  kind: "call" | "staticcall" | "delegatecall" | "create" | "create2";
  depth: number;
  from?: any;
  target?: any;
  createdAddress?: any;
  precompile?: any;
  input: Uint8Array;
  value: bigint;
  gasLimit: bigint;
  code?: Uint8Array;
  returnValue?: Uint8Array;
  gasUsed?: bigint;
  errorMessage?: string;
  traceError?: string;
  lastPc?: number;
  steps: Array<{ pc: number } | QrlTraceFrame>;
  children: QrlTraceFrame[];
}

interface GasEstimationExecutionContext {
  sender: any;
  stateManager: any;
  vm: any;
  context: Record<string, any>;
}

interface PendingQrlTransaction {
  transaction: any;
  transactionHash: Uint8Array;
  sender: any;
  runTxResult: any;
}

interface NodeSnapshot {
  id: bigint;
  latestBlock: Block;
  stateManager: any;
  pendingStateManager?: any;
  pendingTransactions: PendingQrlTransaction[];
  pendingBlockTimestamp?: bigint;
  pendingTimeIncrease: bigint;
  totalTimeIncrement: bigint;
  nextBlockTimestamp?: bigint;
  transactionsByHash: Map<string, IndexedQrlTransaction>;
  receiptsByTransactionHash: Map<string, any>;
  transactionHashToBlockHash: Map<string, Uint8Array>;
  stateBeforeByBlock: Map<string, any>;
}

// tslint:disable only-hardhat-error

export class HardhatNode extends EventEmitter {
  public static async create(
    runtime: QrlNodeRuntime,
    options: HardhatNodeOptions = {}
  ): Promise<HardhatNode> {
    const localAccounts = options.accounts ?? [];
    const genesis: Record<string, any> = { ...options.genesis };
    for (const account of localAccounts) {
      genesis[account.address.toString()] = {
        balance: account.balance,
        nonce: account.nonce,
      };
    }

    const stateManager = new runtime.stateQrl.QRLStateManager({
      genesis,
    });
    const evm = new runtime.evmQrl.QRLEVM({
      stateManager,
      allowUnlimitedContractSize: options.allowUnlimitedContractSize,
      traceListener: createQrlConsoleLogTraceListener(
        options.consoleLogListener
      ),
    });
    const vm = new runtime.vmQrl.QRLVM({
      stateManager,
      evm,
      context: options.context,
    });
    const blockchain = new Blockchain();
    const genesisBlock = new runtime.blockQrl.QRLBlock({
      header: {
        ...options.genesisHeader,
        number: (global as any).BigInt(0),
        stateRoot: await stateManager.getStateRoot(),
      },
    });

    await new Promise((resolve, reject) => {
      blockchain.putBlock(genesisBlock, (error) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    return new HardhatNode(
      runtime,
      vm,
      blockchain,
      localAccounts,
      options.rawTransactionSigner,
      options.context,
      options.automine ?? true,
      options.consoleLogListener,
      options.allowUnlimitedContractSize,
      options.filterNow
    );
  }

  private readonly _localAccounts: Map<string, any> = new Map();
  private readonly _transactionsByHash: Map<
    string,
    IndexedQrlTransaction
  > = new Map();
  private readonly _receiptsByTransactionHash: Map<string, any> = new Map();
  private readonly _transactionHashToBlockHash: Map<
    string,
    Uint8Array
  > = new Map();
  private readonly _stateBeforeByBlock: Map<string, any> = new Map();
  private _pendingTimeIncrease: bigint = (global as any).BigInt(0);
  private _totalTimeIncrement: bigint = (global as any).BigInt(0);
  private _nextBlockTimestamp?: bigint;
  private _pendingStateManager?: any;
  private _pendingVm?: any;
  private _pendingBlockTimestamp?: bigint;
  private readonly _pendingTransactions: PendingQrlTransaction[] = [];
  private _nextSnapshotId: bigint = (global as any).BigInt(1);
  private readonly _snapshots: NodeSnapshot[] = [];
  private _nextFilterId: bigint = (global as any).BigInt(1);
  private readonly _filters: Map<string, QRLInstalledFilter> = new Map();
  private _filterExpiryTimer?: ReturnType<typeof setTimeout>;
  private _nextSubscriptionId: bigint = (global as any).BigInt(1);
  private _failedStackTraces = 0;
  private readonly _subscriptions: Map<string, QRLSubscription> = new Map();
  private _vm: any;
  private _stateManager: any;
  private readonly _getLatestBlock: () => Promise<Block>;
  private readonly _getBlock: (
    hashOrBlockNumber: Uint8Array | bigint
  ) => Promise<Block | undefined>;

  private constructor(
    private readonly _runtime: QrlNodeRuntime,
    vm: any,
    private readonly _blockchain: Blockchain,
    localAccounts: LocalAccount[],
    private readonly _rawTransactionSigner?: QrlNodeSigner,
    private readonly _context: Record<string, any> = {},
    private readonly _automine: boolean = true,
    private readonly _consoleLogListener?: (input: any) => void,
    private readonly _allowUnlimitedContractSize?: boolean,
    private readonly _filterNow: () => number = () => Date.now()
  ) {
    super();

    this._initLocalAccounts(localAccounts);
    this._vm = vm;
    this._stateManager = this._vm.stateManager;
    this._getLatestBlock = promisify(
      this._blockchain.getLatestBlock.bind(this._blockchain)
    );
    this._getBlock = promisify(
      this._blockchain.getBlock.bind(this._blockchain)
    );
  }

  public async getLatestBlock(): Promise<Block> {
    return this._getLatestBlock();
  }

  public async getLatestBlockNumber(): Promise<bigint> {
    return (await this._getLatestBlock()).header.number;
  }

  public async getBlockByNumber(
    blockNumber: bigint
  ): Promise<Block | undefined> {
    return this._getBlock(blockNumber);
  }

  public async getBlockByHash(hash: Uint8Array): Promise<Block | undefined> {
    return this._getBlock(hash);
  }

  public async getBlockByTransactionHash(
    hash: Uint8Array
  ): Promise<Block | undefined> {
    const blockHash = this._transactionHashToBlockHash.get(hashKey(hash));
    if (blockHash === undefined) {
      return undefined;
    }

    return this.getBlockByHash(blockHash);
  }

  public async getTransactionByHash(
    hash: Uint8Array
  ): Promise<any | undefined> {
    return this._transactionsByHash.get(hashKey(hash))?.transaction;
  }

  public async getIndexedTransactionByHash(
    hash: Uint8Array
  ): Promise<IndexedQrlTransaction | undefined> {
    return this._transactionsByHash.get(hashKey(hash));
  }

  public async getTransactionReceipt(
    hash: Uint8Array
  ): Promise<any | undefined> {
    return this._receiptsByTransactionHash.get(hashKey(hash));
  }

  public async replayTransaction(
    hash: Uint8Array,
    traceListener: any
  ): Promise<QrlTransactionReplayResult> {
    const receipt = await this.getTransactionReceipt(hash);
    if (receipt?.blockHash === undefined) {
      throw new InvalidInputError("QRL transaction not found or not mined");
    }

    const block = await this.getBlockByHash(receipt.blockHash);
    if (block === undefined) {
      throw new InvalidInputError("QRL block not found for transaction");
    }
    const stateBefore = this._stateBeforeByBlock.get(hashKey(block.hash()));
    if (stateBefore === undefined) {
      throw new InvalidInputError(
        "QRL historical state for the block is not retained; cannot replay the transaction"
      );
    }

    const stateManager = stateBefore.shallowCopy();
    for (const transaction of block.transactions) {
      const indexed = await this.getIndexedTransactionByHash(
        transaction.hash()
      );
      if (indexed === undefined) {
        throw new InvalidInputError("QRL block transaction is not indexed");
      }

      const isTarget = hashKey(transaction.hash()) === hashKey(hash);
      const vm = this._createVm(
        stateManager,
        false,
        isTarget ? traceListener : undefined
      );
      const result = await vm.runTx({
        tx: transaction,
        sender: indexed.sender,
        context: {
          chainId: transaction.chainId,
          baseFee: block.header.baseFee,
          coinbase: block.header.coinbase,
          blockNumber: block.header.number,
          timestamp: block.header.timestamp,
          gasLimit: block.header.gasLimit,
          noBaseFee: this._context.noBaseFee ?? true,
        },
      });
      if (isTarget) {
        return {
          gasUsed: result.gasUsed,
          gasLimit: transaction.gasLimit,
          returnValue: result.returnValue,
          failed: result.status === 0,
          errorMessage: result.executionError?.message,
        };
      }
    }

    throw new InvalidInputError("QRL transaction not found in its block");
  }

  public async traceTransactionFrames(
    hash: Uint8Array
  ): Promise<QrlTraceFrame> {
    const indexed = await this.getIndexedTransactionByHash(hash);
    if (indexed === undefined) {
      throw new InvalidInputError("QRL transaction not found");
    }
    const createFrameCollector = this._runtime.vmQrl.createFrameCollector;
    if (createFrameCollector === undefined) {
      throw new InvalidInputError("QRL frame trace collector is unavailable");
    }

    const transaction = indexed.transaction;
    const input: Uint8Array = transaction.data ?? new Uint8Array();
    const value: bigint = transaction.value ?? (global as any).BigInt(0);
    const root: QrlTraceFrame = {
      kind: transaction.to === undefined ? "create" : "call",
      depth: 0,
      target: transaction.to,
      from: indexed.sender,
      input,
      value,
      gasLimit: transaction.gasLimit,
      code: transaction.to === undefined ? new Uint8Array(input) : undefined,
      steps: [],
      children: [],
    };
    const collector = createFrameCollector(root);
    const outcome = await this.replayTransaction(hash, collector.listener);
    root.returnValue = outcome.returnValue;
    root.gasUsed = outcome.gasUsed;
    root.errorMessage = outcome.failed
      ? outcome.errorMessage ?? "execution failed"
      : undefined;
    if (collector.lastError !== undefined) {
      this._failedStackTraces += 1;
      root.traceError = collector.lastError.message;
    }
    return root;
  }

  public async traceCallFrames(
    call: CallParams,
    options: { usePendingState?: boolean } = {}
  ): Promise<QrlTraceFrame> {
    const createFrameCollector = this._runtime.vmQrl.createFrameCollector;
    if (createFrameCollector === undefined) {
      throw new InvalidInputError("QRL frame trace collector is unavailable");
    }

    const root: QrlTraceFrame = {
      kind: "call",
      depth: 0,
      target: call.to,
      from: call.from,
      input: call.data,
      value: call.value,
      gasLimit: call.gasLimit,
      steps: [],
      children: [],
    };
    const collector = createFrameCollector(root);
    const result = await this.runCall(call, {
      usePendingState: options.usePendingState,
      traceListener: collector.listener,
      emitConsoleLogs: false,
    });
    root.returnValue = result.returnValue;
    root.gasUsed = result.gasUsed;
    root.errorMessage = result.exceptionError?.message;
    if (collector.lastError !== undefined) {
      this._failedStackTraces += 1;
      root.traceError = collector.lastError.message;
    }
    return root;
  }

  public async traceEstimateGasFrames(
    transaction: any,
    sender: any,
    options: EstimateGasOptions = {}
  ): Promise<QrlTraceFrame> {
    const createFrameCollector = this._runtime.vmQrl.createFrameCollector;
    if (createFrameCollector === undefined) {
      throw new InvalidInputError("QRL frame trace collector is unavailable");
    }

    const root: QrlTraceFrame = {
      kind: transaction.to === undefined ? "create" : "call",
      depth: 0,
      target: transaction.to,
      from: sender,
      input: transaction.data,
      value: transaction.value,
      gasLimit: transaction.gasLimit,
      code:
        transaction.to === undefined
          ? new Uint8Array(transaction.data)
          : undefined,
      steps: [],
      children: [],
    };
    const collector = createFrameCollector(root);
    const latestBlock = await this._getLatestBlock();
    const one: bigint = (global as any).BigInt(1);
    const stateManager =
      options.usePendingState === true
        ? this._pendingStateManager ?? this._stateManager
        : this._stateManager;
    const execution = await this._runTxAndRevertMutations(transaction, {
      sender,
      stateManager,
      vm: this._createVm(stateManager, false, collector.listener),
      context: {
        chainId: this._context.chainId ?? one,
        baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
        coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
        blockNumber: (latestBlock.header.number as bigint) + one,
        timestamp:
          this._context.timestamp ??
          this._pendingBlockTimestamp ??
          this._calculateNextBlockTimestamp(latestBlock),
        gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
        noBaseFee: this._context.noBaseFee ?? true,
      },
    });
    if (execution.runTxResult !== undefined) {
      root.returnValue = execution.runTxResult.returnValue;
      root.gasUsed = execution.runTxResult.gasUsed;
      root.createdAddress = execution.runTxResult.createdAddress;
      root.errorMessage = execution.success
        ? undefined
        : execution.runTxResult.executionError?.message ?? "execution failed";
    } else {
      root.errorMessage = execution.error?.message ?? "execution failed";
    }
    if (collector.lastError !== undefined) {
      this._failedStackTraces += 1;
      root.traceError = collector.lastError.message;
    }
    return root;
  }

  public async debugTraceCall(
    call: CallParams,
    config: QrlTraceConfig = {},
    options: { usePendingState?: boolean } = {}
  ): Promise<any> {
    const createRawStructLogCollector = this._runtime.vmQrl
      .createRawStructLogCollector;
    const opcodeName = this._runtime.vmQrl.qrlOpcodeName;
    if (createRawStructLogCollector === undefined || opcodeName === undefined) {
      throw new InvalidInputError("QRL struct log collector is unavailable");
    }
    const collector = createRawStructLogCollector(config);
    const result = await this.runCall(call, {
      usePendingState: options.usePendingState,
      traceListener: collector.listener,
      emitConsoleLogs: false,
    });
    const outcome = {
      gasUsed: result.gasUsed,
      gasLimit: call.gasLimit,
      returnValue: result.returnValue,
      failed: result.exceptionError !== undefined,
      errorMessage: result.exceptionError?.message,
    };
    const steps = collector.finish({
      gasLimit: outcome.gasLimit,
      gasUsed: outcome.gasUsed,
    });
    return getRpcDebugTrace(outcome, steps, opcodeName);
  }

  public async debugTraceTransaction(
    hash: Uint8Array,
    config: QrlTraceConfig = {}
  ): Promise<any> {
    const createRawStructLogCollector = this._runtime.vmQrl
      .createRawStructLogCollector;
    const opcodeName = this._runtime.vmQrl.qrlOpcodeName;
    if (createRawStructLogCollector === undefined || opcodeName === undefined) {
      throw new InvalidInputError("QRL struct log collector is unavailable");
    }
    const collector = createRawStructLogCollector(config);
    const outcome = await this.replayTransaction(hash, collector.listener);
    const steps = collector.finish({
      gasLimit: outcome.gasLimit,
      gasUsed: outcome.gasUsed,
    });
    return getRpcDebugTrace(outcome, steps, opcodeName);
  }

  public recordStackTraceFailure(): void {
    this._failedStackTraces += 1;
  }

  public async getStackTraceFailuresCount(): Promise<number> {
    return this._failedStackTraces;
  }

  public async getAccountBalance(address: any): Promise<bigint> {
    return this._stateManager.getBalance(address);
  }

  public async getAccountNonce(address: any): Promise<bigint> {
    return this._stateManager.getNonce(address);
  }

  public async getCode(address: any): Promise<Uint8Array> {
    return this._stateManager.getCode(address);
  }

  public async getStorageAt(
    address: any,
    key: Uint8Array
  ): Promise<Uint8Array> {
    return this._stateManager.getStorage(address, key);
  }

  public async getPendingCode(address: any): Promise<Uint8Array> {
    return (this._pendingStateManager ?? this._stateManager).getCode(address);
  }

  public async getPendingStorageAt(
    address: any,
    key: Uint8Array
  ): Promise<Uint8Array> {
    return (this._pendingStateManager ?? this._stateManager).getStorage(
      address,
      key
    );
  }

  public async getBlockGasLimit(): Promise<bigint> {
    const latestBlock = await this._getLatestBlock();
    return this._context.gasLimit ?? latestBlock.header.gasLimit;
  }

  public async getCoinbaseAddress(): Promise<any> {
    const latestBlock = await this._getLatestBlock();
    return this._context.coinbase ?? latestBlock.header.coinbase;
  }

  public async getGasPrice(): Promise<bigint> {
    return (global as any).BigInt(0);
  }

  public async newFilter(criteria: QRLLogFilter): Promise<bigint> {
    if (criteria.blockHash !== undefined) {
      throw new InvalidArgumentsError(
        "QRL installed log filters do not support blockHash criteria"
      );
    }

    const latest = await this.getLatestBlockNumber();
    return this._registerFilter({
      type: "log",
      criteria,
      minimumBlock: resolveInstalledFilterMinimum(criteria.fromBlock),
      nextBlock: resolveInstalledFilterStart(criteria.fromBlock, latest),
      deadline: this._filterDeadline(),
    });
  }

  public async newBlockFilter(): Promise<bigint> {
    return this._registerFilter({
      type: "block",
      lastBlock: await this.getLatestBlockNumber(),
      deadline: this._filterDeadline(),
    });
  }

  public async newPendingTransactionFilter(): Promise<bigint> {
    return this._registerFilter({
      type: "pendingTx",
      reported: new Set(),
      deadline: this._filterDeadline(),
    });
  }

  public uninstallFilter(filterId: bigint): boolean {
    this._sweepExpiredFilters();
    const deleted = this._filters.delete(filterKey(filterId));
    this._scheduleFilterSweep();
    return deleted;
  }

  public async getFilterChanges(
    filterId: bigint
  ): Promise<string[] | RpcLogOutput[] | undefined> {
    const filter = this._lookupFilter(filterId);
    if (filter === undefined) {
      return undefined;
    }

    const latest = await this.getLatestBlockNumber();
    const one: bigint = (global as any).BigInt(1);
    if (filter.type === "block") {
      // tslint:disable-next-line:strict-comparisons
      if (filter.lastBlock > latest) {
        filter.lastBlock = latest;
      }
      const hashes: string[] = [];
      for (
        let number = filter.lastBlock + one;
        // tslint:disable-next-line:strict-comparisons
        number <= latest;
        number += one
      ) {
        const block = await this.getBlockByNumber(number);
        if (block !== undefined) {
          hashes.push(bufferToRpcData(block.hash()));
        }
      }
      filter.lastBlock = latest;
      return hashes;
    }

    if (filter.type === "pendingTx") {
      const current = new Set<string>();
      const fresh: string[] = [];
      for (const transaction of await this.getPendingTransactions()) {
        const hash = bufferToRpcData(transaction.hash());
        current.add(hash);
        if (!filter.reported.has(hash)) {
          fresh.push(hash);
        }
      }
      filter.reported = current;
      return fresh;
    }

    const toBlock = resolveLogFilterBlock(
      filter.criteria.toBlock,
      latest,
      latest
    );
    const minedTo = minBigInt(toBlock.number, latest);
    const logs: RpcLogOutput[] = [];
    for (
      let number = filter.nextBlock;
      // tslint:disable-next-line:strict-comparisons
      number <= minedTo;
      number += one
    ) {
      const block = await this.getBlockByNumber(number);
      if (block !== undefined) {
        logs.push(...formatMatchingLogs(block, filter.criteria));
      }
    }
    // tslint:disable-next-line:strict-comparisons
    if (filter.nextBlock <= minedTo) {
      filter.nextBlock = minedTo + one;
    }
    // tslint:disable-next-line:strict-comparisons
    if (toBlock.includesPending && filter.nextBlock <= latest + one) {
      logs.push(
        ...formatMatchingLogs(await this.getPendingBlock(), filter.criteria)
      );
    }
    return logs;
  }

  public async getFilterLogs(
    filterId: bigint
  ): Promise<RpcLogOutput[] | undefined> {
    const filter = this._lookupFilter(filterId);
    if (filter === undefined) {
      return undefined;
    }
    if (filter.type !== "log") {
      throw new InvalidArgumentsError(
        "QRL getFilterLogs is only supported for log filters"
      );
    }
    return this.getLogs(filter.criteria);
  }

  public async getLogs(filter: QRLLogFilter): Promise<RpcLogOutput[]> {
    if (filter.blockHash !== undefined) {
      const block = await this.getBlockByHash(filter.blockHash);
      return block === undefined ? [] : formatMatchingLogs(block, filter);
    }

    const latest = await this.getLatestBlockNumber();
    const zero: bigint = (global as any).BigInt(0);
    const one: bigint = (global as any).BigInt(1);
    const fromBlock = resolveLogFilterBlock(filter.fromBlock, zero, latest);
    const toBlock =
      filter.toBlock === undefined && filter.fromBlock === "pending"
        ? { number: latest + one, includesPending: true }
        : resolveLogFilterBlock(filter.toBlock, latest, latest);
    // tslint:disable-next-line:strict-comparisons
    if (fromBlock.number > toBlock.number) {
      return [];
    }

    const logs: RpcLogOutput[] = [];
    for (
      let number = fromBlock.number;
      // tslint:disable-next-line:strict-comparisons
      number <= toBlock.number && number <= latest;
      number += one
    ) {
      const block = await this.getBlockByNumber(number);
      if (block !== undefined) {
        logs.push(...formatMatchingLogs(block, filter));
      }
    }
    // tslint:disable-next-line:strict-comparisons
    if (toBlock.includesPending && fromBlock.number <= latest + one) {
      logs.push(...formatMatchingLogs(await this.getPendingBlock(), filter));
    }
    return logs;
  }

  public newHeadsSubscription(): bigint {
    return this._registerSubscription({ type: "newHeads" });
  }

  public newPendingTransactionsSubscription(
    fullObjects: boolean = false
  ): bigint {
    return this._registerSubscription({
      type: "newPendingTransactions",
      fullObjects,
    });
  }

  public newLogsSubscription(criteria: QRLLogFilter): bigint {
    if (criteria.blockHash !== undefined) {
      throw new InvalidArgumentsError(
        "QRL log subscriptions do not support blockHash criteria"
      );
    }

    const from = parseSubscriptionBound(criteria.fromBlock, "fromBlock");
    const to = parseSubscriptionBound(criteria.toBlock, "toBlock");
    if (from.kind === "latest" && to.kind === "number") {
      throw new InvalidArgumentsError(
        "QRL log subscription has an invalid block range"
      );
    }
    if (from.kind === "number" && to.kind === "number") {
      // tslint:disable-next-line:strict-comparisons
      if (from.value > to.value) {
        throw new InvalidArgumentsError(
          "QRL log subscription fromBlock cannot be greater than toBlock"
        );
      }
    }

    return this._registerSubscription({
      type: "logs",
      criteria,
      fromBound: from.kind === "number" ? from.value : undefined,
      toBound: to.kind === "number" ? to.value : undefined,
    });
  }

  public unsubscribe(subscriptionId: bigint): boolean {
    return this._subscriptions.delete(filterKey(subscriptionId));
  }

  public installedSubscriptionCount(): number {
    return this._subscriptions.size;
  }

  public installedFilterCount(): number {
    return this._filters.size;
  }

  public async estimateGas(
    transaction: any,
    sender: any,
    options: EstimateGasOptions = {}
  ): Promise<EstimateGasResult> {
    const upperBound: bigint = transaction.gasLimit;
    const zero: bigint = (global as any).BigInt(0);
    // tslint:disable-next-line:strict-comparisons
    if (upperBound <= zero) {
      throw new InvalidInputError(
        "gas estimation upper bound must be positive"
      );
    }

    const latestBlock = await this._getLatestBlock();
    const one: bigint = (global as any).BigInt(1);
    const latestBlockNumber: bigint = latestBlock.header.number;
    const stateManager =
      options.usePendingState === true
        ? this._pendingStateManager ?? this._stateManager
        : this._stateManager;
    const executionContext: GasEstimationExecutionContext = {
      sender,
      stateManager,
      vm: this._createVm(stateManager, false),
      context: {
        chainId: this._context.chainId ?? one,
        baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
        coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
        blockNumber: latestBlockNumber + one,
        timestamp:
          this._context.timestamp ??
          this._pendingBlockTimestamp ??
          this._calculateNextBlockTimestamp(latestBlock),
        gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
        noBaseFee: this._context.noBaseFee ?? true,
      },
    };
    const upperTransaction = this._copyTransactionWithGasLimit(
      transaction,
      upperBound
    );
    const upperExecution = await this._runTxAndRevertMutations(
      upperTransaction,
      executionContext
    );

    if (!upperExecution.success) {
      return {
        estimation: upperBound,
        runTxResult: upperExecution.runTxResult,
        error: upperExecution.error,
      };
    }

    const initialEstimation: bigint = upperExecution.runTxResult.gasUsed;
    return {
      estimation: await this._correctInitialEstimation(
        transaction,
        initialEstimation,
        upperBound,
        executionContext
      ),
      runTxResult: upperExecution.runTxResult,
    };
  }

  public async getLocalAccountAddresses(): Promise<string[]> {
    return [...this._localAccounts.values()].map((address) =>
      address.toString()
    );
  }

  public async runTransaction(
    transaction: any,
    sender: any
  ): Promise<RunTransactionResult> {
    const localSender = this._getLocalAccount(sender);
    return this._automine
      ? this._runTransactionInNewBlock(transaction, localSender)
      : this._runTransactionInPendingBlock(transaction, localSender);
  }

  public async runRawTransaction(
    transaction: any
  ): Promise<RunTransactionResult> {
    const sender = await this._getRawTransactionSender(transaction);
    return this._automine
      ? this._runTransactionInNewBlock(transaction, sender)
      : this._runTransactionInPendingBlock(transaction, sender);
  }

  public async runTransactionInNewBlock(
    transaction: any,
    sender: any
  ): Promise<RunTransactionInNewBlockResult> {
    return this._runTransactionInNewBlock(
      transaction,
      this._getLocalAccount(sender)
    );
  }

  public async runRawTransactionInNewBlock(
    transaction: any
  ): Promise<RunTransactionInNewBlockResult> {
    const sender = await this._getRawTransactionSender(transaction);
    return this._runTransactionInNewBlock(transaction, sender);
  }

  public async getPendingTransactions(): Promise<any[]> {
    return this._pendingTransactions.map((entry) => entry.transaction);
  }

  public async getPendingAccountBalance(address: any): Promise<bigint> {
    return (this._pendingStateManager ?? this._stateManager).getBalance(
      address
    );
  }

  public async getPendingAccountNonce(address: any): Promise<bigint> {
    return (this._pendingStateManager ?? this._stateManager).getNonce(address);
  }

  public async getPendingBlock(): Promise<Block> {
    const latestBlock = await this._getLatestBlock();
    const timestamp =
      this._pendingBlockTimestamp ??
      this._calculateNextBlockTimestamp(latestBlock);
    return this._buildBlockFromPending(
      latestBlock,
      timestamp,
      this._pendingStateManager ?? this._stateManager
    );
  }

  public async mineBlock(options: MineBlockOptions = {}): Promise<Block> {
    if (this._pendingTransactions.length === 0) {
      return this.mineEmptyBlock(options);
    }

    if (hasBlockOverrides(options)) {
      throw new InvalidInputError(
        "cannot override block options while pending transactions exist"
      );
    }

    return this._minePendingBlock();
  }

  public async setNextBlockTimestamp(timestamp: bigint): Promise<void> {
    const latestBlock = await this._getLatestBlock();
    const latestBlockTimestamp: bigint = latestBlock.header.timestamp;
    const lowerBound = this._pendingBlockTimestamp ?? latestBlockTimestamp;

    // tslint:disable-next-line:strict-comparisons
    if (timestamp <= lowerBound) {
      throw new InvalidInputError(
        `timestamp ${timestamp} is not greater than the next block timestamp lower bound ${lowerBound}`
      );
    }

    this._nextBlockTimestamp = timestamp;
  }

  public async increaseTime(increment: bigint): Promise<bigint> {
    const zero: bigint = (global as any).BigInt(0);
    // tslint:disable-next-line:strict-comparisons
    if (increment < zero) {
      throw new InvalidInputError("time increase must not be negative");
    }

    this._pendingTimeIncrease += increment;
    this._totalTimeIncrement += increment;
    return this._totalTimeIncrement;
  }

  public async getTimeIncrement(): Promise<bigint> {
    return this._totalTimeIncrement;
  }

  public async getNextBlockTimestamp(): Promise<bigint | undefined> {
    return this._nextBlockTimestamp;
  }

  public async takeSnapshot(): Promise<bigint> {
    const id = this._nextSnapshotId;
    this._nextSnapshotId += (global as any).BigInt(1);
    this._snapshots.push({
      id,
      latestBlock: await this._getLatestBlock(),
      stateManager: this._stateManager.shallowCopy(),
      pendingStateManager: this._pendingStateManager?.shallowCopy(),
      pendingTransactions: this._pendingTransactions.map((entry) => ({
        ...entry,
        transactionHash: new Uint8Array(entry.transactionHash),
      })),
      pendingBlockTimestamp: this._pendingBlockTimestamp,
      pendingTimeIncrease: this._pendingTimeIncrease,
      totalTimeIncrement: this._totalTimeIncrement,
      nextBlockTimestamp: this._nextBlockTimestamp,
      transactionsByHash: new Map(this._transactionsByHash),
      receiptsByTransactionHash: new Map(this._receiptsByTransactionHash),
      transactionHashToBlockHash: cloneHashMap(
        this._transactionHashToBlockHash
      ),
      stateBeforeByBlock: new Map(this._stateBeforeByBlock),
    });
    return id;
  }

  public async revertToSnapshot(id: bigint): Promise<boolean> {
    const snapshotIndex = this._snapshots.findIndex(
      (candidate) => candidate.id === id
    );
    if (snapshotIndex === -1) {
      return false;
    }

    const snapshot = this._snapshots[snapshotIndex];
    const removedBlocks = await this._getBlocksAfter(
      snapshot.latestBlock.header.number
    );
    this._blockchain.deleteAllFollowingBlocks(snapshot.latestBlock);
    this._replaceStateManager(snapshot.stateManager.shallowCopy());
    this._pendingTransactions.splice(
      0,
      this._pendingTransactions.length,
      ...snapshot.pendingTransactions
    );
    this._pendingStateManager = snapshot.pendingStateManager?.shallowCopy();
    this._pendingVm =
      this._pendingStateManager === undefined
        ? undefined
        : this._createVm(this._pendingStateManager);
    this._pendingBlockTimestamp = snapshot.pendingBlockTimestamp;
    this._pendingTimeIncrease = snapshot.pendingTimeIncrease;
    this._totalTimeIncrement = snapshot.totalTimeIncrement;
    this._nextBlockTimestamp = snapshot.nextBlockTimestamp;
    replaceMap(this._transactionsByHash, snapshot.transactionsByHash);
    replaceMap(
      this._receiptsByTransactionHash,
      snapshot.receiptsByTransactionHash
    );
    replaceMap(
      this._transactionHashToBlockHash,
      cloneHashMap(snapshot.transactionHashToBlockHash)
    );
    replaceMap(this._stateBeforeByBlock, snapshot.stateBeforeByBlock);

    this._resetFilterCursors(snapshot.latestBlock.header.number);
    for (const block of removedBlocks) {
      this._notifyRemovedLogSubscriptions(block);
    }

    this._snapshots.splice(snapshotIndex);
    return true;
  }

  public async mineEmptyBlock(options: MineBlockOptions = {}): Promise<Block> {
    const latestBlock = await this._getLatestBlock();
    const one: bigint = (global as any).BigInt(1);
    const latestBlockNumber: bigint = latestBlock.header.number;
    const timestamp = this._calculateNextBlockTimestamp(
      latestBlock,
      options.timestamp
    );

    const transactions: any[] = [];
    const receipts: any[] = [];
    const transactionsRoot = await this._runtime.blockQrl.genQRLTransactionsRoot(
      transactions
    );
    const receiptsRoot = await this._runtime.blockQrl.genQRLReceiptsRoot(
      receipts
    );
    const stateRoot = await this._stateManager.getStateRoot();
    const block = new this._runtime.blockQrl.QRLBlock({
      header: {
        parentHash: latestBlock.hash(),
        number: latestBlockNumber + one,
        timestamp,
        gasLimit:
          options.gasLimit ??
          this._context.gasLimit ??
          latestBlock.header.gasLimit,
        baseFee:
          options.baseFee ??
          this._context.baseFee ??
          latestBlock.header.baseFee,
        coinbase:
          options.coinbase ??
          this._context.coinbase ??
          latestBlock.header.coinbase,
        transactionsRoot,
        receiptsRoot,
        stateRoot,
      },
      transactions,
      receipts,
    });

    await this._putBlock(block);
    this._consumeTimeControls(options.timestamp);
    this._notifyBlockSubscriptions(block);
    return block;
  }

  public async runCall(
    call: CallParams,
    options: RunCallOptions = {}
  ): Promise<any> {
    const latestBlock = await this._getLatestBlock();
    const usePendingState = options.usePendingState === true;
    const one: bigint = (global as any).BigInt(1);
    const stateManager = usePendingState
      ? this._pendingStateManager ?? this._stateManager
      : this._stateManager;
    const vm =
      options.traceListener !== undefined
        ? this._createVm(
            stateManager,
            options.emitConsoleLogs ?? false,
            options.traceListener
          )
        : stateManager === this._stateManager
        ? this._vm
        : this._pendingVm ?? this._createVm(stateManager);

    await stateManager.checkpoint();
    try {
      if (call.value !== (global as any).BigInt(0)) {
        await stateManager.subBalance(call.from, call.value);
        await stateManager.addBalance(call.to, call.value);
      }

      return await vm.evm.runCall({
        to: call.to,
        caller: call.from,
        origin: call.from,
        data: call.data,
        value: call.value,
        gasLimit: call.gasLimit,
        context: {
          coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
          blockNumber: usePendingState
            ? (latestBlock.header.number as bigint) + one
            : latestBlock.header.number,
          timestamp:
            this._context.timestamp ??
            (usePendingState
              ? this._pendingBlockTimestamp ??
                this._calculateNextBlockTimestamp(latestBlock)
              : latestBlock.header.timestamp),
          gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
          chainId: this._context.chainId ?? (global as any).BigInt(1),
          baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
          gasPrice: call.gasPrice,
        },
      });
    } finally {
      await stateManager.revert();
    }
  }

  private async _correctInitialEstimation(
    transaction: any,
    initialEstimation: bigint,
    upperBound: bigint,
    executionContext: GasEstimationExecutionContext
  ): Promise<bigint> {
    const initialTransaction = this._copyTransactionWithGasLimit(
      transaction,
      initialEstimation
    );
    const initialExecution = await this._runTxAndRevertMutations(
      initialTransaction,
      executionContext
    );

    if (initialExecution.success) {
      return initialEstimation;
    }

    return this._binarySearchEstimation(
      transaction,
      initialEstimation,
      upperBound,
      executionContext
    );
  }

  private async _binarySearchEstimation(
    transaction: any,
    highestFailingEstimation: bigint,
    lowestSuccessfulEstimation: bigint,
    executionContext: GasEstimationExecutionContext,
    roundNumber: number = 0
  ): Promise<bigint> {
    // tslint:disable-next-line:strict-comparisons
    if (lowestSuccessfulEstimation <= highestFailingEstimation) {
      return lowestSuccessfulEstimation;
    }

    const maxRounds = 20;
    const diff = lowestSuccessfulEstimation - highestFailingEstimation;
    const minDiff = minimumGasEstimationDifference(highestFailingEstimation);
    // tslint:disable-next-line:strict-comparisons
    if (diff <= minDiff || roundNumber > maxRounds) {
      return lowestSuccessfulEstimation;
    }

    const two: bigint = (global as any).BigInt(2);
    const three: bigint = (global as any).BigInt(3);
    const midpoint = highestFailingEstimation + diff / two;
    const optimizedEstimation =
      roundNumber === 0 ? highestFailingEstimation * three : midpoint;
    const newEstimation =
      // tslint:disable-next-line:strict-comparisons
      optimizedEstimation > midpoint ? midpoint : optimizedEstimation;

    await new Promise((resolve) => setImmediate(resolve));

    const candidate = this._copyTransactionWithGasLimit(
      transaction,
      newEstimation
    );
    const execution = await this._runTxAndRevertMutations(
      candidate,
      executionContext
    );
    if (execution.success) {
      return this._binarySearchEstimation(
        transaction,
        highestFailingEstimation,
        newEstimation,
        executionContext,
        roundNumber + 1
      );
    }

    return this._binarySearchEstimation(
      transaction,
      newEstimation,
      lowestSuccessfulEstimation,
      executionContext,
      roundNumber + 1
    );
  }

  private async _runTxAndRevertMutations(
    transaction: any,
    executionContext: GasEstimationExecutionContext
  ): Promise<{
    success: boolean;
    runTxResult?: any;
    error?: Error;
  }> {
    await executionContext.stateManager.checkpoint();
    try {
      const runTxResult = await executionContext.vm.runTx({
        tx: transaction,
        sender: executionContext.sender,
        context: executionContext.context,
        skipBalance: true,
        skipNonce: true,
      });
      const error: Error | undefined = runTxResult.executionError;
      return {
        success: error === undefined && runTxResult.status !== 0,
        runTxResult,
        error,
      };
    } catch (error) {
      return { success: false, error: error as Error };
    } finally {
      await executionContext.stateManager.revert();
    }
  }

  private _copyTransactionWithGasLimit(
    transaction: any,
    gasLimit: bigint
  ): any {
    const Transaction = this._runtime.txQrl?.QRLDynamicFeeTransaction;
    if (Transaction === undefined) {
      throw new InvalidInputError(
        "QRL transaction constructor is unavailable for gas estimation"
      );
    }

    return new Transaction({
      chainId: transaction.chainId,
      nonce: transaction.nonce,
      gasTipCap: transaction.gasTipCap,
      gasFeeCap: transaction.gasFeeCap,
      gasLimit,
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      accessList: transaction.accessList,
      descriptor: transaction.descriptor,
      extraParams: transaction.extraParams,
      signature: transaction.signature,
      publicKey: transaction.publicKey,
    });
  }

  private async _buildBlockFromPending(
    latestBlock: Block,
    timestamp: bigint,
    stateManager: any
  ): Promise<Block> {
    const one: bigint = (global as any).BigInt(1);
    const latestBlockNumber: bigint = latestBlock.header.number;
    const blockNumber = latestBlockNumber + one;
    let cumulativeGasUsed: bigint = (global as any).BigInt(0);
    const transactions = this._pendingTransactions.map(
      (entry) => entry.transaction
    );
    const receipts = this._pendingTransactions.map((entry, index) => {
      cumulativeGasUsed += entry.runTxResult.gasUsed;
      return this._runtime.vmQrl.createQRLReceiptFromRunTxResult({
        result: entry.runTxResult,
        blockNumber,
        transactionIndex: index,
        cumulativeGasUsed,
      });
    });
    const transactionsRoot = await this._runtime.blockQrl.genQRLTransactionsRoot(
      transactions
    );
    const receiptsRoot = await this._runtime.blockQrl.genQRLReceiptsRoot(
      receipts
    );
    const stateRoot = await stateManager.getStateRoot();
    const draftBlock = new this._runtime.blockQrl.QRLBlock({
      header: {
        parentHash: latestBlock.hash(),
        number: blockNumber,
        timestamp,
        gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
        baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
        coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
        transactionsRoot,
        receiptsRoot,
        stateRoot,
      },
      transactions,
      receipts,
    });
    const blockHash = draftBlock.hash();
    let logIndexStart = 0;
    const includedReceipts = receipts.map((receipt, index) => {
      const includedReceipt = receipt.withInclusion({
        blockHash,
        blockNumber,
        transactionIndex: index,
        cumulativeGasUsed: receipt.cumulativeGasUsed,
        logIndexStart,
      });
      logIndexStart += receipt.logs.length;
      return includedReceipt;
    });

    return new this._runtime.blockQrl.QRLBlock({
      header: draftBlock.header,
      transactions,
      receipts: includedReceipts,
    });
  }

  private async _minePendingBlock(): Promise<Block> {
    const stateManager = this._pendingStateManager;
    const timestamp = this._pendingBlockTimestamp;
    if (stateManager === undefined || timestamp === undefined) {
      throw new InvalidInputError("Pending block state is unavailable");
    }

    const latestBlock = await this._getLatestBlock();
    const stateBefore = this._stateManager.shallowCopy();
    const block = await this._buildBlockFromPending(
      latestBlock,
      timestamp,
      stateManager
    );
    let blockWasStored = false;

    try {
      await this._putBlock(block);
      blockWasStored = true;
      this._replaceStateManager(stateManager);
      this._rememberStateBeforeBlock(block, stateBefore);
      this._pendingTransactions.forEach((entry, index) => {
        this._indexMinedTransaction(
          entry.transactionHash,
          entry.transaction,
          entry.sender,
          block.receipts[index],
          block
        );
      });
      this._pendingTransactions.splice(0);
      this._pendingStateManager = undefined;
      this._pendingVm = undefined;
      this._pendingBlockTimestamp = undefined;
      this._notifyBlockSubscriptions(block);
      return block;
    } catch (error) {
      if (blockWasStored) {
        await this._deleteBlock(block.hash());
      }
      throw error;
    }
  }

  private async _getRawTransactionSender(transaction: any): Promise<any> {
    const signer = this._rawTransactionSigner;
    if (signer === undefined) {
      throw new InvalidInputError("Raw transaction signer is not configured");
    }

    const chainId: bigint = this._context.chainId ?? (global as any).BigInt(1);
    if (transaction.chainId !== chainId) {
      throw new InvalidInputError(
        `Invalid transaction chain id ${transaction.chainId}; expected ${chainId}`
      );
    }

    let signatureIsValid = false;
    try {
      signatureIsValid = await signer.verify(transaction);
    } catch (_error) {
      signatureIsValid = false;
    }
    if (!signatureIsValid) {
      throw new InvalidInputError("Invalid transaction signature");
    }

    try {
      return await signer.sender(transaction);
    } catch (_error) {
      throw new InvalidInputError("Invalid transaction sender");
    }
  }

  private async _runTransactionInPendingBlock(
    transaction: any,
    sender: any
  ): Promise<RunTransactionResult> {
    const latestBlock = await this._getLatestBlock();
    const isFirstPendingTransaction = this._pendingTransactions.length === 0;
    const timestamp =
      this._pendingBlockTimestamp ??
      this._calculateNextBlockTimestamp(latestBlock);
    const stateManager =
      this._pendingStateManager ?? this._stateManager.shallowCopy();
    const vm = this._pendingVm ?? this._createVm(stateManager);
    const stateBefore = stateManager.shallowCopy();
    const transactionHash: Uint8Array = transaction.hash();
    const one: bigint = (global as any).BigInt(1);
    const latestBlockNumber: bigint = latestBlock.header.number;
    let runTxResult: any;

    try {
      runTxResult = await vm.runTx({
        tx: transaction,
        sender,
        context: {
          chainId: this._context.chainId ?? (global as any).BigInt(1),
          baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
          coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
          blockNumber: latestBlockNumber + one,
          timestamp,
          gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
          noBaseFee: this._context.noBaseFee ?? true,
        },
      });
    } catch (error) {
      if (!isFirstPendingTransaction) {
        this._pendingStateManager = stateBefore;
        this._pendingVm = this._createVm(stateBefore);
      }
      throw error;
    }

    if (isFirstPendingTransaction) {
      this._pendingStateManager = stateManager;
      this._pendingVm = vm;
      this._pendingBlockTimestamp = timestamp;
      this._consumeTimeControls();
    }

    const actualSender = runTxResult.sender ?? sender;
    this._pendingTransactions.push({
      transaction,
      transactionHash: new Uint8Array(transactionHash),
      sender: actualSender,
      runTxResult,
    });
    this._transactionsByHash.set(hashKey(transactionHash), {
      transaction,
      sender: actualSender,
    });
    this._notifyPendingTransactionSubscriptions(transaction, actualSender);

    return { transaction, runTxResult };
  }

  private async _runTransactionInNewBlock(
    transaction: any,
    sender: any
  ): Promise<RunTransactionInNewBlockResult> {
    const latestBlock = await this._getLatestBlock();
    const one: bigint = (global as any).BigInt(1);
    const latestBlockNumber: bigint = latestBlock.header.number;
    const blockNumber = latestBlockNumber + one;
    const timestamp = this._calculateNextBlockTimestamp(latestBlock);
    const transactionHash: Uint8Array = transaction.hash();
    const stateBefore = this._stateManager.shallowCopy();
    let storedBlock: Block | undefined;

    await this._stateManager.checkpoint();
    try {
      const runTxResult = await this._vm.runTx({
        tx: transaction,
        sender,
        context: {
          chainId: this._context.chainId ?? one,
          baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
          coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
          blockNumber,
          timestamp,
          gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
          noBaseFee: this._context.noBaseFee ?? true,
        },
      });
      const receipt = this._runtime.vmQrl.createQRLReceiptFromRunTxResult({
        result: runTxResult,
        blockNumber,
        transactionIndex: 0,
        cumulativeGasUsed: runTxResult.gasUsed,
      });
      const transactions = [transaction];
      const receipts = [receipt];
      const transactionsRoot = await this._runtime.blockQrl.genQRLTransactionsRoot(
        transactions
      );
      const receiptsRoot = await this._runtime.blockQrl.genQRLReceiptsRoot(
        receipts
      );
      const stateRoot = await this._stateManager.getStateRoot();
      const draftBlock = new this._runtime.blockQrl.QRLBlock({
        header: {
          parentHash: latestBlock.hash(),
          number: blockNumber,
          timestamp,
          gasLimit: this._context.gasLimit ?? latestBlock.header.gasLimit,
          baseFee: this._context.baseFee ?? latestBlock.header.baseFee,
          coinbase: this._context.coinbase ?? latestBlock.header.coinbase,
          transactionsRoot,
          receiptsRoot,
          stateRoot,
        },
        transactions,
        receipts,
      });
      const includedReceipt = receipt.withInclusion({
        blockHash: draftBlock.hash(),
        blockNumber,
        transactionIndex: 0,
        cumulativeGasUsed: receipt.cumulativeGasUsed,
        logIndexStart: 0,
      });
      const block = new this._runtime.blockQrl.QRLBlock({
        header: draftBlock.header,
        transactions,
        receipts: [includedReceipt],
      });

      await this._putBlock(block);
      storedBlock = block;
      await this._stateManager.commit();
      this._rememberStateBeforeBlock(block, stateBefore);
      this._indexMinedTransaction(
        transactionHash,
        transaction,
        sender,
        includedReceipt,
        block
      );
      this._consumeTimeControls();
      this._notifyPendingTransactionSubscriptions(transaction, sender);
      this._notifyBlockSubscriptions(block);

      return {
        transaction,
        runTxResult,
        receipt: includedReceipt,
        block,
      };
    } catch (error) {
      if (storedBlock !== undefined) {
        await this._deleteBlock(storedBlock.hash());
      }
      await this._stateManager.revert();
      throw error;
    }
  }

  private _createVm(
    stateManager: any,
    emitConsoleLogs: boolean = true,
    traceListener?: any
  ): any {
    const consoleTraceListener = emitConsoleLogs
      ? createQrlConsoleLogTraceListener(this._consoleLogListener)
      : undefined;
    const evm = new this._runtime.evmQrl.QRLEVM({
      stateManager,
      allowUnlimitedContractSize: this._allowUnlimitedContractSize,
      traceListener: combineQrlTraceListeners(
        consoleTraceListener,
        traceListener
      ),
    });
    return new this._runtime.vmQrl.QRLVM({
      stateManager,
      evm,
      context: this._context,
    });
  }

  private _replaceStateManager(stateManager: any): void {
    this._vm = this._createVm(stateManager);
    this._stateManager = stateManager;
  }

  private _rememberStateBeforeBlock(block: Block, stateManager: any): void {
    this._stateBeforeByBlock.set(hashKey(block.hash()), stateManager);
  }

  private _indexMinedTransaction(
    transactionHash: Uint8Array,
    transaction: any,
    sender: any,
    receipt: any,
    block: Block
  ): void {
    const key = hashKey(transactionHash);
    this._transactionsByHash.set(key, { transaction, sender });
    this._receiptsByTransactionHash.set(key, receipt);
    this._transactionHashToBlockHash.set(key, new Uint8Array(block.hash()));
  }

  private _calculateNextBlockTimestamp(
    latestBlock: Block,
    explicitTimestamp?: bigint
  ): bigint {
    const one: bigint = (global as any).BigInt(1);
    const latestBlockTimestamp: bigint = latestBlock.header.timestamp;
    const timestamp =
      explicitTimestamp ??
      this._nextBlockTimestamp ??
      latestBlockTimestamp + one + this._pendingTimeIncrease;

    // tslint:disable-next-line:strict-comparisons
    if (timestamp <= latestBlockTimestamp) {
      throw new InvalidInputError(
        `timestamp ${timestamp} is not greater than the latest block timestamp ${latestBlockTimestamp}`
      );
    }

    return timestamp;
  }

  private _consumeTimeControls(explicitTimestamp?: bigint): void {
    if (explicitTimestamp !== undefined) {
      return;
    }

    if (this._nextBlockTimestamp !== undefined) {
      this._nextBlockTimestamp = undefined;
      return;
    }

    this._pendingTimeIncrease = (global as any).BigInt(0);
  }

  private _resetFilterCursors(latest: bigint): void {
    const one: bigint = (global as any).BigInt(1);
    for (const filter of this._filters.values()) {
      if (filter.type === "block") {
        // tslint:disable-next-line:strict-comparisons
        if (filter.lastBlock > latest) {
          filter.lastBlock = latest;
        }
        continue;
      }
      if (filter.type === "log") {
        // tslint:disable-next-line:strict-comparisons
        if (filter.nextBlock > latest + one) {
          filter.nextBlock = maxBigInt(filter.minimumBlock, latest + one);
        }
        continue;
      }
      filter.reported.clear();
    }
  }

  private _registerSubscription(subscription: QRLSubscription): bigint {
    const id = this._nextSubscriptionId;
    this._nextSubscriptionId += (global as any).BigInt(1);
    this._subscriptions.set(filterKey(id), subscription);
    return id;
  }

  private _notifyPendingTransactionSubscriptions(
    transaction: any,
    sender: any
  ): void {
    for (const [id, subscription] of this._subscriptions) {
      if (subscription.type !== "newPendingTransactions") {
        continue;
      }

      const result = subscription.fullObjects
        ? getPendingRpcTransaction(transaction, sender)
        : bufferToRpcData(transaction.hash());
      this._emitSubscription(id, result);
    }
  }

  private _notifyBlockSubscriptions(block: Block): void {
    for (const [id, subscription] of this._subscriptions) {
      if (subscription.type === "newHeads") {
        this._emitSubscription(id, getRpcBlockHeader(block));
        continue;
      }
      if (
        subscription.type !== "logs" ||
        !subscriptionMatchesBlock(subscription, block.header.number)
      ) {
        continue;
      }

      for (const log of formatMatchingLogs(block, subscription.criteria)) {
        this._emitSubscription(id, log);
      }
    }
  }

  private _notifyRemovedLogSubscriptions(block: Block): void {
    for (const [id, subscription] of this._subscriptions) {
      if (
        subscription.type !== "logs" ||
        !subscriptionMatchesBlock(subscription, block.header.number)
      ) {
        continue;
      }

      for (const log of formatMatchingLogs(block, subscription.criteria)) {
        this._emitSubscription(id, { ...log, removed: true });
      }
    }
  }

  private _emitSubscription(id: string, result: unknown): void {
    try {
      this.emit("ethEvent", {
        filterId: (global as any).BigInt(id),
        result,
      });
    } catch (_error) {
      // Subscription listeners must not interrupt transaction processing.
    }
  }

  private async _getBlocksAfter(blockNumber: bigint): Promise<Block[]> {
    if (!this._hasLogSubscriptions()) {
      return [];
    }

    const latest = await this.getLatestBlockNumber();
    const one: bigint = (global as any).BigInt(1);
    const blocks: Block[] = [];
    for (
      let number = blockNumber + one;
      // tslint:disable-next-line:strict-comparisons
      number <= latest;
      number += one
    ) {
      const block = await this.getBlockByNumber(number);
      if (block !== undefined) {
        blocks.push(block);
      }
    }
    return blocks;
  }

  private _hasLogSubscriptions(): boolean {
    for (const subscription of this._subscriptions.values()) {
      if (subscription.type === "logs") {
        return true;
      }
    }
    return false;
  }

  private _registerFilter(filter: QRLInstalledFilter): bigint {
    this._sweepExpiredFilters();
    const id = this._nextFilterId;
    this._nextFilterId += (global as any).BigInt(1);
    this._filters.set(filterKey(id), filter);
    this._scheduleFilterSweep();
    return id;
  }

  private _lookupFilter(filterId: bigint): QRLInstalledFilter | undefined {
    this._sweepExpiredFilters();
    const filter = this._filters.get(filterKey(filterId));
    if (filter === undefined) {
      return undefined;
    }
    filter.deadline = this._filterDeadline();
    this._scheduleFilterSweep();
    return filter;
  }

  private _filterDeadline(): number {
    return this._filterNow() + QRL_FILTER_DEADLINE_MS;
  }

  private _sweepExpiredFilters(): void {
    const now = this._filterNow();
    for (const [id, filter] of this._filters) {
      if (filter.deadline <= now) {
        this._filters.delete(id);
      }
    }
  }

  private _scheduleFilterSweep(): void {
    if (this._filterExpiryTimer !== undefined) {
      clearTimeout(this._filterExpiryTimer);
      this._filterExpiryTimer = undefined;
    }

    let earliest: number | undefined;
    for (const filter of this._filters.values()) {
      if (earliest === undefined || filter.deadline < earliest) {
        earliest = filter.deadline;
      }
    }
    if (earliest === undefined) {
      return;
    }

    const delay = Math.max(0, earliest - this._filterNow());
    this._filterExpiryTimer = setTimeout(() => {
      this._filterExpiryTimer = undefined;
      this._sweepExpiredFilters();
      this._scheduleFilterSweep();
    }, delay);
    this._filterExpiryTimer.unref?.();
  }

  private async _putBlock(block: Block): Promise<void> {
    return new Promise((resolve, reject) => {
      this._blockchain.putBlock(block, (error) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private _initLocalAccounts(localAccounts: LocalAccount[]): void {
    for (const account of localAccounts) {
      this._localAccounts.set(accountKey(account.address), account.address);
    }
  }

  private _getLocalAccount(sender: any): any {
    const key = accountKey(sender);
    const account = this._localAccounts.get(key);
    if (account === undefined) {
      throw new InvalidInputError(`unknown account ${key}`);
    }
    return account;
  }

  private async _deleteBlock(blockHash: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this._blockchain.delBlock(blockHash, (error) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function combineQrlTraceListeners(
  first: any | undefined,
  second: any | undefined
): any | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }

  return {
    enterFrame: (frame: any) => {
      callTraceListener(first.enterFrame, frame);
      callTraceListener(second.enterFrame, frame);
    },
    exitFrame: (frame: any) => {
      callTraceListener(first.exitFrame, frame);
      callTraceListener(second.exitFrame, frame);
    },
    step: (step: any) => {
      callTraceListener(first.step, step);
      callTraceListener(second.step, step);
    },
    precompile: (frame: any) => {
      callTraceListener(first.precompile, frame);
      callTraceListener(second.precompile, frame);
    },
  };
}

function callTraceListener(
  callback: ((value: any) => void) | undefined,
  value: any
): void {
  try {
    callback?.(value);
  } catch {
    // Observers are diagnostic and must never affect VM execution.
  }
}

function filterKey(id: bigint): string {
  return id.toString();
}

function minBigInt(left: bigint, right: bigint): bigint {
  // tslint:disable-next-line:strict-comparisons
  return left < right ? left : right;
}

function formatMatchingLogs(
  block: Block,
  filter: QRLLogFilter
): RpcLogOutput[] {
  return collectMatchingLogs(block as any, filter).map((log) =>
    getRpcLog(log as any)
  );
}

function getPendingRpcTransaction(transaction: any, sender: any): any {
  return {
    ...getRpcTransaction(transaction, undefined, undefined, false, sender),
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
  };
}

function getRpcBlockHeader(block: Block): any {
  if (typeof block.header.toJSON === "function") {
    return block.header.toJSON();
  }

  return {
    hash: bufferToRpcData(block.hash()),
    parentHash: bufferToRpcData(block.header.parentHash),
    number: numberToRpcQuantity(block.header.number),
    timestamp: numberToRpcQuantity(block.header.timestamp),
  };
}

function subscriptionMatchesBlock(
  subscription: Extract<QRLSubscription, { type: "logs" }>,
  blockNumber: bigint
): boolean {
  if (subscription.fromBound !== undefined) {
    // tslint:disable-next-line:strict-comparisons
    if (blockNumber < subscription.fromBound) {
      return false;
    }
  }
  if (subscription.toBound !== undefined) {
    // tslint:disable-next-line:strict-comparisons
    if (blockNumber > subscription.toBound) {
      return false;
    }
  }
  return true;
}

function minimumGasEstimationDifference(estimation: bigint): bigint {
  const bigint = (value: number): bigint => (global as any).BigInt(value);
  // tslint:disable-next-line:strict-comparisons
  if (estimation >= bigint(4_000_000)) {
    return bigint(50_000);
  }
  // tslint:disable-next-line:strict-comparisons
  if (estimation >= bigint(1_000_000)) {
    return bigint(10_000);
  }
  // tslint:disable-next-line:strict-comparisons
  if (estimation >= bigint(100_000)) {
    return bigint(1_000);
  }
  // tslint:disable-next-line:strict-comparisons
  if (estimation >= bigint(50_000)) {
    return bigint(500);
  }
  // tslint:disable-next-line:strict-comparisons
  if (estimation >= bigint(30_000)) {
    return bigint(300);
  }
  return bigint(200);
}

function hasBlockOverrides(options: MineBlockOptions): boolean {
  return (
    options.timestamp !== undefined ||
    options.gasLimit !== undefined ||
    options.baseFee !== undefined ||
    options.coinbase !== undefined
  );
}

function cloneHashMap(
  source: Map<string, Uint8Array>
): Map<string, Uint8Array> {
  return new Map(
    [...source].map(([key, hash]) => [key, new Uint8Array(hash)] as const)
  );
}

function replaceMap<KeyT, ValueT>(
  target: Map<KeyT, ValueT>,
  source: Map<KeyT, ValueT>
): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

function hashKey(hash: Uint8Array): string {
  return Buffer.from(hash).toString("hex").toLowerCase();
}

function accountKey(address: any): string {
  return address.toString().toLowerCase();
}
