import { assert } from "chai";
import fsExtra from "fs-extra";
import os from "os";
import path from "path";

import { HardhatQrlvmProvider } from "../../../../src/internal/core/providers/hardhat-qrlvm";
import { compileHyperion } from "../../../../src/internal/hyperion/compiler";
import { buildHyperionStandardJsonInput } from "../../../../src/internal/hyperion/compiler-input";
import {
  encodeQrlConstructorArgs,
  encodeQrlFunctionData,
  getFunctionSignature,
} from "../../../../src/internal/qrl/abi";
import { linkQrlBytecode } from "../../../../src/internal/qrl/linking";
import {
  inferQrlStackTrace,
  loadQrlDebugInfo,
  QrlStackTraceDecoder,
  QrlStackTraceDiagnostic,
  QrlStackTraceEntryType,
} from "../../../../src/internal/qrl/stack-traces";
import { Artifact } from "../../../../src/types";

interface FixtureManifestEntry {
  id: string;
  classification: string;
}

interface StackFrameDescription {
  type: string;
  sourceReference?: {
    contract: string;
    file: string;
    function?: string;
    line: number;
  };
  message?: string;
  value?: string | number;
}

interface TestDefinition {
  description?: string;
  transactions: FixtureTransaction[];
}

interface DeploymentTransaction {
  file: string;
  contract: string;
  value?: string | number;
  params?: any[];
  libraries?: {
    [sourceName: string]: { [libraryName: string]: number };
  };
  stackTrace?: StackFrameDescription[];
  consoleLogs?: any[][];
}

interface CallTransaction {
  to: number;
  value?: string | number;
  data?: string;
  function?: string;
  params?: any[];
  stackTrace?: StackFrameDescription[];
  consoleLogs?: any[][];
}

type FixtureTransaction = DeploymentTransaction | CallTransaction;

interface DeployedContract {
  file: string;
  contract: string;
  address: string;
}

const PACKAGE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const HARDHAT_ROOT = path.join(PACKAGE_ROOT, "..", "..");
const ZOND_ROOT = path.dirname(HARDHAT_ROOT);
const FIXTURE_ROOT = path.join(__dirname, "test-files");
const SENDER = `Q${"01".repeat(64)}`;
const LOCAL_HYPC_PATH = path.join(
  ZOND_ROOT,
  "hyperion",
  "build",
  "hypc",
  "hypc"
);
const LOCAL_QRLJS_MONOREPO_PATH = path.join(
  path.dirname(ZOND_ROOT),
  "qrljs-monorepo"
);

const manifest: { fixtures: FixtureManifestEntry[] } = fsExtra.readJsonSync(
  path.join(__dirname, "fixtures-manifest.json")
);

describe("QRL stack trace fixture matrix", function () {
  const hypcPath = resolveHypcPath();
  const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();

  for (const fixture of manifest.fixtures.filter(isExecutableFixture)) {
    const definition: TestDefinition = fsExtra.readJsonSync(
      path.join(FIXTURE_ROOT, fixture.id, "test.json")
    );
    const description = definition.description ?? "matches the expected trace";

    describe(fixture.id, function () {
      for (const optimizer of [false, true]) {
        const mode = optimizer ? "with optimizations" : "without optimizations";
        it(`${description} (${mode})`, async function () {
          this.timeout(120000);
          if (hypcPath === undefined || qrlJsMonorepoPath === undefined) {
            this.skip();
            return;
          }
          await runFixture(
            fixture,
            definition,
            optimizer,
            hypcPath,
            qrlJsMonorepoPath
          );
        });
      }
    });
  }
});

function isExecutableFixture(fixture: FixtureManifestEntry): boolean {
  return (
    fixture.classification === "qrl-applicable" ||
    fixture.classification === "qrl-specific-replacement"
  );
}

async function runFixture(
  fixture: FixtureManifestEntry,
  definition: TestDefinition,
  optimizer: boolean,
  hypcPath: string,
  qrlJsMonorepoPath: string
): Promise<void> {
  const fixtureDirectory = path.join(FIXTURE_ROOT, fixture.id);
  const input = buildFixtureInput(fixtureDirectory, optimizer);
  const output = await compileHyperion(input, PACKAGE_ROOT, hypcPath);
  assertCompilerSucceeded(fixture.id, output);

  const cacheDirectory = fsExtra.mkdtempSync(
    path.join(os.tmpdir(), "hardhat-qrl-stack-fixture-")
  );
  try {
    fsExtra.writeJsonSync(
      path.join(cacheDirectory, "compiler-input.json"),
      input
    );
    fsExtra.writeJsonSync(
      path.join(cacheDirectory, "compiler-output.json"),
      output
    );
    const debugInfo = loadQrlDebugInfo(cacheDirectory);
    assert.isDefined(debugInfo, `${fixture.id}: debug info was not loaded`);
    debugInfo!.contracts = debugInfo!.contracts.filter(
      (contract) => !contract.contractName.startsWith("Ignored")
    );
    const decoder = new QrlStackTraceDecoder(debugInfo!);
    const provider = new HardhatQrlvmProvider({
      chainId: 1337,
      blockGasLimit: 50000000,
      qrlJsMonorepoPath,
      throwOnTransactionFailures: false,
      throwOnCallFailures: false,
      allowUnlimitedContractSize: true,
      accounts: [{ address: SENDER, balance: "1000000000000000000000000" }],
    });
    const rawProvider = (provider as any)._provider;
    const deployed = new Map<number, DeployedContract>();

    for (let index = 0; index < definition.transactions.length; index++) {
      const transaction = definition.transactions[index];
      const request = isDeployment(transaction)
        ? deploymentRequest(transaction, output, deployed)
        : callRequest(transaction, output, deployed, index);
      const captured = await captureStdout(async () =>
        provider.send("qrl_sendTransaction", [request])
      );
      const transactionHash = captured.result;
      const receipt = await provider.send("qrl_getTransactionReceipt", [
        transactionHash,
      ]);
      const shouldFail = transaction.stackTrace !== undefined;
      assert.equal(
        receipt.status,
        shouldFail ? "0x0" : "0x1",
        `${fixture.id}: transaction ${index} status`
      );

      compareConsoleLogs(
        fixture.id,
        index,
        captured.output,
        transaction.consoleLogs
      );

      if (isDeployment(transaction) && receipt.contractAddress !== null) {
        deployed.set(index, {
          file: transaction.file,
          contract: transaction.contract,
          address: receipt.contractAddress,
        });
      }

      if (shouldFail) {
        const frame = await rawProvider.traceTransactionFrames(transactionHash);
        const trace = inferQrlStackTrace(frame, decoder);
        compareStackTrace(
          fixture.id,
          index,
          trace,
          transaction.stackTrace!,
          optimizer
        );
      }
    }
  } finally {
    fsExtra.removeSync(cacheDirectory);
  }
}

function buildFixtureInput(directory: string, optimizer: boolean): any {
  const sources: { [sourceName: string]: { content: string } } = {};
  for (const sourceName of fsExtra
    .readdirSync(directory)
    .filter((name) => name.endsWith(".hyp"))
    .sort()) {
    sources[sourceName] = {
      content: fsExtra.readFileSync(path.join(directory, sourceName), "utf8"),
    };
  }

  if (
    Object.values(sources).some(({ content }) =>
      content.includes("@theqrl/hardhat/console.hyp")
    )
  ) {
    sources["@theqrl/hardhat/console.hyp"] = {
      content: fsExtra.readFileSync(
        path.join(PACKAGE_ROOT, "console.hyp"),
        "utf8"
      ),
    };
  }

  return buildHyperionStandardJsonInput(sources, {
    enabled: optimizer,
    runs: 200,
  });
}

function assertCompilerSucceeded(fixtureId: string, output: any): void {
  const errors = (output.errors ?? []).filter(
    (diagnostic: any) => diagnostic.severity === "error"
  );
  assert.deepEqual(
    errors,
    [],
    `${fixtureId}: ${errors
      .map((diagnostic: any) => diagnostic.formattedMessage)
      .join("\n")}`
  );
}

function deploymentRequest(
  transaction: DeploymentTransaction,
  output: any,
  deployed: Map<number, DeployedContract>
): any {
  const contractOutput = getCompilerContract(
    output,
    transaction.file,
    transaction.contract
  );
  const artifact = toArtifact(
    transaction.file,
    transaction.contract,
    contractOutput
  );
  const libraries: { [name: string]: string } = {};
  for (const [sourceName, sourceLibraries] of Object.entries(
    transaction.libraries ?? {}
  )) {
    for (const [libraryName, deploymentIndex] of Object.entries(
      sourceLibraries
    )) {
      const library = deployed.get(deploymentIndex);
      assert.isDefined(
        library,
        `Library ${sourceName}:${libraryName} was not deployed in transaction ${deploymentIndex}`
      );
      libraries[`${sourceName}:${libraryName}`] = library!.address;
    }
  }
  const bytecode = linkQrlBytecode(artifact, libraries);
  const params = transaction.params ?? [];
  const constructorData =
    params.length === 0
      ? "0x"
      : encodeQrlConstructorArgs(
          artifact.abi,
          normalizeArguments(constructorInputs(artifact.abi), params)
        );
  return {
    from: SENDER,
    data: `${bytecode}${constructorData.slice(2)}`,
    gas: "0x2faf080",
    value: toQuantity(transaction.value ?? 0),
  };
}

function callRequest(
  transaction: CallTransaction,
  output: any,
  deployed: Map<number, DeployedContract>,
  transactionIndex: number
): any {
  const target = deployed.get(transaction.to);
  assert.isDefined(
    target,
    `Transaction ${transactionIndex} calls missing deployment ${transaction.to}`
  );
  const contractOutput = getCompilerContract(
    output,
    target!.file,
    target!.contract
  );
  let data = transaction.data ?? "0x";
  if (transaction.function !== undefined) {
    const params = transaction.params ?? [];
    const fragment = contractOutput.abi.find(
      (candidate: any) =>
        candidate.type === "function" &&
        candidate.name === transaction.function &&
        (candidate.inputs ?? []).length === params.length
    );
    assert.isDefined(
      fragment,
      `Function ${transaction.function}/${params.length} is missing from ${
        target!.contract
      }`
    );
    data = encodeQrlFunctionData(
      contractOutput.abi,
      getFunctionSignature(fragment),
      normalizeArguments(fragment.inputs ?? [], params)
    );
  }
  return {
    from: SENDER,
    to: target!.address,
    data,
    gas: "0x2faf080",
    value: toQuantity(transaction.value ?? 0),
  };
}

function getCompilerContract(
  output: any,
  sourceName: string,
  contractName: string
): any {
  const contract = output.contracts?.[sourceName]?.[contractName];
  assert.isDefined(
    contract,
    `Contract ${sourceName}:${contractName} is missing`
  );
  return contract;
}

function toArtifact(
  sourceName: string,
  contractName: string,
  contractOutput: any
): Artifact {
  return {
    sourceName,
    contractName,
    abi: contractOutput.abi ?? [],
    bytecode: `0x${contractOutput.bytecodeOutput.bytecode.object}`,
    deployedBytecode: `0x${contractOutput.bytecodeOutput.deployedBytecode.object}`,
    linkReferences: contractOutput.bytecodeOutput.bytecode.linkReferences ?? {},
    deployedLinkReferences:
      contractOutput.bytecodeOutput.deployedBytecode.linkReferences ?? {},
  };
}

function constructorInputs(abi: any[]): any[] {
  return abi.find((fragment) => fragment.type === "constructor")?.inputs ?? [];
}

function normalizeArguments(inputs: any[], values: any[]): any[] {
  return values.map((value, index) => normalizeArgument(inputs[index], value));
}

function normalizeArgument(input: any, value: any): any {
  if (input === undefined) {
    return value;
  }
  if (input.type === "address") {
    return normalizeFixtureAddress(value);
  }
  const arrayMatch = /^(.*)\[[0-9]*\]$/.exec(input.type);
  if (arrayMatch !== null && Array.isArray(value)) {
    return value.map((entry) =>
      normalizeArgument({ ...input, type: arrayMatch[1] }, entry)
    );
  }
  if (input.type === "tuple" && Array.isArray(value)) {
    return normalizeArguments(input.components ?? [], value);
  }
  return value;
}

function normalizeFixtureAddress(value: any): string {
  if (typeof value !== "string") {
    return value;
  }
  if (/^Q[0-9a-fA-F]{128}$/.test(value)) {
    return value;
  }
  if (/^0x[0-9a-fA-F]{1,128}$/.test(value)) {
    return `Q${value.slice(2).padStart(128, "0")}`;
  }
  return value;
}

function toQuantity(value: string | number): string {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    return value;
  }
  return `0x${(global as any).BigInt(value).toString(16)}`;
}

function isDeployment(
  transaction: FixtureTransaction
): transaction is DeploymentTransaction {
  return "file" in transaction;
}

async function captureStdout<T>(
  action: () => Promise<T>
): Promise<{ result: T; output: string[] }> {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  (process.stdout as any).write = (chunk: any) => {
    output.push(String(chunk));
    return true;
  };
  try {
    return { result: await action(), output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function compareConsoleLogs(
  fixtureId: string,
  transactionIndex: number,
  output: string[],
  expected?: any[][]
): void {
  if (expected === undefined) {
    return;
  }
  const actualLines = output
    .join("")
    .split("\n")
    .filter((line) => line !== "");
  const expectedLines = expected.map((values) =>
    values.map(normalizeConsoleValue).join(" ")
  );
  assert.deepEqual(
    actualLines,
    expectedLines,
    `${fixtureId}: transaction ${transactionIndex} console logs`
  );
}

function normalizeConsoleValue(value: any): string {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    return normalizeFixtureAddress(value);
  }
  return String(value);
}

function compareStackTrace(
  fixtureId: string,
  transactionIndex: number,
  actual: QrlStackTraceDiagnostic[],
  baseline: StackFrameDescription[],
  optimized: boolean
): void {
  // The baseline model stores caller-to-origin entries. User-facing QRL traces
  // follow conventional stack ordering and render the failure origin first.
  const expected = [...baseline].reverse();
  assert.lengthOf(
    actual,
    expected.length,
    `${fixtureId}: transaction ${transactionIndex} trace length\nactual: ${JSON.stringify(
      actual.map((entry) => ({
        type: QrlStackTraceEntryType[entry.type],
        source: entry.sourceReference,
      }))
    )}\nexpected: ${JSON.stringify(expected)}`
  );
  for (let index = 0; index < expected.length; index++) {
    const actualEntry = actual[index];
    const expectedEntry = expected[index];
    assert.equal(
      QrlStackTraceEntryType[actualEntry.type],
      expectedEntry.type,
      `${fixtureId}: transaction ${transactionIndex} entry ${index} type`
    );
    if (expectedEntry.value !== undefined) {
      assert.equal(
        String(actualEntry.value),
        String(expectedEntry.value),
        `${fixtureId}: transaction ${transactionIndex} entry ${index} value`
      );
    }
    if (expectedEntry.message !== undefined) {
      assert.equal(
        decodeRevertMessage(actualEntry.message),
        expectedEntry.message,
        `${fixtureId}: transaction ${transactionIndex} entry ${index} message`
      );
    }
    if (expectedEntry.sourceReference === undefined) {
      assert.isUndefined(
        actualEntry.sourceReference,
        `${fixtureId}: transaction ${transactionIndex} entry ${index} source`
      );
      continue;
    }
    assert.isDefined(
      actualEntry.sourceReference,
      `${fixtureId}: transaction ${transactionIndex} entry ${index} source`
    );
    const source = actualEntry.sourceReference!;
    assert.equal(source.contractName, expectedEntry.sourceReference.contract);
    assert.equal(source.sourceName, expectedEntry.sourceReference.file);
    assert.equal(
      source.functionName,
      normalizeExpectedFunction(expectedEntry.sourceReference.function)
    );
    if (!optimized) {
      assert.equal(source.line, expectedEntry.sourceReference.line);
    }
  }
}

function normalizeExpectedFunction(value: string | undefined): string {
  if (value === undefined) {
    return "<unknown>";
  }
  if (value === "fallback" || value === "receive") {
    return `<${value}>`;
  }
  return value;
}

function decodeRevertMessage(data: Uint8Array | undefined): string {
  if (data === undefined || data.length < 4) {
    return "";
  }
  const selector = Buffer.from(data.slice(0, 4)).toString("hex");
  if (selector !== "08c379a0") {
    return "";
  }
  try {
    const body = Buffer.from(data.slice(4));
    const offset = Number(readWord(body, 0));
    const length = Number(readWord(body, offset));
    return body.slice(offset + 64, offset + 64 + length).toString("utf8");
  } catch {
    return "";
  }
}

function readWord(data: Buffer, offset: number): any {
  const word = data.slice(offset, offset + 64).toString("hex");
  return (global as any).BigInt(word === "" ? "0x0" : `0x${word}`);
}

function resolveHypcPath(): string | undefined {
  const configured =
    process.env.HYPERION_HYPC_PATH ?? process.env.HYPC_PATH ?? LOCAL_HYPC_PATH;
  return fsExtra.pathExistsSync(configured) ? configured : undefined;
}

function resolveQrlJsMonorepoPath(): string | undefined {
  const configured =
    process.env.QRLJS_MONOREPO_PATH ?? LOCAL_QRLJS_MONOREPO_PATH;
  return fsExtra.pathExistsSync(
    path.join(configured, "packages", "vm", "dist", "cjs", "index.js")
  )
    ? configured
    : undefined;
}
