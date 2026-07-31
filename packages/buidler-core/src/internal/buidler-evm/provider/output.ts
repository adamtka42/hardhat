interface QrlAddressLike {
  toString(): string;
}

interface QrlTransactionLike {
  type: number | bigint;
  chainId: bigint;
  nonce: bigint;
  to?: QrlAddressLike;
  gasLimit: bigint;
  gasFeeCap: bigint;
  gasTipCap: bigint;
  value: bigint;
  data: Uint8Array;
  hash(): Uint8Array;
}

interface QrlLogLike {
  address: QrlAddressLike;
  topics: ReadonlyArray<Uint8Array>;
  data: Uint8Array;
  blockNumber?: bigint;
  txHash?: Uint8Array;
  txIndex?: number;
  blockHash?: Uint8Array;
  index?: number;
  removed: boolean;
}

interface QrlReceiptLike {
  txHash: Uint8Array;
  blockHash?: Uint8Array;
  blockNumber?: bigint;
  transactionIndex?: number;
  from: QrlAddressLike;
  to?: QrlAddressLike;
  createdAddress?: QrlAddressLike;
  status: 0 | 1;
  gasUsed: bigint;
  cumulativeGasUsed: bigint;
  effectiveGasPrice?: bigint;
  logs: ReadonlyArray<QrlLogLike>;
  logsBloom: Uint8Array;
}

interface QrlBlockLike {
  header: {
    parentHash: Uint8Array;
    number: bigint;
    timestamp: bigint;
    gasLimit: bigint;
    gasUsed: bigint;
    baseFee: bigint;
    coinbase: QrlAddressLike;
    stateRoot: Uint8Array;
    transactionsRoot: Uint8Array;
    receiptsRoot: Uint8Array;
    logsBloom: Uint8Array;
  };
  transactions: ReadonlyArray<QrlTransactionLike>;
  receipts: ReadonlyArray<QrlReceiptLike>;
  hash(): Uint8Array;
}

export interface RpcBlockOutput {
  hash: string;
  parentHash: string;
  number: string;
  timestamp: string;
  gasLimit: string;
  gasUsed: string;
  baseFeePerGas: string;
  miner: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  transactions: string[] | RpcTransactionOutput[];
  receipts: RpcTransactionReceiptOutput[];
}

export interface RpcTransactionOutput {
  hash: string;
  type: string;
  chainId: string;
  nonce: string;
  from?: string;
  to?: string;
  gas: string;
  gasLimit: string;
  gasFeeCap: string;
  gasTipCap: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  value: string;
  input: string;
  data: string;
  blockHash?: string;
  blockNumber?: string;
  transactionIndex?: string;
}

export interface RpcTransactionReceiptOutput {
  transactionHash: string;
  blockHash?: string;
  blockNumber?: string;
  transactionIndex?: string;
  from: string;
  to?: string;
  contractAddress?: string;
  status: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  effectiveGasPrice?: string;
  logsBloom: string;
  logs: RpcLogOutput[];
}

export interface RpcLogOutput {
  address: string;
  topics: string[];
  data: string;
  blockNumber?: string;
  transactionHash?: string;
  transactionIndex?: string;
  blockHash?: string;
  logIndex?: string;
  removed: boolean;
}

export interface QrlRawStructLogOutputInput {
  pc: number;
  opcode: number;
  depth: number;
  gasLeft: bigint;
  gasCost: bigint;
  stack?: Array<bigint>;
  memory?: Uint8Array;
}

export interface RpcStructLogOutput {
  pc: number;
  op: string;
  gas: number;
  gasCost: number;
  depth: number;
  stack?: string[];
  memory?: string[];
}

export interface RpcDebugTraceOutput {
  gas: number;
  failed: boolean;
  returnValue: string;
  structLogs: RpcStructLogOutput[];
}

// tslint:disable only-hardhat-error

export function numberToRpcQuantity(n: number | bigint): string {
  const normalized = typeof n === "number" ? (global as any).BigInt(n) : n;
  if (normalized < (global as any).BigInt(0)) {
    throw new Error("QRL quantity cannot be negative");
  }
  return `0x${normalized.toString(16)}`;
}

export function bufferToRpcData(buffer: Uint8Array, pad: number = 0): string {
  let value = `0x${Buffer.from(buffer).toString("hex")}`;
  if (pad > 0 && value.length < pad + 2) {
    value = `0x${"0".repeat(pad + 2 - value.length)}${value.slice(2)}`;
  }
  return value;
}

export function getRpcBlock(
  block: QrlBlockLike,
  includeTransactions = true
): RpcBlockOutput {
  return {
    hash: bufferToRpcData(block.hash()),
    parentHash: bufferToRpcData(block.header.parentHash),
    number: numberToRpcQuantity(block.header.number),
    timestamp: numberToRpcQuantity(block.header.timestamp),
    gasLimit: numberToRpcQuantity(block.header.gasLimit),
    gasUsed: numberToRpcQuantity(block.header.gasUsed),
    baseFeePerGas: numberToRpcQuantity(block.header.baseFee),
    miner: block.header.coinbase.toString(),
    stateRoot: bufferToRpcData(block.header.stateRoot),
    transactionsRoot: bufferToRpcData(block.header.transactionsRoot),
    receiptsRoot: bufferToRpcData(block.header.receiptsRoot),
    logsBloom: bufferToRpcData(block.header.logsBloom),
    transactions: includeTransactions
      ? block.transactions.map((tx, index) =>
          getRpcTransaction(
            tx,
            block,
            index,
            false,
            block.receipts[index]?.from
          )
        )
      : block.transactions.map((tx) => bufferToRpcData(tx.hash())),
    receipts: block.receipts.map((receipt) =>
      getRpcTransactionReceipt(receipt)
    ),
  };
}

export function getRpcTransaction(
  tx: QrlTransactionLike,
  block?: QrlBlockLike,
  index?: number,
  txHashOnly?: false,
  from?: QrlAddressLike
): RpcTransactionOutput;

export function getRpcTransaction(
  tx: QrlTransactionLike,
  block: QrlBlockLike | undefined,
  index: number | undefined,
  txHashOnly: true,
  from?: QrlAddressLike
): string;

export function getRpcTransaction(
  tx: QrlTransactionLike,
  block?: QrlBlockLike,
  index?: number,
  txHashOnly?: boolean,
  from?: QrlAddressLike
): string | RpcTransactionOutput;

export function getRpcTransaction(
  tx: QrlTransactionLike,
  block?: QrlBlockLike,
  index?: number,
  txHashOnly = false,
  from?: QrlAddressLike
): string | RpcTransactionOutput {
  if (txHashOnly) {
    return bufferToRpcData(tx.hash());
  }

  return {
    hash: bufferToRpcData(tx.hash()),
    type: numberToRpcQuantity(tx.type),
    chainId: numberToRpcQuantity(tx.chainId),
    nonce: numberToRpcQuantity(tx.nonce),
    from: from?.toString(),
    to: tx.to?.toString(),
    gas: numberToRpcQuantity(tx.gasLimit),
    gasLimit: numberToRpcQuantity(tx.gasLimit),
    gasFeeCap: numberToRpcQuantity(tx.gasFeeCap),
    gasTipCap: numberToRpcQuantity(tx.gasTipCap),
    maxFeePerGas: numberToRpcQuantity(tx.gasFeeCap),
    maxPriorityFeePerGas: numberToRpcQuantity(tx.gasTipCap),
    value: numberToRpcQuantity(tx.value),
    input: bufferToRpcData(tx.data),
    data: bufferToRpcData(tx.data),
    blockHash: block === undefined ? undefined : bufferToRpcData(block.hash()),
    blockNumber:
      block === undefined
        ? undefined
        : numberToRpcQuantity(block.header.number),
    transactionIndex:
      index === undefined ? undefined : numberToRpcQuantity(index),
  };
}

export function getRpcTransactionReceipt(
  receipt: QrlReceiptLike
): RpcTransactionReceiptOutput {
  return {
    transactionHash: bufferToRpcData(receipt.txHash),
    blockHash:
      receipt.blockHash === undefined
        ? undefined
        : bufferToRpcData(receipt.blockHash),
    blockNumber:
      receipt.blockNumber === undefined
        ? undefined
        : numberToRpcQuantity(receipt.blockNumber),
    transactionIndex:
      receipt.transactionIndex === undefined
        ? undefined
        : numberToRpcQuantity(receipt.transactionIndex),
    from: receipt.from.toString(),
    to: receipt.to?.toString(),
    contractAddress: receipt.createdAddress?.toString(),
    status: numberToRpcQuantity(receipt.status),
    gasUsed: numberToRpcQuantity(receipt.gasUsed),
    cumulativeGasUsed: numberToRpcQuantity(receipt.cumulativeGasUsed),
    effectiveGasPrice:
      receipt.effectiveGasPrice === undefined
        ? undefined
        : numberToRpcQuantity(receipt.effectiveGasPrice),
    logsBloom: bufferToRpcData(receipt.logsBloom),
    logs: receipt.logs.map((log) => getRpcLog(log)),
  };
}

export function getRpcLog(log: QrlLogLike): RpcLogOutput {
  return {
    address: log.address.toString(),
    topics: log.topics.map((topic) => bufferToRpcData(topic)),
    data: bufferToRpcData(log.data),
    blockNumber:
      log.blockNumber === undefined
        ? undefined
        : numberToRpcQuantity(log.blockNumber),
    transactionHash:
      log.txHash === undefined ? undefined : bufferToRpcData(log.txHash),
    transactionIndex:
      log.txIndex === undefined ? undefined : numberToRpcQuantity(log.txIndex),
    blockHash:
      log.blockHash === undefined ? undefined : bufferToRpcData(log.blockHash),
    logIndex:
      log.index === undefined ? undefined : numberToRpcQuantity(log.index),
    removed: log.removed,
  };
}

export function getRpcDebugTrace(
  result: { gasUsed: bigint; returnValue: Uint8Array; failed: boolean },
  steps: QrlRawStructLogOutputInput[],
  opcodeName: (opcode: number) => string
): RpcDebugTraceOutput {
  return {
    gas: Number(result.gasUsed),
    failed: result.failed,
    returnValue: Buffer.from(result.returnValue).toString("hex"),
    structLogs: steps.map((step) => {
      const output: RpcStructLogOutput = {
        pc: step.pc,
        op: opcodeName(step.opcode),
        gas: Number(step.gasLeft),
        gasCost: Number(step.gasCost),
        depth: step.depth + 1,
      };
      if (step.stack !== undefined) {
        output.stack = step.stack.map(
          (value) => `0x${(value as any).toString(16)}`
        );
      }
      if (step.memory !== undefined) {
        output.memory = getRpcTraceMemory(step.memory);
      }
      return output;
    }),
  };
}

function getRpcTraceMemory(memory: Uint8Array): string[] {
  const words: string[] = [];
  for (let offset = 0; offset < memory.length; offset += 64) {
    words.push(
      Buffer.from(memory.slice(offset, offset + 64))
        .toString("hex")
        .padEnd(128, "0")
    );
  }
  return words;
}
