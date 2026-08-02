import findup from "find-up";
import * as fs from "fs";
import path from "path";

import { HardhatError } from "../../core/errors";
import { ERRORS } from "../../core/errors-list";

/**
 * Single resolver for the qrljs runtime modules that power `hardhatqrlvm`.
 *
 * Resolution order:
 *
 * 1. Development override — `networks.<name>.qrlJsMonorepoPath` or the
 *    `QRLJS_MONOREPO_PATH` environment variable pointing at a BUILT
 *    qrljs-monorepo checkout. A set override is authoritative: when it is
 *    invalid the error surfaces instead of silently falling through, so a
 *    developer never runs against a stale bundle by accident.
 * 2. Published `@theqrl/*` npm packages — reserved for when the runtime
 *    packages are released to the registry; not active yet.
 * 3. Bundled runtime — a self-contained bundle shipped inside the packed
 *    `@theqrl/hardhat` artifact under `qrljs-runtime/` (built by
 *    `scripts/bundle-qrljs-runtime.js` from a local qrljs checkout).
 *
 * All runtime modules come from ONE source; mixing versions between state,
 * execution, blocks, transactions, and utilities is never allowed.
 */

export interface QrlJsRuntimeModules {
  blockQrl: any;
  evmQrl: any;
  stateQrl: any;
  txQrl: any;
  utilQrl: any;
  vmQrl: any;
}

interface RuntimeSource {
  kind: "override" | "bundled";
  description: string;
}

export interface ResolvedQrlJsRuntime extends QrlJsRuntimeModules {
  source: RuntimeSource;
}

// The bundle directory lives at the package root next to console.hyp. This
// This module runs from the compiled or source internal tree, so the package
// root is located via the closest package.json.
function getBundleDir(): string {
  const packageJsonPath = findup.sync("package.json", { cwd: __dirname });
  return path.join(path.dirname(packageJsonPath!), "qrljs-runtime");
}

const OVERRIDE_ENV_VAR = "QRLJS_MONOREPO_PATH";

// The most recent successful resolution. Later tx-only lookups (HTTP-network
// signing) reuse it so every consumer in the process sees the same qrljs
// source.
let lastResolvedRuntime: ResolvedQrlJsRuntime | undefined;

export function loadQrlJsRuntime(
  networkName: string,
  overridePath?: string
): ResolvedQrlJsRuntime {
  const configuredPath = overridePath ?? process.env[OVERRIDE_ENV_VAR];

  const runtime =
    configuredPath !== undefined
      ? loadOverrideRuntime(path.resolve(configuredPath), networkName)
      : loadBundledRuntime(networkName);

  lastResolvedRuntime = runtime;
  return runtime;
}

/**
 * The tx module enables local signing of qrljs transactions on HTTP
 * networks. It always comes from the same source as the rest of the runtime:
 * the resolution already made in this process, the environment override, or
 * the bundle. Absence of ANY source is a feature-detection result
 * (undefined), but a set override that cannot be loaded is an error.
 */
export function loadQrlJsTxRuntime(): any | undefined {
  if (lastResolvedRuntime !== undefined) {
    return lastResolvedRuntime.txQrl;
  }

  const configuredPath = process.env[OVERRIDE_ENV_VAR];
  if (configuredPath !== undefined) {
    lastResolvedRuntime = loadOverrideRuntime(
      path.resolve(configuredPath),
      "hardhatqrlvm"
    );
    return lastResolvedRuntime.txQrl;
  }

  if (!fs.existsSync(path.join(getBundleDir(), "runtime.cjs"))) {
    return undefined;
  }

  lastResolvedRuntime = loadBundledRuntime("hardhatqrlvm");
  return lastResolvedRuntime.txQrl;
}

/** Exposed for --verbose diagnostics and the compatibility check. */
export function readBundledRuntimeManifest(): any | undefined {
  const manifestPath = path.join(getBundleDir(), "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return undefined;
  }
}

/** Test-only: clears the process-wide resolution memo. */
export function resetQrlJsRuntimeCacheForTesting(): void {
  lastResolvedRuntime = undefined;
}

function loadOverrideRuntime(
  monorepoPath: string,
  networkName: string
): ResolvedQrlJsRuntime {
  const block = requireOverrideModule(
    monorepoPath,
    "packages/block/dist/cjs/index.js",
    networkName
  );
  const evm = requireOverrideModule(
    monorepoPath,
    "packages/evm/dist/cjs/index.js",
    networkName
  );
  const statemanager = requireOverrideModule(
    monorepoPath,
    "packages/statemanager/dist/cjs/index.js",
    networkName
  );
  const vm = requireOverrideModule(
    monorepoPath,
    "packages/vm/dist/cjs/index.js",
    networkName
  );
  const util = requireOverrideModule(
    monorepoPath,
    "packages/util/dist/cjs/index.js",
    networkName
  );
  const tx = requireOverrideModule(
    monorepoPath,
    "packages/tx/dist/cjs/index.js",
    networkName
  );

  assertRuntimeExports(
    block,
    evm,
    statemanager,
    tx,
    util,
    vm,
    monorepoPath,
    networkName
  );

  return {
    blockQrl: block.qrl,
    evmQrl: evm.qrl,
    stateQrl: statemanager.qrl,
    txQrl: tx.qrl,
    utilQrl: util.qrl,
    vmQrl: vm.qrl,
    source: { kind: "override", description: monorepoPath },
  };
}

// The runtime ships as ONE bundle so all modules share a single copy of
// every dependency (separate bundles would break instanceof checks across
// their duplicated @theqrl/util copies).
function loadBundledRuntime(networkName: string): ResolvedQrlJsRuntime {
  const bundlePath = path.join(getBundleDir(), "runtime.cjs");

  if (!fs.existsSync(bundlePath)) {
    return throwQrlJsRuntimeUnavailable(
      "<unset>",
      networkName,
      "no qrljs runtime bundle is present in this installation and no override is set"
    );
  }

  let bundle;
  try {
    // tslint:disable-next-line: no-var-requires
    bundle = require(bundlePath);
  } catch (error) {
    return throwQrlJsRuntimeUnavailable(
      getBundleDir(),
      networkName,
      (error as Error).message
    );
  }

  assertRuntimeExports(
    bundle.block,
    bundle.evm,
    bundle.statemanager,
    bundle.tx,
    bundle.util,
    bundle.vm,
    getBundleDir(),
    networkName
  );

  const manifest = readBundledRuntimeManifest();
  const description =
    manifest?.qrlJsCommit !== undefined
      ? `bundled runtime (qrljs ${manifest.qrlJsCommit})`
      : "bundled runtime";

  return {
    blockQrl: bundle.block.qrl,
    evmQrl: bundle.evm.qrl,
    stateQrl: bundle.statemanager.qrl,
    txQrl: bundle.tx.qrl,
    utilQrl: bundle.util.qrl,
    vmQrl: bundle.vm.qrl,
    source: { kind: "bundled", description },
  };
}

function requireOverrideModule(
  monorepoPath: string,
  relativeEntry: string,
  networkName: string
): any {
  const entryPath = path.join(monorepoPath, relativeEntry);
  try {
    // tslint:disable-next-line: no-var-requires
    return require(entryPath);
  } catch (error) {
    return throwQrlJsRuntimeUnavailable(
      monorepoPath,
      networkName,
      (error as Error).message
    );
  }
}

function assertRuntimeExports(
  block: any,
  evm: any,
  statemanager: any,
  tx: any,
  util: any,
  vm: any,
  sourcePath: string,
  networkName: string
): void {
  const requiredExports: Array<[any, string, string]> = [
    [block, "block", "QRLBlock"],
    [evm, "evm", "QRLEVM"],
    [statemanager, "statemanager", "QRLStateManager"],
    [tx, "tx", "QRLDynamicFeeTransaction"],
    [util, "util", "QRLAddress"],
    [vm, "vm", "QRLVM"],
  ];

  for (const [runtimeModule, moduleName, exportName] of requiredExports) {
    if (runtimeModule?.qrl?.[exportName] === undefined) {
      throwQrlJsRuntimeUnavailable(
        sourcePath,
        networkName,
        `the ${moduleName} module does not export qrl.${exportName}`
      );
    }
  }
}

function throwQrlJsRuntimeUnavailable(
  sourcePath: string,
  networkName: string,
  message: string
): never {
  throw new HardhatError(ERRORS.NETWORK.QRLJS_MONOREPO_UNAVAILABLE, {
    path: sourcePath,
    network: networkName,
    message,
  });
}
