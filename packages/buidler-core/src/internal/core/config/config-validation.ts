import * as t from "io-ts";
import { Context, getFunctionName, ValidationError } from "io-ts/lib";
import { Reporter } from "io-ts/lib/Reporter";

import { LEGACY_IN_MEMORY_NETWORK_NAME } from "../../constants";
import { isValidQrlAddress } from "../../qrl/address";
import { HardhatError } from "../errors";
import { ERRORS } from "../errors-list";

function stringify(v: any): string {
  if (typeof v === "function") {
    return getFunctionName(v);
  }
  if (typeof v === "number" && !isFinite(v)) {
    if (isNaN(v)) {
      return "NaN";
    }
    return v > 0 ? "Infinity" : "-Infinity";
  }
  return JSON.stringify(v);
}

function getContextPath(context: Context): string {
  const keysPath = context
    .slice(1)
    .map((c) => c.key)
    .join(".");

  return `${context[0].type.name}.${keysPath}`;
}

function getMessage(e: ValidationError): string {
  const lastContext = e.context[e.context.length - 1];

  return e.message !== undefined
    ? e.message
    : getErrorMessage(
        getContextPath(e.context),
        e.value,
        lastContext.type.name
      );
}

function getErrorMessage(path: string, value: any, expectedType: string) {
  return `Invalid value ${stringify(
    value
  )} for ${path} - Expected a value of type ${expectedType}.`;
}

export function failure(es: ValidationError[]): string[] {
  return es.map(getMessage);
}

export function success(): string[] {
  return [];
}

export const DotPathReporter: Reporter<string[]> = {
  report: (validation) => validation.fold(failure, success),
};

function optional<TypeT, OutputT>(
  codec: t.Type<TypeT, OutputT, unknown>,
  name: string = `${codec.name} | undefined`
): t.Type<TypeT | undefined, OutputT | undefined, unknown> {
  return new t.Type(
    name,
    (u: unknown): u is TypeT | undefined => u === undefined || codec.is(u),
    (u, c) => (u === undefined ? t.success(u) : codec.validate(u, c)),
    (a) => (a === undefined ? undefined : codec.encode(a))
  );
}

// IMPORTANT: This t.types MUST be kept in sync with the actual types.

const OtherAccountsConfig = t.type({
  type: t.string,
});

const NetworkConfigAccounts = t.union([
  t.literal("remote"),
  t.array(t.string),
  OtherAccountsConfig,
]);

const QRL_EXTENDED_SEED_REGEX = /^0x[0-9a-fA-F]{102}$/;
const QRL_LOCAL_BALANCE_REGEX = /^(0x[0-9a-fA-F]+|[0-9]+)$/;

const HttpHeaders = t.record(t.string, t.string, "httpHeaders");

const HttpNetworkConfig = t.type({
  chainId: optional(t.number),
  from: optional(t.string),
  gas: optional(t.union([t.literal("auto"), t.number])),
  gasPrice: optional(t.union([t.literal("auto"), t.number])),
  gasMultiplier: optional(t.number),
  consoleLog: optional(t.boolean),
  url: optional(t.string),
  accounts: optional(NetworkConfigAccounts),
  httpHeaders: optional(HttpHeaders),
});

const QrlLocalAccountConfig = t.type({
  address: t.string,
  balance: optional(t.union([t.string, t.number])),
  seed: optional(t.string),
  nonce: optional(t.number),
});

const QrlLocalNetworkConfig = t.type({
  type: t.literal("qrl-local"),
  chainId: optional(t.number),
  from: optional(t.string),
  gas: optional(t.union([t.literal("auto"), t.number])),
  gasPrice: optional(t.union([t.literal("auto"), t.number])),
  gasMultiplier: optional(t.number),
  accounts: optional(t.array(QrlLocalAccountConfig)),
  automine: optional(t.boolean),
  consoleLog: optional(t.boolean),
  blockGasLimit: optional(t.number),
  initialDate: optional(t.string),
  throwOnTransactionFailures: optional(t.boolean),
  throwOnCallFailures: optional(t.boolean),
  allowUnlimitedContractSize: optional(t.boolean),
  stackTraces: optional(t.boolean),
  qrlJsMonorepoPath: optional(t.string),
});

const NetworkConfig = t.union([HttpNetworkConfig, QrlLocalNetworkConfig]);

const Networks = t.record(t.string, NetworkConfig);

const ProjectPaths = t.type({
  root: optional(t.string),
  cache: optional(t.string),
  artifacts: optional(t.string),
  sources: optional(t.string),
  tests: optional(t.string),
});

const HyperionOptimizerConfig = t.type({
  enabled: optional(t.boolean),
  runs: optional(t.number),
});

const HyperionConfig = t.type({
  version: optional(t.string),
  compilerPath: optional(t.string),
  compilerRepositoryUrl: optional(t.string),
  optimizer: optional(HyperionOptimizerConfig),
});

const HardhatConfig = t.type(
  {
    defaultNetwork: optional(t.string),
    networks: optional(Networks),
    paths: optional(ProjectPaths),
    hyperion: optional(HyperionConfig),
  },
  "HardhatConfig"
);

/**
 * Validates the config, throwing a HardhatError if invalid.
 * @param config
 */
export function validateConfig(config: any) {
  const errors = getValidationErrors(config);

  if (errors.length === 0) {
    return;
  }

  let errorList = errors.join("\n  * ");
  errorList = `  * ${errorList}`;

  throw new HardhatError(ERRORS.GENERAL.INVALID_CONFIG, { errors: errorList });
}

export function getValidationErrors(config: any): string[] {
  const errors = [];

  // These can't be validated with io-ts
  if (config !== undefined && typeof config.networks === "object") {
    const inMemoryNetwork = config.networks[LEGACY_IN_MEMORY_NETWORK_NAME];
    if (inMemoryNetwork !== undefined) {
      errors.push(
        `HardhatConfig.networks.${LEGACY_IN_MEMORY_NETWORK_NAME} is not supported by the QRL-only fork. Use qrlLocal for in-process tests or configure a live go-qrl HTTP network instead.`
      );
    }

    for (const [networkName, netConfig] of Object.entries<any>(
      config.networks
    )) {
      if (networkName === LEGACY_IN_MEMORY_NETWORK_NAME) {
        continue;
      }

      if (netConfig.type === "qrl-local") {
        if (netConfig.url !== undefined) {
          errors.push(
            getErrorMessage(
              `HardhatConfig.networks.${networkName}.url`,
              netConfig.url,
              "undefined"
            )
          );
        }

        if (netConfig.accounts !== undefined) {
          if (!Array.isArray(netConfig.accounts)) {
            errors.push(
              getErrorMessage(
                `HardhatConfig.networks.${networkName}.accounts`,
                netConfig.accounts,
                "QRL local account array"
              )
            );
          } else {
            for (const [
              accountIndex,
              account,
            ] of netConfig.accounts.entries()) {
              if (
                account === undefined ||
                account === null ||
                typeof account !== "object"
              ) {
                errors.push(
                  getErrorMessage(
                    `HardhatConfig.networks.${networkName}.accounts.${accountIndex}`,
                    account,
                    "QRL local account"
                  )
                );
                continue;
              }

              if (
                typeof account.address !== "string" ||
                !isValidQrlAddress(account.address)
              ) {
                errors.push(
                  getErrorMessage(
                    `HardhatConfig.networks.${networkName}.accounts.${accountIndex}.address`,
                    account.address,
                    "64-byte QRL address"
                  )
                );
              }

              if (
                account.balance !== undefined &&
                ((typeof account.balance !== "string" &&
                  typeof account.balance !== "number") ||
                  (typeof account.balance === "string" &&
                    !QRL_LOCAL_BALANCE_REGEX.test(account.balance)) ||
                  (typeof account.balance === "number" &&
                    (!Number.isSafeInteger(account.balance) ||
                      account.balance < 0)))
              ) {
                errors.push(
                  getErrorMessage(
                    `HardhatConfig.networks.${networkName}.accounts.${accountIndex}.balance`,
                    account.balance,
                    "non-negative integer balance"
                  )
                );
              }

              if (
                account.seed !== undefined &&
                (typeof account.seed !== "string" ||
                  !QRL_EXTENDED_SEED_REGEX.test(account.seed))
              ) {
                errors.push(
                  getErrorMessage(
                    `HardhatConfig.networks.${networkName}.accounts.${accountIndex}.seed`,
                    account.seed,
                    "51-byte QRL extended seed hex string"
                  )
                );
              }

              if (
                account.nonce !== undefined &&
                (!Number.isSafeInteger(account.nonce) || account.nonce < 0)
              ) {
                errors.push(
                  getErrorMessage(
                    `HardhatConfig.networks.${networkName}.accounts.${accountIndex}.nonce`,
                    account.nonce,
                    "non-negative safe integer"
                  )
                );
              }
            }
          }
        }

        if (
          typeof netConfig.from === "string" &&
          !isValidQrlAddress(netConfig.from)
        ) {
          errors.push(
            getErrorMessage(
              `HardhatConfig.networks.${networkName}.from`,
              netConfig.from,
              "64-byte QRL address"
            )
          );
        }

        continue;
      }

      if (typeof netConfig.url !== "string") {
        errors.push(
          getErrorMessage(
            `HardhatConfig.networks.${networkName}.url`,
            netConfig.url,
            "string"
          )
        );
      }

      const netConfigResult = HttpNetworkConfig.decode(netConfig);
      if (netConfigResult.isLeft()) {
        errors.push(
          getErrorMessage(
            `HardhatConfig.networks.${networkName}`,
            netConfig,
            "HttpNetworkConfig"
          )
        );
      }

      if (Array.isArray(netConfig.accounts)) {
        for (const [accountIndex, account] of netConfig.accounts.entries()) {
          if (
            typeof account === "string" &&
            !QRL_EXTENDED_SEED_REGEX.test(account)
          ) {
            errors.push(
              getErrorMessage(
                `HardhatConfig.networks.${networkName}.accounts.${accountIndex}`,
                account,
                "51-byte QRL extended seed hex string"
              )
            );
          }
        }
      } else if (netConfig.accounts?.type === "ledger") {
        if (!Array.isArray(netConfig.accounts.accounts)) {
          errors.push(
            getErrorMessage(
              `HardhatConfig.networks.${networkName}.accounts.accounts`,
              netConfig.accounts.accounts,
              "64-byte QRL address array"
            )
          );
        } else {
          for (const [
            accountIndex,
            account,
          ] of netConfig.accounts.accounts.entries()) {
            if (typeof account !== "string" || !isValidQrlAddress(account)) {
              errors.push(
                getErrorMessage(
                  `HardhatConfig.networks.${networkName}.accounts.accounts.${accountIndex}`,
                  account,
                  "64-byte QRL address"
                )
              );
            }
          }
        }
      }

      if (
        typeof netConfig.from === "string" &&
        !isValidQrlAddress(netConfig.from)
      ) {
        errors.push(
          getErrorMessage(
            `HardhatConfig.networks.${networkName}.from`,
            netConfig.from,
            "64-byte QRL address"
          )
        );
      }
    }
  }

  // io-ts can get confused by unsupported legacy network configs and report
  // noisy HTTPConfig errors. Return the clearer QRL-only error instead.
  if (errors.length > 0) {
    return errors;
  }

  const result = HardhatConfig.decode(config);

  if (result.isRight()) {
    return errors;
  }

  const ioTsErrors = DotPathReporter.report(result);
  return [...errors, ...ioTsErrors];
}
