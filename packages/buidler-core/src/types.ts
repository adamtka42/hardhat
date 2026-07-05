import { EventEmitter } from "events";
import { DeepPartial, DeepReadonly, Omit } from "ts-essentials";

import * as types from "./internal/core/params/argumentTypes";

// Begin config types

// IMPORTANT: This t.types MUST be kept in sync with the actual types.

interface CommonNetworkConfig {
  chainId?: number;
  from?: string;
  gas?: "auto" | number;
  gasPrice?: "auto" | number;
  gasMultiplier?: number;
}

export interface OtherAccountsConfig {
  type: string;
}

export interface QrlLedgerAccountsConfig extends OtherAccountsConfig {
  type: "ledger";
  accounts: string[];
  derivationFunction?: (index: number) => string;
  maxDerivationAccounts?: number;
}

export interface QrlLocalAccountConfig {
  address: string;
  balance?: string | number;
  nonce?: number;
}

export interface QrlLocalNetworkConfig extends CommonNetworkConfig {
  type: "qrl-local";
  accounts?: QrlLocalAccountConfig[];
  automine?: boolean;
  blockGasLimit?: number;
  qrlJsMonorepoPath?: string;
}

export type QrlExtendedSeed = string;

export type NetworkConfigAccounts =
  | "remote"
  | QrlExtendedSeed[]
  | QrlLedgerAccountsConfig
  | OtherAccountsConfig;

export interface HttpNetworkConfig extends CommonNetworkConfig {
  url?: string;
  timeout?: number;
  httpHeaders?: { [name: string]: string };
  accounts?: NetworkConfigAccounts;
}

export type NetworkConfig = HttpNetworkConfig | QrlLocalNetworkConfig;

export interface Networks {
  [networkName: string]: NetworkConfig;
}

/**
 * The project paths:
 * * root: the project's root.
 * * configFile: Hardhat config filepath.
 * * cache: project's cache directory.
 * * artifacts: artifact's directory.
 * * sources: project's sources directory.
 * * tests: project's tests directory.
 */
export interface ProjectPaths {
  root: string;
  configFile: string;
  cache: string;
  artifacts: string;
  sources: string;
  tests: string;
}

export interface HyperionConfig {
  version: string;
  compilerPath?: string;
  optimizer: HyperionOptimizerConfig;
}

export interface HyperionOptimizerConfig {
  enabled: boolean;
  runs: number;
}

export interface HardhatConfig {
  defaultNetwork?: string;
  networks?: Networks;
  paths?: Omit<Partial<ProjectPaths>, "configFile">;
  hyperion?: DeepPartial<HyperionConfig>;
  mocha?: Mocha.MochaOptions;
}

export interface ResolvedHardhatConfig extends HardhatConfig {
  defaultNetwork: string;
  paths: ProjectPaths;
  networks: Networks;
  hyperion: HyperionConfig;
}

// End config types

export interface CompilerInput {
  settings: {
    metadata: { useLiteralContent: boolean };
    optimizer: HyperionOptimizerConfig;
    outputSelection: { "*": { "": string[]; "*": string[] } };
  };
  sources: { [p: string]: { content: string } };
  language: string;
}

/**
 * A function that receives a HardhatRuntimeEnvironment and
 * modify its properties or add new ones.
 */
export type EnvironmentExtender = (env: HardhatRuntimeEnvironment) => void;

export type ConfigExtender = (
  config: ResolvedHardhatConfig,
  userConfig: DeepReadonly<HardhatConfig>
) => void;

export interface TasksMap {
  [name: string]: TaskDefinition;
}

export interface ConfigurableTaskDefinition {
  setDescription(description: string): this;

  setAction(action: ActionType<TaskArguments>): this;

  addParam<T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>,
    isOptional?: boolean
  ): this;

  addOptionalParam<T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>
  ): this;

  addPositionalParam<T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>,
    isOptional?: boolean
  ): this;

  addOptionalPositionalParam<T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>
  ): this;

  addVariadicPositionalParam<T>(
    name: string,
    description?: string,
    defaultValue?: T[],
    type?: types.ArgumentType<T>,
    isOptional?: boolean
  ): this;

  addOptionalVariadicPositionalParam<T>(
    name: string,
    description?: string,
    defaultValue?: T[],
    type?: types.ArgumentType<T>
  ): this;

  addFlag(name: string, description?: string): this;
}

export interface ParamDefinition<T> {
  name: string;
  defaultValue?: T;
  type: types.ArgumentType<T>;
  description?: string;
  isOptional: boolean;
  isFlag: boolean;
  isVariadic: boolean;
}

export interface OptionalParamDefinition<T> extends ParamDefinition<T> {
  defaultValue: T;
  isOptional: true;
}

export interface ParamDefinitionsMap {
  [paramName: string]: ParamDefinition<any>;
}

/**
 * Hardhat arguments:
 * * network: the network to be used.
 * * showStackTraces: flag to show stack traces.
 * * version: flag to show Hardhat version.
 * * help: flag to show Hardhat help message.
 * * emoji:
 * * config: used to specify Hardhat config file.
 */
export interface HardhatArguments {
  network?: string;
  showStackTraces: boolean;
  version: boolean;
  help: boolean;
  emoji: boolean;
  config?: string;
  verbose: boolean;
  maxMemory?: number;
}

export type HardhatParamDefinitions = {
  [param in keyof Required<HardhatArguments>]: OptionalParamDefinition<
    HardhatArguments[param]
  >;
};

export interface TaskDefinition extends ConfigurableTaskDefinition {
  readonly name: string;
  readonly description?: string;
  readonly action: ActionType<TaskArguments>;
  readonly isInternal: boolean;

  // TODO: Rename this to something better. It doesn't include the positional
  // params, and that's not clear.
  readonly paramDefinitions: ParamDefinitionsMap;

  readonly positionalParamDefinitions: Array<ParamDefinition<any>>;
}

/**
 * @type TaskArguments {object-like} - the input arguments for a task.
 *
 * TaskArguments type is set to 'any' because it's interface is dynamic.
 * It's impossible in TypeScript to statically specify a variadic
 * number of fields and at the same time define specific types for\
 * the argument values.
 *
 * For example, we could define:
 * type TaskArguments = Record<string, any>;
 *
 * ...but then, we couldn't narrow the actual argument value's type in compile time,
 * thus we have no other option than forcing it to be just 'any'.
 */
export type TaskArguments = any;

export type RunTaskFunction = (
  name: string,
  taskArguments?: TaskArguments
) => Promise<any>;

export interface RunSuperFunction<ArgT extends TaskArguments> {
  (taskArguments?: ArgT): Promise<any>;
  isDefined: boolean;
}

export type ActionType<ArgsT extends TaskArguments> = (
  taskArgs: ArgsT,
  env: HardhatRuntimeEnvironment,
  runSuper: RunSuperFunction<ArgsT>
) => Promise<any>;

export interface QrlProvider extends EventEmitter {
  send(method: string, params?: any[]): Promise<any>;
}

export type IQrlProvider = QrlProvider;

export interface Network {
  name: string;
  config: NetworkConfig;
  provider: QrlProvider;
}

export interface HardhatRuntimeEnvironment {
  readonly config: ResolvedHardhatConfig;
  readonly hardhatArguments: HardhatArguments;
  readonly tasks: TasksMap;
  readonly run: RunTaskFunction;
  readonly network: Network;
  qrl: QrlRuntimeHelpers;
}

export interface Artifact {
  sourceName?: string;
  contractName: string;
  abi: any;
  bytecode: string; // "0x"-prefixed hex string
  deployedBytecode: string; // "0x"-prefixed hex string
  linkReferences: LinkReferences;
  deployedLinkReferences: LinkReferences;
}

export interface LinkReferences {
  [libraryFileName: string]: {
    [libraryName: string]: Array<{ length: number; start: number }>;
  };
}

export interface QrlTransactionRequest {
  from?: string;
  to?: string;
  gas?: string | number;
  gasLimit?: string | number;
  gasPrice?: string | number;
  maxFeePerGas?: string | number;
  maxPriorityFeePerGas?: string | number;
  value?: string | number;
  data?: string;
  nonce?: string | number;
  chainId?: string | number;
}

export interface QrlDeploymentResult {
  hash: string;
  receipt: any;
  address?: string;
}

export interface QrlWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface QrlTransactionReceipt {
  transactionHash: string;
  blockHash?: string;
  blockNumber?: string | number;
  contractAddress?: string | null;
  status?: string | number | boolean;
  logs?: any[];
  [key: string]: any;
}

export interface QrlTransactionResponse {
  hash: string;
  wait(
    timeoutMs?: number,
    pollIntervalMs?: number
  ): Promise<QrlTransactionReceipt>;
}

export interface QrlRuntimeHelpers {
  readArtifact(contractName: string): Promise<Artifact>;
  getContractFactory(contractName: string): Promise<QrlContractFactory>;
  getContractAt(contractName: string, address: string): Promise<QrlContract>;
  sendTransaction(tx: QrlTransactionRequest): Promise<string>;
  call(tx: QrlTransactionRequest, blockTag?: string): Promise<string>;
  waitForTransaction(
    txHash: string,
    timeoutMs?: number,
    pollIntervalMs?: number
  ): Promise<QrlTransactionReceipt>;
  deployContract(
    contractName: string,
    tx?: QrlTransactionRequest,
    constructorDataOrArgs?: string | any[],
    waitOptions?: QrlWaitOptions
  ): Promise<QrlDeploymentResult>;
}

export interface QrlContractFactory {
  readonly contractName: string;
  readonly artifact: Artifact;
  /**
   * Deploys the contract and returns a ready-to-use contract wrapper with
   * deployment metadata attached (`deployTransactionHash`, `deployReceipt`,
   * plus transitional `hash`/`receipt` aliases). Use `qrl.deployContract()`
   * for the raw `QrlDeploymentResult` metadata.
   */
  deploy(
    tx?: QrlTransactionRequest,
    constructorDataOrArgs?: string | any[],
    waitOptions?: QrlWaitOptions
  ): Promise<QrlContract>;
  attach(address: string): QrlContract;
}

export interface QrlBaseContract {
  readonly address: string;
  readonly contractName: string;
  readonly artifact: Artifact;

  /**
   * Deployment metadata, present only on contracts returned by
   * `factory.deploy()`.
   */
  readonly deployTransactionHash?: string;
  readonly deployReceipt?: QrlTransactionReceipt;

  /**
   * @deprecated Transitional alias for `deployTransactionHash`, kept so
   * existing code destructuring `factory.deploy()` results keeps working.
   * Removal target: next major version.
   */
  readonly hash?: string;

  /**
   * @deprecated Transitional alias for `deployReceipt`, kept so existing
   * code destructuring `factory.deploy()` results keeps working. Removal
   * target: next major version.
   */
  readonly receipt?: QrlTransactionReceipt;

  readonly functions: QrlContractFunctionMap;
  readonly callStatic: QrlContractFunctionMap;
  readonly send: QrlContractFunctionMap;

  deployed?(): Promise<QrlContract>;
  waitForDeployment?(): Promise<QrlContract>;
  encodeFunctionData(functionName: string, args?: any[]): string;
  decodeFunctionResult(functionName: string, data: string): any[];
  decodeEventLog(eventName: string, log: any): any;
  decodeReceiptLogs(receipt: any): any[];
  callFunction(
    functionName: string,
    args?: any[],
    tx?: Omit<QrlTransactionRequest, "to" | "data">,
    blockTag?: string
  ): Promise<any[]>;
  sendFunction(
    functionName: string,
    args?: any[],
    tx?: Omit<QrlTransactionRequest, "to" | "data">
  ): Promise<string>;
  call(
    data: string,
    tx?: Omit<QrlTransactionRequest, "to" | "data">,
    blockTag?: string
  ): Promise<string>;
  sendTransaction(
    data: string,
    tx?: Omit<QrlTransactionRequest, "to" | "data">
  ): Promise<string>;
}

/**
 * Contract wrapper with dynamically attached direct method aliases for
 * unambiguous ABI functions. Use `QrlBaseContract` to type a variable when
 * strict field typing is preferred over the dynamic method surface.
 */
export type QrlContract = QrlBaseContract & {
  [functionNameAlias: string]: any;
};

export interface QrlContractFunctionMap {
  [functionName: string]: (...args: any[]) => Promise<any>;
}
