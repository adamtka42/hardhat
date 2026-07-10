export const ERROR_PREFIX = "BDLR";

export interface ErrorDescriptor {
  number: number;
  // Message can use templates. See applyErrorMessageTemplate
  message: string;
  // Title and description can be Markdown
  title: string;
  description: string;
}

export function getErrorCode(error: ErrorDescriptor): string {
  return `${ERROR_PREFIX}${error.number}`;
}

export const ERROR_RANGES = {
  GENERAL: { min: 0, max: 99, title: "General errors" },
  NETWORK: { min: 100, max: 199, title: "Network related errors" },
  TASK_DEFINITIONS: {
    min: 200,
    max: 299,
    title: "Task definition errors",
  },
  ARGUMENTS: { min: 300, max: 399, title: "Arguments related errors" },
  RESOLVER: {
    min: 400,
    max: 499,
    title: "Dependencies resolution errors",
  },
  BUILTIN_TASKS: { min: 600, max: 699, title: "Built-in tasks errors" },
  ARTIFACTS: { min: 700, max: 799, title: "Artifacts related errors" },
  PLUGINS: { min: 800, max: 899, title: "Plugin system errors" },
  INTERNAL: { min: 900, max: 999, title: "Internal Hardhat errors" },
};

export const ERRORS: {
  [category in keyof typeof ERROR_RANGES]: {
    [errorName: string]: ErrorDescriptor;
  };
} = {
  GENERAL: {
    NOT_INSIDE_PROJECT: {
      number: 1,
      message: "You are not inside a Hardhat project.",
      title: "You are not inside a Hardhat project",
      description: `You are trying to run Hardhat outside of a Hardhat project.

You can learn how to use Hardhat by reading the [Getting Started guide](./README.md).`,
    },
    INVALID_NODE_VERSION: {
      number: 2,
      message:
        "Hardhat doesn't support your Node.js version. It should be %requirement%.",
      title: "Unsupported Node.js",
      description: `Hardhat doesn't support your Node.js version.

Please upgrade your version of Node.js and try again.`,
    },
    UNSUPPORTED_OPERATION: {
      number: 3,
      message: "%operation% is not supported in Hardhat.",
      title: "Unsupported operation",
      description: `You are tying to perform an unsupported operation.

Unless you are creating a task or plugin, this is probably a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    CONTEXT_ALREADY_CREATED: {
      number: 4,
      message: "HardhatContext is already created.",
      title: "Hardhat was already initialized",
      description: `Hardhat initialization was executed twice. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    CONTEXT_NOT_CREATED: {
      number: 5,
      message: "HardhatContext is not created.",
      title: "Hardhat wasn't initialized",
      description: `Hardhat initialization failed. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    CONTEXT_BRE_NOT_DEFINED: {
      number: 6,
      message:
        "Hardhat Runtime Environment is not defined in the HardhatContext.",
      title: "Hardhat Runtime Environment not created",
      description: `Hardhat initialization failed. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    CONTEXT_BRE_ALREADY_DEFINED: {
      number: 7,
      message:
        "Hardhat Runtime Environment is already defined in the HardhatContext",
      title: "Tried to create the Hardhat Runtime Environment twice",
      description: `The Hardhat initialization process was executed twice. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    INVALID_CONFIG: {
      number: 8,
      message: `There's one or more errors in your config file:

%errors%

To learn more about Hardhat's configuration, please go to the QRL Hardhat configuration documentation`,
      title: "Invalid Hardhat config",
      description: `You have one or more errors in your config file.

Check the error message for details, or go to the configuration documentation to learn more.`,
    },
    LIB_IMPORTED_FROM_THE_CONFIG: {
      number: 9,
      message: `Error while loading Hardhat's configuration.
You probably imported @theqrl/hardhat instead of @theqrl/hardhat/config`,
      title: "Failed to load config file",
      description: `There was an error while loading your config file.

The most common source of errors is trying to import \`@theqrl/hardhat\` instead of \`@theqrl/hardhat/config\`.

Please make sure your config file is correct.`,
    },
    USER_CONFIG_MODIFIED: {
      number: 10,
      message: `Error while loading Hardhat's configuration.
You or one of your plugins is trying to modify the userConfig.%path% value from a config extender`,
      title: "Attempted to modify the user's config",
      description: `An attempt to modify the user's config was made.

This is probably a bug in one of your plugins.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
  },
  NETWORK: {
    CONFIG_NOT_FOUND: {
      number: 100,
      message: "Network %network% doesn't exist",
      title: "Selected network doesn't exist",
      description: `You are trying to run Hardhat with a non-existent network.

Read the network configuration documentation to learn how to define custom networks.`,
    },
    INVALID_GLOBAL_CHAIN_ID: {
      number: 101,
      message:
        "Hardhat was set to use chain id %configChainId%, but connected to a chain with id %connectionChainId%.",
      title: "Connected to the wrong network",
      description: `Your config specifies a chain id for the network you are trying to use, but Hardhat detected another one.

Please make sure you are setting your config correctly.`,
    },
    /* DEPRECATED: This error only happened because of a misconception in Hardhat */
    DEPRECATED_INVALID_TX_CHAIN_ID: {
      number: 102,
      message:
        "Trying to send a tx with chain id %txChainId%, but Hardhat is connected to a chain with id %chainId%.",
      title: "Incorrectly send chainId in a transaction",
      description: `Hardhat sent the \`chainId\` field in a transaction.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    QRLSIGN_MISSING_DATA_PARAM: {
      number: 103,
      message: 'Missing "data" param when calling qrl_sign.',
      title: "Missing `data` param when calling qrl_sign.",
      description: `You called \`qrl_sign\` with incorrect parameters.

Please check that you are sending a \`data\` parameter.`,
    },
    NOT_LOCAL_ACCOUNT: {
      number: 104,
      message:
        "Account %account% is not managed by the node you are connected to.",
      title: "Unrecognized account",
      description: `You are trying to send a transaction or sign some data with an
account not managed by your QRL node nor Hardhat.

Please double check your accounts and the \`from\` parameter in your RPC calls.`,
    },
    MISSING_TX_PARAM_TO_SIGN_LOCALLY: {
      number: 105,
      message: "Missing param %param% from a tx being signed locally.",
      title: "Missing transaction parameter",
      description: `You are trying to send a transaction with a locally managed
account, and some parameters are missing.

Please double check your transactions' parameters.`,
    },
    NO_REMOTE_ACCOUNT_AVAILABLE: {
      number: 106,
      message:
        "No local account was set and there are accounts in the remote node.",
      title: "No remote accounts available",
      description: `No local account was set and there are accounts in the remote node.

Please make sure that your QRL node has unlocked accounts.`,
    },
    INVALID_HD_PATH: {
      number: 107,
      message:
        "HD path %path% is invalid. Read about BIP32 to know about the valid forms.",
      title: "Invalid HD path",
      description: `An invalid HD/BIP32 derivation path was provided in your config.

Read the accounts configuration documentation to learn how to define HD accounts correctly.`,
    },
    INVALID_RPC_QUANTITY_VALUE: {
      number: 108,
      message:
        "Received invalid value `%value%` from/to the node's JSON-RPC, but a Quantity was expected.",
      title: "Invalid JSON-RPC value",
      description: `One of your transactions sent or received an invalid JSON-RPC QUANTITY value.

Please double check your calls' parameters and keep your QRL node up to date.`,
    },
    NODE_IS_NOT_RUNNING: {
      number: 109,
      message: `Cannot connect to the network %network%.
Please make sure your node is running, and check your internet connection and networks config`,
      title: "Cannot connect to the network",
      description: `Cannot connect to the network.

Please make sure your node is running, and check your internet connection and networks config.`,
    },
    NETWORK_TIMEOUT: {
      number: 110,
      message: `Network connection timed-out.
Please check your internet connection and networks config`,
      title: "Network timeout",
      description: `One of your JSON-RPC requests timed-out.

Please make sure your node is running, and check your internet connection and networks config.`,
    },
    INVALID_JSON_RESPONSE: {
      number: 111,
      message: "Invalid JSON-RPC response received: %response%",
      title: "Invalid JSON-RPC response",
      description: `One of your JSON-RPC requests received an invalid response.

Please make sure your node is running, and check your internet connection and networks config.`,
    },
    DEPLOYMENT_FAILED: {
      number: 112,
      message:
        "Contract deployment transaction %txHash% failed with status %status%.",
      title: "Contract deployment failed",
      description: `A contract deployment transaction was mined, but its receipt reports failure.`,
    },
    MISSING_CONTRACT_ADDRESS: {
      number: 113,
      message:
        "Contract deployment transaction %txHash% did not return a contract address.",
      title: "Missing contract address",
      description: `A contract deployment transaction was mined, but its receipt didn't include a contract address.`,
    },
    QRL_IN_MEMORY_NODE_UNSUPPORTED: {
      number: 114,
      message:
        "The legacy in-memory development network/server is not supported by the QRL-only fork.",
      title: "Unsupported legacy QRL node mode",
      description: `Use qrlLocal for in-process tests, or configure a network with an HTTP URL that points to a running go-qrl node. The legacy buidlerevm/hardhat node server mode is not supported.`,
    },
    INVALID_QRL_ADDRESS: {
      number: 115,
      message: "Invalid QRL address %address%.",
      title: "Invalid QRL address",
      description: `A QRL address must use the Q prefix followed by 128 hexadecimal characters.`,
    },
    INVALID_HEX_DATA: {
      number: 116,
      message: "Invalid hex data %value%.",
      title: "Invalid hex data",
      description: `QRL transaction data and bytecode values must be hexadecimal strings, optionally prefixed with 0x.`,
    },
    INVALID_QRL_ABI: {
      number: 117,
      message: "Invalid QRL ABI operation: %message%.",
      title: "Invalid QRL ABI operation",
      description: `The requested QRL contract ABI operation can't be encoded or decoded.`,
    },
    LEGACY_ETH_RPC_UNSUPPORTED: {
      number: 121,
      message: "Legacy eth_* JSON-RPC method %method% is not supported.",
      title: "Unsupported legacy JSON-RPC method",
      description: `This project is QRL-only. Use the equivalent qrl_* JSON-RPC method instead.`,
    },
    QRLJS_MONOREPO_UNAVAILABLE: {
      number: 123,
      message:
        "Cannot load local qrljs-monorepo from %path%: %message%. Build qrljs-monorepo first or set networks.%network%.qrlJsMonorepoPath / QRLJS_MONOREPO_PATH.",
      title: "Local qrljs-monorepo is unavailable",
      description: `The qrlLocal provider needs a locally built qrljs-monorepo because the QRL VM packages are not consumed as published Hardhat dependencies yet. Set QRLJS_MONOREPO_PATH or choose an HTTP network like qrl.`,
    },
    LEDGER_TRANSPORT_UNAVAILABLE: {
      number: 118,
      message: "QRL Ledger transport is unavailable: %message%.",
      title: "QRL Ledger transport unavailable",
      description: `The QRL Ledger provider couldn't load the Node HID transport.`,
    },
    LEDGER_INVALID_RESPONSE: {
      number: 119,
      message: "Invalid QRL Ledger response: %message%.",
      title: "Invalid QRL Ledger response",
      description: `The QRL Ledger app returned a response that Hardhat couldn't decode.`,
    },
    LEDGER_ACCOUNT_NOT_FOUND: {
      number: 120,
      message:
        "Could not find QRL Ledger derivation path for account %account%.",
      title: "QRL Ledger account not found",
      description: `Hardhat couldn't derive a Ledger path matching the configured QRL account.`,
    },
    TRANSACTION_RECEIPT_MISMATCH: {
      number: 122,
      message:
        "Transaction receipt hash mismatch. Expected %expected%, got %actual%.",
      title: "Transaction receipt hash mismatch",
      description: `The QRL node returned a transaction receipt for a different transaction hash than the one Hardhat requested.`,
    },
    MISSING_QRL_SENDER: {
      number: 124,
      message:
        "No sender account available for the transaction on network %network%. Pass an explicit `from`, set `networks.%network%.from` in your config, or use a network that exposes accounts through qrl_accounts.",
      title: "No QRL sender account available",
      description: `Hardhat couldn't resolve a default sender for a transaction sent through an ergonomic contract helper.

The default sender is resolved in this order: the transaction's own \`from\` field, the network's \`from\` config field, and finally the first account returned by \`qrl_accounts\`.`,
    },
    UNLINKED_BYTECODE: {
      number: 125,
      message:
        "The bytecode of contract %contractName% has unresolved library references: %libraries%. Pass their deployed addresses through the `libraries` option.",
      title: "Unresolved library references",
      description: `The contract uses one or more external libraries whose addresses were not provided at deployment time.

Deploy the libraries first and pass their addresses, e.g. \`qrl.getContractFactory("MyContract", { libraries: { MyLib: "Q..." } })\`.`,
    },
    LINKING_UNKNOWN_LIBRARY: {
      number: 126,
      message:
        "Contract %contractName% does not need library %library%. Needed libraries: %libraries%.",
      title: "Unknown library provided for linking",
      description: `A library address was provided for a library that the contract's bytecode does not reference.

Double check the library name; both the bare name and the fully qualified \`file.hyp:Library\` form are accepted.`,
    },
    LINKING_AMBIGUOUS_LIBRARY: {
      number: 127,
      message:
        "The library name %library% is ambiguous for contract %contractName%. It matches: %candidates%. Use the fully qualified name.",
      title: "Ambiguous library name for linking",
      description: `Two or more libraries referenced by the contract share the same bare name.

Use the fully qualified \`file.hyp:Library\` form to disambiguate.`,
    },
    LINKING_INVALID_ADDRESS: {
      number: 128,
      message:
        "Invalid address %address% provided for library %library% of contract %contractName%.",
      title: "Invalid library address for linking",
      description: `The address provided for a library is not a valid QRL address.

QRL addresses start with \`Q\` followed by 128 hex characters.`,
    },
    LINKING_PLACEHOLDER_MISMATCH: {
      number: 129,
      message:
        "The bytecode of contract %contractName% does not contain the expected link placeholder for library %library% at offset %offset%. The artifact may be corrupted or produced by an incompatible compiler.",
      title: "Link reference placeholder mismatch",
      description: `A link reference reported by the compiler does not point at a \`__$...$__\` placeholder in the bytecode.

Recompile the project with a matching hypc build; if the problem persists, report it.`,
    },
    INVALID_INITIAL_DATE: {
      number: 130,
      message:
        "Invalid initialDate %value%. Use an ISO 8601 date string, e.g. 2026-01-01T00:00:00Z.",
      title: "Invalid initialDate network config value",
      description: `The \`initialDate\` value of a qrl-local network could not be parsed as a date.

Use an ISO 8601 date string, e.g. \`2026-01-01T00:00:00Z\`.`,
    },
  },
  TASK_DEFINITIONS: {
    PARAM_AFTER_VARIADIC: {
      number: 200,
      message:
        "Could not set positional param %paramName% for task %taskName% because there is already a variadic positional param and it has to be the last positional one.",
      title: "Could not add positional param",
      description: `Could add a positional param to your task because
there is already a variadic positional param and it has to be the last
positional one.

Please double check your task definitions.`,
    },
    PARAM_ALREADY_DEFINED: {
      number: 201,
      message:
        "Could not set param %paramName% for task %taskName% because its name is already used.",
      title: "Repeated param name",
      description: `Could not add a param to your task because its name is already used.

Please double check your task definitions.`,
    },
    PARAM_CLASHES_WITH_HARDHAT_PARAM: {
      number: 202,
      message:
        "Could not set param %paramName% for task %taskName% because its name is used as a param for Hardhat.",
      title: "Hardhat and task param names clash",
      description: `Could not add a param to your task because its name is used as a param for Hardhat.

Please double check your task definitions.`,
    },
    MANDATORY_PARAM_AFTER_OPTIONAL: {
      number: 203,
      message:
        "Could not set param %paramName% for task %taskName% because it is mandatory and it was added after an optional positional param.",
      title: "Optional param followed by a required one",
      description: `Could not add param to your task because it is required and it was added after an optional positional param.

Please double check your task definitions.`,
    },
    OVERRIDE_NO_PARAMS: {
      number: 204,
      message:
        "Redefinition of task %taskName% failed. You can't change param definitions in an overridden task.",
      title: "Attempted to add params to an overridden task",
      description: `You can't change param definitions in an overridden task.

Please, double check your task definitions.`,
    },
    OVERRIDE_NO_MANDATORY_PARAMS: {
      number: 210,
      message:
        "Redefinition of task %taskName% failed. Unsupported operation adding mandatory (non optional) param definitions in an overridden task.",
      title: "Attempted to add mandatory params to an overridden task",
      description: `You can't add mandatory (non optional) param definitions in an overridden task.
The only supported param additions for overridden tasks are flags,
and optional params.

Please, double check your task definitions.`,
    },
    OVERRIDE_NO_POSITIONAL_PARAMS: {
      number: 211,
      message:
        "Redefinition of task %taskName% failed. Unsupported operation adding positional param definitions in an overridden task.",
      title: "Attempted to add positional params to an overridden task",
      description: `You can't add positional param definitions in an overridden task.
The only supported param additions for overridden tasks are flags,
and optional params.

Please, double check your task definitions.`,
    },
    OVERRIDE_NO_VARIADIC_PARAMS: {
      number: 212,
      message:
        "Redefinition of task %taskName% failed. Unsupported operation adding variadic param definitions in an overridden task.",
      title: "Attempted to add variadic params to an overridden task",
      description: `You can't add variadic param definitions in an overridden task.
The only supported param additions for overridden tasks are flags,
and optional params.

Please, double check your task definitions.`,
    },

    ACTION_NOT_SET: {
      number: 205,
      message: "No action set for task %taskName%.",
      title: "Tried to run task without an action",
      description: `A task was run, but it has no action set.

Please double check your task definitions.`,
    },
    RUNSUPER_NOT_AVAILABLE: {
      number: 206,
      message:
        "Tried to call runSuper from a non-overridden definition of task %taskName%",
      title: "`runSuper` not available",
      description: `You tried to call \`runSuper\` from a non-overridden task.

Please use \`runSuper.isDefined\` to make sure that you can call it.`,
    },
    DEFAULT_VALUE_WRONG_TYPE: {
      number: 207,
      message:
        "Default value for param %paramName% of task %taskName% doesn't match the default one, try specifying it.",
      title: "Default value has incorrect type",
      description: `One of your tasks has a parameter whose default value doesn't match the expected type.

Please double check your task definitions.`,
    },
    DEFAULT_IN_MANDATORY_PARAM: {
      number: 208,
      message:
        "Default value for param %paramName% of task %taskName% shouldn't be set.",
      title: "Required parameter has a default value",
      description: `One of your tasks has a required parameter with a default value.

Please double check your task definitions.`,
    },
    INVALID_PARAM_NAME_CASING: {
      number: 209,
      message:
        "Invalid param name %paramName% in task %taskName%. Param names must be camelCase.",
      title: "Invalid casing in parameter name",
      description: `Your parameter names must use camelCase.

Please double check your task definitions.`,
    },
  },
  ARGUMENTS: {
    INVALID_ENV_VAR_VALUE: {
      number: 300,
      message: "Invalid environment variable %varName%'s value: %value%",
      title: "Invalid environment variable value",
      description: `You are setting one of Hardhat arguments using an environment variable, but it has an incorrect value.

Please double check your environment variables.`,
    },
    INVALID_VALUE_FOR_TYPE: {
      number: 301,
      message: "Invalid value %value% for argument %name% of type %type%",
      title: "Invalid argument type",
      description: `One of your Hardhat or task's arguments has an invalid type.

Please double check your arguments.`,
    },
    INVALID_INPUT_FILE: {
      number: 302,
      message:
        "Invalid argument %name%: File %value% doesn't exist or is not a readable file.",
      title: "Invalid file argument",
      description: `One of your tasks expected a file as an argument, but you provided a
non-existent or non-readable file.

Please double check your arguments.`,
    },
    UNRECOGNIZED_TASK: {
      number: 303,
      message: "Unrecognized task %task%",
      title: "Unrecognized task",
      description: `Tried to run a non-existent task.

Please double check the name of the task you are trying to run.`,
    },
    UNRECOGNIZED_COMMAND_LINE_ARG: {
      number: 304,
      message:
        "Unrecognised command line argument %argument%.\nNote that task arguments must come after the task name.",
      title: "Unrecognized command line argument",
      description: `Hardhat couldn't recognize one of your command line arguments.

This may be because you are writing it before the task name. It should come after it.

Please double check how you invoked Hardhat.`,
    },
    UNRECOGNIZED_PARAM_NAME: {
      number: 305,
      message: "Unrecognized param %param%",
      title: "Unrecognized param",
      description: `Hardhat couldn't recognize one of your tasks' parameters.

Please double check how you invoked Hardhat or run your task.`,
    },
    MISSING_TASK_ARGUMENT: {
      number: 306,
      message: "Missing task argument %param%",
      title: "Missing task argument",
      description: `You tried to run a task, but one of its required arguments was missing.

Please double check how you invoked Hardhat or run your task.`,
    },
    MISSING_POSITIONAL_ARG: {
      number: 307,
      message: "Missing positional argument %param%",
      title: "Missing task positional argument",
      description: `You tried to run a task, but one of its required arguments was missing.

Please double check how you invoked Hardhat or run your task.`,
    },
    UNRECOGNIZED_POSITIONAL_ARG: {
      number: 308,
      message: "Unrecognized positional argument %argument%",
      title: "Unrecognized task positional argument",
      description: `You tried to run a task with more positional arguments than needed.

Please double check how you invoked Hardhat or run your task.`,
    },
    REPEATED_PARAM: {
      number: 309,
      message: "Repeated parameter %param%",
      title: "Repeated task parameter",
      description: `You tried to run a task with a repeated parameter.

Please double check how you invoked Hardhat or run your task.`,
    },
    PARAM_NAME_INVALID_CASING: {
      number: 310,
      message: "Invalid param %param%. Command line params must be lowercase.",
      title: "Invalid casing in command line parameter",
      description: `You tried to run Hardhat with a parameter with invalid casing. They must be lowercase.

Please double check how you invoked Hardhat.`,
    },
    INVALID_JSON_ARGUMENT: {
      number: 311,
      message: "Error parsing JSON value for argument %param%: %error%",
      title: "Invalid JSON parameter",
      description: `You tried to run a task with an invalid JSON parameter.

Please double check how you invoked Hardhat or run your task.`,
    },
  },
  RESOLVER: {
    FILE_NOT_FOUND: {
      number: 400,
      message: "File %file% doesn't exist.",
      title: "Hyperion source not found",
      description: `Tried to resolve a non-existing Hyperion source as an entry-point.`,
    },
    FILE_OUTSIDE_PROJECT: {
      number: 401,
      message: "File %file% is outside the project.",
      title: "Tried to import file outside your project",
      description: `One of your projects tried to import a file that it's outside your Hardhat project.

This is disabled for security reasons.`,
    },
    LIBRARY_FILE_NOT_LOCAL: {
      number: 402,
      message:
        "File %file% belongs to a library but was treated as a local one.",
      title: "Resolved library file as a local one",
      description: `One of your libraries' files was treated as a local file. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    LIBRARY_NOT_INSTALLED: {
      number: 403,
      message: "Library %library% is not installed.",
      title: "Hyperion library not installed",
      description: `One of your Hyperion sources imports a library that is not installed.

Please double check your imports or install the missing dependency.`,
    },
    LIBRARY_FILE_NOT_FOUND: {
      number: 404,
      message: "File %file% doesn't exist.",
      title: "Missing library file",
      description: `One of your libraries' files was imported but doesn't exist.

Please double check your imports or update your libraries.`,
    },
    ILLEGAL_IMPORT: {
      number: 405,
      message: "Illegal import %imported% from %from%",
      title: "Illegal Hyperion import",
      description: `One of your libraries tried to use a relative import to import a file outside of its scope.

This is disabled for security reasons.`,
    },
    FILE_OUTSIDE_LIB: {
      number: 406,
      message:
        "File %file% from %library% is resolved to a path outside of its library.",
      title: "Illegal Hyperion import",
      description: `One of your libraries tried to use a relative import to import a file outside of its scope.

This is disabled for security reasons.`,
    },
    IMPORTED_FILE_NOT_FOUND: {
      number: 407,
      message: "File %imported%, imported from %from%, not found.",
      title: "Imported file not found",
      description: `One of your source files imported a non-existing one.

Please double check your imports.`,
    },
  },
  BUILTIN_TASKS: {
    COMPILE_FAILURE: {
      number: 600,
      message: "Compilation failed",
      title: "Compilation failed",
      description: `Your smart contracts failed to compile.

Please check Hardhat's output for more details.`,
    },
    RUN_FILE_NOT_FOUND: {
      number: 601,
      message: "Script %script% doesn't exist.",
      title: "Script doesn't exist",
      description: `Tried to use \`hardhat run\` to execut a non-existing script.

Please double check your script's path`,
    },
    RUN_SCRIPT_ERROR: {
      number: 602,
      message: "Error running script {%script%}: %error%",
      title: "Error running script",
      description: `Running a script resulted in an error.

Please check Hardhat's output for more details.`,
    },
    FLATTEN_CYCLE: {
      number: 603,
      message: "Hardhat flatten doesn't support cyclic dependencies.",
      title: "Flatten detected cyclic dependencies",
      description: `Hardhat flatten doesn't support cyclic dependencies.

We recommend not using this kind of dependencies.`,
    },
    JSONRPC_SERVER_ERROR: {
      number: 604,
      message: "Error running JSON-RPC server: %error%",
      title: "Error running JSON-RPC server",
      description: `There was error while starting the JSON-RPC HTTP server.`,
    },
    JSONRPC_HANDLER_ERROR: {
      number: 605,
      message: "Error handling JSON-RPC request: %error%",
      title: "Error handling JSON-RPC request",
      description: `Handling an incoming JSON-RPC request resulted in an error.`,
    },
    JSONRPC_UNSUPPORTED_NETWORK: {
      number: 606,
      message:
        "The local JSON-RPC server is not supported by the QRL-only fork yet.",
      title: "Unsupported network for JSON-RPC server.",
      description: `This fork currently supports live go-qrl networks only.

Configure a network with an HTTP URL that points to a running go-qrl node.`,
    },
  },
  ARTIFACTS: {
    NOT_FOUND: {
      number: 700,
      message: 'Artifact for contract "%contractName%" not found.',
      title: "Artifact not found",
      description: `Tried to import a non-existing artifact.

Please double check that your contracts have been compiled and your artifact's name.`,
    },
  },
  PLUGINS: {
    NOT_INSTALLED: {
      number: 800,
      message: `Plugin %plugin% is not installed.
%extraMessage%Please run: npm install --save-dev%extraFlags% %plugin%`,
      title: "Plugin not installed",
      description: `You are trying to use a plugin that hasn't been installed.

Please follow Hardhat's instructions to resolve this.`,
    },
    MISSING_DEPENDENCY: {
      number: 801,
      message: `Plugin %plugin% requires %dependency% to be installed.
%extraMessage%Please run: npm install --save-dev%extraFlags% "%dependency%@%versionSpec%"`,
      title: "Plugin dependencies not installed",
      description: `You are trying to use a plugin with unmet dependencies.

Please follow Hardhat's instructions to resolve this.`,
    },
    DEPENDENCY_VERSION_MISMATCH: {
      number: 802,
      message: `Plugin %plugin% requires %dependency% version %versionSpec% but got %installedVersion%.
%extraMessage%If you haven't installed %dependency% manually, please run: npm install --save-dev%extraFlags% "%dependency%@%versionSpec%"
If you have installed %dependency% yourself, please reinstall it with a valid version.`,
      title: "Plugin dependencies's version mismatch",
      description: `You are trying to use a plugin that requires a different version of one of its dependencies.

Please follow Hardhat's instructions to resolve this.`,
    },
    OLD_STYLE_IMPORT_DETECTED: {
      number: 803,
      message: `You are trying to load %pluginNameText% with a require or import statement.
Please replace it with a call to usePlugin("%pluginNameCode%").`,
      title: "Importing a plugin with `require`",
      description: `You are trying to load a plugin with a call to \`require\`.

Please use \`usePlugin(npm-plugin-package)\` instead.`,
    },
  },
  INTERNAL: {
    TEMPLATE_INVALID_VARIABLE_NAME: {
      number: 900,
      message:
        "Variable names can only include ascii letters and numbers, and start with a letter, but got %variable%",
      title: "Invalid error message template",
      description: `An error message template contains an invalid variable name. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    TEMPLATE_VALUE_CONTAINS_VARIABLE_TAG: {
      number: 901,
      message:
        "Template values can't include variable tags, but %variable%'s value includes one",
      title: "Invalid error message replacement",
      description: `Tried to replace an error message variable with a value that contains another variable name. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
    TEMPLATE_VARIABLE_TAG_MISSING: {
      number: 902,
      message: "Variable %variable%'s tag not present in the template",
      title: "Missing replacement value from error message template",
      description: `An error message template is missing a replacement value. This is a bug.

Please report it to the QRL Hardhat maintainers to help improve Hardhat.`,
    },
  },
};
