import { readArtifact } from "../artifacts";

import {
  Artifact,
  BuidlerRuntimeEnvironment,
  QrlDeploymentResult,
  QrlRuntimeHelpers,
  QrlTransactionRequest,
} from "../../types";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120000;

export function createQrlRuntimeHelpers(
  bre: BuidlerRuntimeEnvironment
): QrlRuntimeHelpers {
  async function readQrlArtifact(contractName: string): Promise<Artifact> {
    return readArtifact(bre.config.paths.artifacts, contractName);
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
        return receipt;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for transaction ${txHash}`);
  }

  async function deployContract(
    contractName: string,
    tx: QrlTransactionRequest = {},
    constructorData: string = "0x"
  ): Promise<QrlDeploymentResult> {
    const artifact = await readQrlArtifact(contractName);
    const data = joinHexData(artifact.bytecode, constructorData);
    const hash = await sendTransaction({
      ...tx,
      data,
    });
    const receipt = await waitForTransaction(hash);

    return {
      hash,
      receipt,
      address: receipt.contractAddress,
    };
  }

  return {
    call,
    deployContract,
    readArtifact: readQrlArtifact,
    sendTransaction,
    waitForTransaction,
  };
}

function joinHexData(bytecode: string, extraData: string): string {
  const normalizedBytecode = normalizeHex(bytecode);
  const normalizedExtraData = normalizeHex(extraData);

  return `0x${normalizedBytecode}${normalizedExtraData}`;
}

function normalizeHex(value: string): string {
  if (value === "0x" || value === "") {
    return "";
  }

  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
