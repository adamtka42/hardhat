import {
  Artifact,
  HardhatRuntimeEnvironment,
  QrlBaseContract,
  QrlContract,
  QrlContractFactory,
  QrlContractFunctionMap,
  QrlDeploymentResult,
  QrlDeployOptions,
  QrlFactoryOptions,
  QrlRuntimeHelpers,
  QrlTransactionReceipt,
  QrlTransactionRequest,
  QrlTransactionResponse,
  QrlWaitOptions,
} from "../../types";
import { readArtifact } from "../artifacts";
import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";
import { normalizeQrlTransactionQuantities } from "../core/providers/provider-utils";

import {
  decodeQrlEventLog,
  decodeQrlFunctionResult,
  decodeQrlReceiptLogs,
  encodeQrlConstructorArgs,
  encodeQrlFunctionData,
  getFunctionSignature,
} from "./abi";
import { normalizeQrlAddress } from "./address";
import { assertDeployableBytecode, linkQrlBytecode } from "./linking";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120000;
const HEX_DATA_REGEX = /^(0x)?[0-9a-fA-F]*$/;

interface QrlFunctionFragment {
  type?: string;
  name?: string;
  inputs?: any[];
  outputs?: any[];
  stateMutability?: string;
  constant?: boolean;
}

/**
 * Wrapper fields that must never be shadowed by a direct ABI method alias.
 * Includes deployment metadata fields attached by the contract factory so
 * that ABI functions with realistic names like `hash()` or `receipt()`
 * cannot overwrite them. Colliding functions stay reachable through the
 * `functions`/`callStatic`/`send` maps and full-signature entries.
 */
const RESERVED_QRL_CONTRACT_PROPERTIES: ReadonlySet<string> = new Set([
  "address",
  "artifact",
  "contractName",
  "deployTransactionHash",
  "deployReceipt",
  "hash",
  "receipt",
  "deployed",
  "waitForDeployment",
  "then",
  "catch",
  "finally",
  "functions",
  "callStatic",
  "send",
  "call",
  "sendTransaction",
  "callFunction",
  "sendFunction",
  "encodeFunctionData",
  "decodeFunctionResult",
  "decodeEventLog",
  "decodeReceiptLogs",
]);

const DIRECT_ALIAS_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "from",
  "gas",
  "gasLimit",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "value",
  "nonce",
  "chainId",
]);

export function createQrlRuntimeHelpers(
  bre: HardhatRuntimeEnvironment
): QrlRuntimeHelpers {
  async function readQrlArtifact(contractName: string): Promise<Artifact> {
    return readArtifact(bre.config.paths.artifacts, contractName);
  }

  async function getContractFactory(
    contractName: string,
    options: QrlFactoryOptions = {}
  ): Promise<QrlContractFactory> {
    const artifact = await readQrlArtifact(contractName);

    // The factory holds already-linked bytecode, so `deploy` needs no
    // library handling of its own.
    const linkedArtifact: Artifact =
      options.libraries !== undefined
        ? {
            ...artifact,
            bytecode: linkQrlBytecode(artifact, options.libraries),
          }
        : artifact;

    return {
      contractName,
      artifact,
      bytecode: linkedArtifact.bytecode,
      deploy: async (
        tx: QrlTransactionRequest = {},
        constructorDataOrArgs: string | any[] = "0x",
        waitOptions: QrlWaitOptions = {}
      ) => {
        assertFactoryDeployArguments(tx, constructorDataOrArgs);
        const resolvedTx = await resolveDefaultSender(tx);
        const deployment = await deployArtifact(
          linkedArtifact,
          resolvedTx,
          constructorDataOrArgs,
          waitOptions
        );
        const contract = getContractFromArtifact(
          artifact,
          deployment.address as string,
          call,
          sendTransaction,
          waitForTransaction,
          resolveDefaultSender
        );

        attachDeploymentMetadata(contract, deployment);

        return contract;
      },
      attach: (address: string) =>
        getContractFromArtifact(
          artifact,
          address,
          call,
          sendTransaction,
          waitForTransaction,
          resolveDefaultSender
        ),
    };
  }

  async function getContractAt(
    contractName: string,
    address: string
  ): Promise<QrlContract> {
    const artifact = await readQrlArtifact(contractName);

    return getContractFromArtifact(
      artifact,
      address,
      call,
      sendTransaction,
      waitForTransaction,
      resolveDefaultSender
    );
  }

  async function sendTransaction(tx: QrlTransactionRequest): Promise<string> {
    const rpcTransaction = { ...tx };
    normalizeQrlTransactionQuantities(rpcTransaction);
    return bre.network.provider.send("qrl_sendTransaction", [rpcTransaction]);
  }

  /**
   * Resolves the sender for transactions sent through the ergonomic contract
   * helpers (direct method aliases and `factory.deploy()`). Resolution order:
   * explicit `tx.from`, the network's `from` config field, and finally the
   * first account returned by `qrl_accounts`. The explicit helpers
   * (`sendTransaction`, `functions.*`, `send.*`, `deployContract`) keep their
   * original validation and are not affected.
   */
  async function resolveDefaultSender<
    T extends Omit<QrlTransactionRequest, "to" | "data">
  >(tx: T): Promise<T> {
    if (tx.from !== undefined) {
      return tx;
    }

    const configFrom = (bre.network as any)?.config?.from;
    if (typeof configFrom === "string" && configFrom !== "") {
      return { ...tx, from: configFrom };
    }

    let accounts: any;
    try {
      accounts = await bre.network.provider.send("qrl_accounts");
    } catch {
      accounts = undefined;
    }

    if (Array.isArray(accounts) && accounts.length > 0) {
      return { ...tx, from: accounts[0] };
    }

    throw new HardhatError(ERRORS.NETWORK.MISSING_QRL_SENDER, {
      network: (bre.network as any)?.name ?? "unknown",
    });
  }

  async function call(
    tx: QrlTransactionRequest,
    blockTag: string = "latest"
  ): Promise<string> {
    const rpcTransaction = { ...tx };
    normalizeQrlTransactionQuantities(rpcTransaction);
    return bre.network.provider.send("qrl_call", [rpcTransaction, blockTag]);
  }

  async function waitForTransaction(
    txHash: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
  ): Promise<QrlTransactionReceipt> {
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
    deployOptions: QrlDeployOptions = {}
  ): Promise<QrlDeploymentResult> {
    const artifact = await readQrlArtifact(contractName);
    const linkedArtifact: Artifact =
      deployOptions.libraries !== undefined
        ? {
            ...artifact,
            bytecode: linkQrlBytecode(artifact, deployOptions.libraries),
          }
        : artifact;

    return deployArtifact(
      linkedArtifact,
      tx,
      constructorDataOrArgs,
      deployOptions
    );
  }

  async function deployArtifact(
    artifact: Artifact,
    tx: QrlTransactionRequest = {},
    constructorDataOrArgs: string | any[] = "0x",
    waitOptions: QrlWaitOptions = {}
  ): Promise<QrlDeploymentResult> {
    assertDeployableBytecode(artifact, artifact.bytecode);

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

/**
 * Wraps a transaction hash in a response object with a `wait()` helper that
 * polls for the mined receipt. Building block for the ergonomic contract API;
 * not part of the documented `hre.qrl` surface.
 */
export function createTransactionResponse(
  hash: string,
  waitForTransaction: (
    txHash: string,
    timeoutMs?: number,
    pollIntervalMs?: number
  ) => Promise<QrlTransactionReceipt>
): QrlTransactionResponse {
  return {
    hash,
    wait: (timeoutMs?: number, pollIntervalMs?: number) =>
      waitForTransaction(hash, timeoutMs, pollIntervalMs),
  };
}

/**
 * Sends a transaction and returns a `QrlTransactionResponse` instead of a raw
 * hash string. Internal sender variant used by direct contract method
 * aliases; the public `sendTransaction` helper is unchanged.
 */
export async function sendTransactionWithResponse(
  sendTransaction: (tx: QrlTransactionRequest) => Promise<string>,
  waitForTransaction: (
    txHash: string,
    timeoutMs?: number,
    pollIntervalMs?: number
  ) => Promise<QrlTransactionReceipt>,
  tx: QrlTransactionRequest
): Promise<QrlTransactionResponse> {
  const hash = await sendTransaction(tx);
  return createTransactionResponse(hash, waitForTransaction);
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

type QrlSenderResolver = <T extends Omit<QrlTransactionRequest, "to" | "data">>(
  tx: T
) => Promise<T>;

function getContractFromArtifact(
  artifact: Artifact,
  address: string,
  call: QrlRuntimeHelpers["call"],
  sendTransaction: QrlRuntimeHelpers["sendTransaction"],
  waitForTransaction: QrlRuntimeHelpers["waitForTransaction"],
  resolveSender: QrlSenderResolver
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

  const contract: QrlContract = {
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

  addDirectFunctionAliases(
    contract,
    artifact,
    callFunction,
    sendFunction,
    waitForTransaction,
    resolveSender
  );

  return contract;
}

/**
 * Guards the QRL factory deploy argument order. The QRL signature is
 * `deploy(txOverrides?, constructorArgsOrData?, waitOptions?)` — a deliberate
 * decision to avoid the ambiguity of ethers-style
 * `deploy(...args, overrides)` with object/tuple constructor arguments.
 * Without this guard, an ethers-style call like `deploy("Hello", { from })`
 * would silently spread the string into a garbage transaction object.
 */
function assertFactoryDeployArguments(
  tx: unknown,
  constructorDataOrArgs: unknown
): void {
  if (tx === null || typeof tx !== "object" || Array.isArray(tx)) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, {
      message: `Factory deploy() expects transaction overrides as its first argument and constructor arguments as its second, e.g. deploy({ from }, [constructorArg1, constructorArg2])`,
    });
  }

  if (
    typeof constructorDataOrArgs !== "string" &&
    !Array.isArray(constructorDataOrArgs)
  ) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, {
      message: `Factory deploy() expects constructor arguments as an array (or raw hex data string) in its second argument, e.g. deploy({ from }, [constructorArg1])`,
    });
  }
}

/**
 * Attaches deployment metadata to a contract wrapper returned by
 * `factory.deploy()`. The `hash` and `receipt` fields are transitional
 * aliases for `deployTransactionHash`/`deployReceipt` so existing code
 * destructuring the old `QrlDeploymentResult` shape keeps working; they are
 * deprecated and scheduled for removal in the next major version.
 *
 * `deployed()` and `waitForDeployment()` resolve immediately because
 * `deployContract()` already waits for the mined receipt and validates the
 * deployment status and contract address.
 */
function attachDeploymentMetadata(
  contract: QrlContract,
  deployment: QrlDeploymentResult
): void {
  const writable = contract as any;

  writable.deployTransactionHash = deployment.hash;
  writable.deployReceipt = deployment.receipt;
  writable.hash = deployment.hash;
  writable.receipt = deployment.receipt;
  writable.deployed = async () => contract;
  writable.waitForDeployment = async () => contract;
}

/**
 * Attaches ergonomic direct method aliases (`contract.foo(...)`) for
 * unambiguous ABI functions:
 * - `view`/`pure` functions perform a call; a single output is unwrapped to
 *   a scalar, zero or multiple outputs return the decoded result array;
 * - state-changing functions send a transaction and return a
 *   `QrlTransactionResponse` with a receipt-polling `wait()`.
 *
 * Overloaded names and names colliding with reserved wrapper fields are
 * skipped; those functions stay reachable through the `functions`,
 * `callStatic`, and `send` maps.
 */
function addDirectFunctionAliases(
  contract: QrlContract,
  artifact: Artifact,
  callFunction: QrlBaseContract["callFunction"],
  sendFunction: QrlBaseContract["sendFunction"],
  waitForTransaction: QrlRuntimeHelpers["waitForTransaction"],
  resolveSender: QrlSenderResolver
): void {
  const fragments = getFunctionFragments(artifact.abi);
  const functionNameCounts = countFunctionNames(fragments);

  for (const fragment of fragments) {
    const name = fragment.name;

    if (name === undefined) {
      continue;
    }

    if (functionNameCounts[name] !== 1) {
      continue;
    }

    if (RESERVED_QRL_CONTRACT_PROPERTIES.has(name) || name in contract) {
      continue;
    }

    const signature = getFunctionSignature(fragment);

    if (isReadOnlyFunction(fragment)) {
      contract[name] = async (...args: any[]) => {
        const parsed = parseDirectAliasArgs(fragment, args);
        const decoded = await callFunction(
          signature,
          parsed.abiArgs,
          parsed.tx
        );

        return (fragment.outputs?.length ?? 0) === 1 ? decoded[0] : decoded;
      };
    } else {
      contract[name] = async (...args: any[]) => {
        const parsed = parseDirectAliasArgs(fragment, args);
        const resolvedTx = await resolveSender(parsed.tx);
        const hash = await sendFunction(signature, parsed.abiArgs, resolvedTx);

        return createTransactionResponse(hash, waitForTransaction);
      };
    }
  }
}

function parseDirectAliasArgs(
  fragment: QrlFunctionFragment,
  args: any[]
): {
  abiArgs: any[];
  tx: Omit<QrlTransactionRequest, "to" | "data">;
} {
  const inputCount = getInputCount(fragment);

  if (args.length === inputCount) {
    return { abiArgs: args, tx: {} };
  }

  if (args.length === inputCount + 1) {
    const overrides = args[inputCount];
    assertDirectAliasOverrides(fragment, overrides);

    return { abiArgs: args.slice(0, inputCount), tx: overrides };
  }

  throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, {
    message: `Function ${fragment.name} expects ${inputCount} ABI arguments and an optional transaction overrides object, got ${args.length} arguments`,
  });
}

function assertDirectAliasOverrides(
  fragment: QrlFunctionFragment,
  overrides: any
) {
  if (
    overrides === null ||
    typeof overrides !== "object" ||
    Array.isArray(overrides)
  ) {
    throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, {
      message: `Function ${fragment.name} expects a plain transaction overrides object as its final argument`,
    });
  }

  for (const key of Object.keys(overrides)) {
    if (!DIRECT_ALIAS_OVERRIDE_KEYS.has(key)) {
      throw new HardhatError(ERRORS.NETWORK.INVALID_QRL_ABI, {
        message: `Unknown transaction override "${key}" for function ${
          fragment.name
        }; allowed overrides are: ${[...DIRECT_ALIAS_OVERRIDE_KEYS].join(
          ", "
        )}`,
      });
    }
  }
}

function createContractFunctionMaps(
  artifact: Artifact,
  callFunction: QrlBaseContract["callFunction"],
  sendFunction: QrlBaseContract["sendFunction"]
): {
  callStatic: QrlContractFunctionMap;
  functions: QrlContractFunctionMap;
  send: QrlContractFunctionMap;
} {
  const callStatic: QrlContractFunctionMap = {};
  const functions: QrlContractFunctionMap = {};
  const send: QrlContractFunctionMap = {};

  const fragments = getFunctionFragments(artifact.abi);
  const functionNameCounts = countFunctionNames(fragments);

  for (const fragment of fragments) {
    if (fragment.name === undefined) {
      continue;
    }

    const signature = getFunctionSignature(fragment);
    const names = [signature];

    if (functionNameCounts[fragment.name] === 1) {
      names.push(fragment.name);
    }

    for (const name of names) {
      callStatic[name] = (...args: any[]) => {
        const parsed = parseCallArgs(fragment, args);
        return callFunction(
          signature,
          parsed.abiArgs,
          parsed.tx,
          parsed.blockTag
        );
      };
      send[name] = (...args: any[]) => {
        const parsed = parseSendArgs(fragment, args);
        return sendFunction(signature, parsed.abiArgs, parsed.tx);
      };
      functions[name] = (...args: any[]) => {
        if (isReadOnlyFunction(fragment)) {
          const callArgs = parseCallArgs(fragment, args);
          return callFunction(
            signature,
            callArgs.abiArgs,
            callArgs.tx,
            callArgs.blockTag
          );
        }

        const sendArgs = parseSendArgs(fragment, args);
        return sendFunction(signature, sendArgs.abiArgs, sendArgs.tx);
      };
    }
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

function countFunctionNames(
  fragments: QrlFunctionFragment[]
): { [name: string]: number } {
  const counts: { [name: string]: number } = {};

  for (const fragment of fragments) {
    if (fragment.name !== undefined) {
      counts[fragment.name] = (counts[fragment.name] ?? 0) + 1;
    }
  }

  return counts;
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
