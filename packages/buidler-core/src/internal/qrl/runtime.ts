import findup from "find-up";
import * as fs from "fs";
import path from "path";

import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

/**
 * Single resolver for the qrljs runtime modules that power `qrlLocal`.
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
 * 3. Bundled runtime — self-contained bundles shipped inside the packed
 *    `@theqrl/hardhat` artifact under `qrljs-runtime/` (built by
 *    `scripts/bundle-qrljs-runtime.js` from a local qrljs checkout).
 */

export interface QrlJsRuntimeModules {
  vmQrl: any;
  utilQrl: any;
}

interface RuntimeSource {
  kind: "override" | "bundled";
  description: string;
}

export interface ResolvedQrlJsRuntime extends QrlJsRuntimeModules {
  source: RuntimeSource;
}

// The bundle directory lives at the package root next to console.hyp. This
// module runs from <root>/internal/qrl (compiled) or <root>/src/internal/qrl
// (ts-node), so the root is located via the closest package.json.
function getBundleDir(): string {
  const packageJsonPath = findup.sync("package.json", { cwd: __dirname });
  return path.join(path.dirname(packageJsonPath!), "qrljs-runtime");
}

const OVERRIDE_ENV_VAR = "QRLJS_MONOREPO_PATH";

export function loadQrlJsRuntime(
  networkName: string,
  overridePath?: string
): ResolvedQrlJsRuntime {
  const configuredPath = overridePath ?? process.env[OVERRIDE_ENV_VAR];

  if (configuredPath !== undefined) {
    const monorepoPath = path.resolve(configuredPath);
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

    assertRuntimeExports(vm, util, monorepoPath, networkName);

    return {
      vmQrl: vm.qrl,
      utilQrl: util.qrl,
      source: { kind: "override", description: monorepoPath },
    };
  }

  const bundled = loadBundledModules(networkName);
  assertRuntimeExports(bundled.vm, bundled.util, getBundleDir(), networkName);

  return {
    vmQrl: bundled.vm.qrl,
    utilQrl: bundled.util.qrl,
    source: { kind: "bundled", description: bundled.description },
  };
}

/**
 * The tx module is optional: it enables local signing of qrljs transactions
 * on HTTP networks. Absence is a feature-detection result, not an error —
 * except when an explicitly set override cannot be loaded.
 */
export function loadQrlJsTxRuntime(): any | undefined {
  const configuredPath = process.env[OVERRIDE_ENV_VAR];

  if (configuredPath !== undefined) {
    const monorepoPath = path.resolve(configuredPath);
    const tx = requireOverrideModule(
      monorepoPath,
      "packages/tx/dist/cjs/index.js",
      "qrlLocal"
    );
    return tx.qrl;
  }

  const bundle = requireBundle();
  return bundle?.tx?.qrl;
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

// The runtime ships as ONE bundle so vm, util, and tx share a single copy of
// every dependency (separate bundles would break instanceof checks across
// their duplicated @theqrl/util copies).
function requireBundle(): { vm: any; util: any; tx: any } | undefined {
  const bundlePath = path.join(getBundleDir(), "runtime.cjs");
  if (!fs.existsSync(bundlePath)) {
    return undefined;
  }
  // tslint:disable-next-line: no-var-requires
  return require(bundlePath);
}

function loadBundledModules(
  networkName: string
): { vm: any; util: any; description: string } {
  let bundle;
  try {
    bundle = requireBundle();
  } catch (error) {
    return throwQrlJsRuntimeUnavailable(
      getBundleDir(),
      networkName,
      (error as Error).message
    );
  }

  if (bundle === undefined) {
    return throwQrlJsRuntimeUnavailable(
      "<unset>",
      networkName,
      "no qrljs runtime bundle is present in this installation and no override is set"
    );
  }

  const manifest = readBundledRuntimeManifest();
  const description =
    manifest?.qrlJsCommit !== undefined
      ? `bundled runtime (qrljs ${manifest.qrlJsCommit})`
      : "bundled runtime";
  return { vm: bundle.vm, util: bundle.util, description };
}

function assertRuntimeExports(
  vm: any,
  util: any,
  sourcePath: string,
  networkName: string
): void {
  if (vm.qrl?.QRLLocalProvider === undefined) {
    throwQrlJsRuntimeUnavailable(
      sourcePath,
      networkName,
      "the vm module does not export qrl.QRLLocalProvider"
    );
  }

  if (util.qrl?.QRLAddress === undefined) {
    throwQrlJsRuntimeUnavailable(
      sourcePath,
      networkName,
      "the util module does not export qrl.QRLAddress"
    );
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
