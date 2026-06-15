import {
  Artifact,
  HardhatRuntimeEnvironment,
  QrlContract,
  QrlContractFactory,
  QrlContractFunctionMap,
  QrlDeploymentResult,
  QrlRuntimeHelpers,
  QrlTransactionRequest,
  QrlWaitOptions,
} from "../../types";
import { readArtifact } from "../artifacts";
import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

import {
  decodeQrlEventLog,
  decodeQrlFunctionResult,
  decodeQrlReceiptLogs,
  encodeQrlConstructorArgs,
  encodeQrlFunctionData,
} from "./abi";
import { normalizeQrlAddress } from "./address";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120000;
const HEX_DATA_REGEX = /^(0x)?[0-9a-fA-F]*$/;

interface QrlFunctionFragment {
  type?: string;
  name?: string;
  inputs?: any[];
  stateMutability?: string;
  constant?: boolean;
}

export function createQrlRuntimeHelpers(
  bre: HardhatRuntimeEnvironment
): QrlRuntimeHelpers {
  async function readQrlArtifact(contractName: string): Promise<Artifact> {
    return readArtifact(bre.config.paths.artifacts, contractName);
  }

  async function getContractFactory(
    contractName: string
  ): Promise<QrlContractFactory> {
    const artifact = await readQrlArtifact(contractName);

    return {
      contractName,
      artifact,
      deploy: (
        tx: QrlTransactionRequest = {},
        constructorDataOrArgs: string | any[] = "0x",
        waitOptions: QrlWaitOptions = {}
      ) => deployContract(contractName, tx, constructorDataOrArgs, waitOptions),
      attach: (address: string) =>
        getContractFromArtifact(artifact, address, call, sendTransaction),
    };
  }

  async function getContractAt(
    contractName: string,
    address: string
  ): Promise<QrlContract> {
    const artifact = await readQrlArtifact(contractName);

    return getContractFromArtifact(artifact, address, call, sendTransaction);
  }

  async function sendTransaction(tx: QrlTransactionRequest): Promise<string> {
    return bre.network.provider.send("qrl_sendTransaction", [tx]);
  }

  async function call(
    tx: QrlTransactionRequest,
    blockTag: string = "latest"
  ): Promise<string> {
    return bre.network.provider.send("qrl_call", [tx, blockTag]);
  }

  async function waitForTransaction(
    txHash: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
  ): Promise<any> {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const receipt = await bre.network.provider.send(
        "qrl_getTransactionReceipt",
        [txHash]
      );

      if (receipt !== null && receipt !== undefined) {
        assertReceiptMatchesTransaction(receipt, txHash);
        return receipt;
      }

      await sleep(pollIntervalMs);
    }

    throw new HardhatError(ERRORS.NETWORK.NETWORK_TIMEOUT);
  }

  async function deployContract(
    contractName: string,
    tx: QrlTransactionRequest = {},
    constructorDataOrArgs: string | any[] = "0x",
    waitOptions: QrlWaitOptions = {}
  ): Promise<QrlDeploymentResult> {
    const artifact = await readQrlArtifact(contractName);
    const constructorData = Array.isArray(constructorDataOrArgs)
      ? encodeQrlConstructorArgs(artifact.abi, constructorDataOrArgs)
      : constructorDataOrArgs;
    const data = joinHexData(artifact.bytecode, constructorData);
    const hash = await sendTransaction({
      ...tx,
      data,
    });
    const receipt = await waitForTransaction(
      hash,
      waitOptions.timeoutMs,
      waitOptions.pollIntervalMs
    );

    if (isFailedReceipt(receipt)) {
      throw new HardhatError(ERRORS.NETWORK.DEPLOYMENT_FAILED, {
        status: receipt.status,
        txHash: hash,
      });
    }

    if (
      receipt.contractAddress === undefined ||
      receipt.contractAddress === null
    ) {
      throw new HardhatError(ERRORS.NETWORK.MISSING_CONTRACT_ADDRESS, {
        txHash: hash,
      });
    }

    const contractAddress = normalizeQrlAddress(receipt.contractAddress);

    return {
      hash,
      receipt,
      address: contractAddress,
    };
  }

  return {
    call,
    deployContract,
    getContractAt,
    getContractFactory,
    readArtifact: readQrlArtifact,
    sendTransaction,
    waitForTransaction,
  };
}

function isFailedReceipt(receipt: any): boolean {
  return (
    receipt.status === false || receipt.status === "0x0" || receipt.status === 0
  );
}

function assertReceiptMatchesTransaction(receipt: any, txHash: string) {
  if (
    receipt.transactionHash === undefined ||
    receipt.transactionHash === null
  ) {
    return;
  }

  if (String(receipt.transactionHash).toLowerCase() !== txHash.toLowerCase()) {
    throw new HardhatError(ERRORS.NETWORK.TRANSACTION_RECEIPT_MISMATCH, {
      actual: receipt.transactionHash,
      expected: txHash,
    });
  }
}

function getContractFromArtifact(
  artifact: Artifact,
  address: string,
  call: QrlRuntimeHelpers["call"],
  sendTransaction: QrlRuntimeHelpers["sendTransaction"]
): QrlContract {
  const contractAddress = normalizeQrlAddress(address);

  const callFunction = async (
    functionName: string,
    args: any[] = [],
    tx: Omit<QrlTransactionRequest, "to" | "data"> = {},
    blockTag?: string
  ) => {
    const data = encodeQrlFunctionData(artifact.abi, functionName, args);
    const result = await call({ ...tx, to: contractAddress, data }, blockTag);
    return decodeQrlFunctionResult(artifact.abi, functionName, result);
  };
  const sendFunction = (
    functionName: string,
    args: any[] = [],
    tx: Omit<QrlTransactionRequest, "to" | "data"> = {}
  ) => {
    const data = encodeQrlFunctionData(artifact.abi, functionName, args);
    return sendTransaction({ ...tx, to: contractAddress, data });
  };
  const functionMaps = createContractFunctionMaps(
    artifact,
    callFunction,
    sendFunction
  );

  return {
    address: contractAddress,
    artifact,
    contractName: artifact.contractName,
    callStatic: functionMaps.callStatic,
    encodeFunctionData: (functionName: string, args: any[] = []) =>
      encodeQrlFunctionData(artifact.abi, functionName, args),
    decodeFunctionResult: (functionName: string, data: string) =>
      decodeQrlFunctionResult(artifact.abi, functionName, data),
    decodeEventLog: (eventName: string, log: any) =>
      decodeQrlEventLog(artifact.abi, eventName, log),
    decodeReceiptLogs: (receipt: any) =>
      decodeQrlReceiptLogs(artifact.abi, contractAddress, receipt),
    callFunction,
    functions: functionMaps.functions,
    send: functionMaps.send,
    sendFunction,
    call: (
      data: string,
      tx: Omit<QrlTransactionRequest, "to" | "data"> = {},
      blockTag?: string
    ) => {
      assertHexData(data);
      return call({ ...tx, to: contractAddress, data }, blockTag);
    },
    sendTransaction: (
      data: string,
      tx: Omit<QrlTransactionRequest, "to" | "data"> = {}
    ) => {
      assertHexData(data);
      return sendTransaction({ ...tx, to: contractAddress, data });
    },
  };
}

function createContractFunctionMaps(
  artifact: Artifact,
  callFunction: QrlContract["callFunction"],
  sendFunction: QrlContract["sendFunction"]
): {
  callStatic: QrlContractFunctionMap;
  functions: QrlContractFunctionMap;
  send: QrlContractFunctionMap;
} {
  const callStatic: QrlContractFunctionMap = {};
  const functions: QrlContractFunctionMap = {};
  const send: QrlContractFunctionMap = {};

  for (const fragment of getFunctionFragments(artifact.abi)) {
    if (fragment.name === undefined) {
      continue;
    }

    callStatic[fragment.name] = (...args: any[]) => {
      const parsed = parseCallArgs(fragment, args);
      return callFunction(
        fragment.name!,
        parsed.abiArgs,
        parsed.tx,
        parsed.blockTag
      );
    };
    send[fragment.name] = (...args: any[]) => {
      const parsed = parseSendArgs(fragment, args);
      return sendFunction(fragment.name!, parsed.abiArgs, parsed.tx);
    };
    functions[fragment.name] = (...args: any[]) => {
      if (isReadOnlyFunction(fragment)) {
        const callArgs = parseCallArgs(fragment, args);
        return callFunction(
          fragment.name!,
          callArgs.abiArgs,
          callArgs.tx,
          callArgs.blockTag
        );
      }

      const sendArgs = parseSendArgs(fragment, args);
      return sendFunction(fragment.name!, sendArgs.abiArgs, sendArgs.tx);
    };
  }

  return { callStatic, functions, send };
}

function getFunctionFragments(abi: any): QrlFunctionFragment[] {
  if (!Array.isArray(abi)) {
    return [];
  }

  return abi.filter(
    (entry) => entry.type === "function" && typeof entry.name === "string"
  );
}

function parseCallArgs(
  fragment: QrlFunctionFragment,
  args: any[]
): {
  abiArgs: any[];
  blockTag?: string;
  tx: Omit<QrlTransactionRequest, "to" | "data">;
} {
  const inputCount = getInputCount(fragment);
  assertFunctionArgCount(fragment, args.length, inputCount, inputCount + 2);

  return {
    abiArgs: args.slice(0, inputCount),
    blockTag: args[inputCount + 1],
    tx: args[inputCount] ?? {},
  };
}

function parseSendArgs(
  fragment: QrlFunctionFragment,
  args: any[]
): {
  abiArgs: any[];
  tx: Omit<QrlTransactionRequest, "to" | "data">;
} {
  const inputCount = getInputCount(fragment);
  assertFunctionArgCount(fragment, args.length, inputCount, inputCount + 1);

  return {
    abiArgs: args.slice(0, inputCount),
    tx: args[inputCount] ?? {},
  };
}

function assertFunctionArgCount(
  fragment: QrlFunctionFragment,
  received: number,
  min: number,
  max: number
) {
  if (received < min || received > max) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, {
      message: `Function ${
        fragment.name
      } expects ${min} ABI arguments and up to ${
        max - min
      } call options, got ${received}`,
    });
  }
}

function getInputCount(fragment: QrlFunctionFragment): number {
  return fragment.inputs?.length ?? 0;
}

function isReadOnlyFunction(fragment: QrlFunctionFragment): boolean {
  return (
    fragment.constant === true ||
    fragment.stateMutability === "view" ||
    fragment.stateMutability === "pure"
  );
}

function joinHexData(bytecode: string, extraData: string): string {
  const normalizedBytecode = normalizeHex(bytecode);
  const normalizedExtraData = normalizeHex(extraData);

  return `0x${normalizedBytecode}${normalizedExtraData}`;
}

function normalizeHex(value: string): string {
  assertHexData(value);

  if (value === "0x" || value === "") {
    return "";
  }

  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

function assertHexData(value: string) {
  if (!HEX_DATA_REGEX.test(value)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_HEX_DATA, { value });
  }

  const normalized =
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (normalized.length % 2 !== 0) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_HEX_DATA, { value });
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
