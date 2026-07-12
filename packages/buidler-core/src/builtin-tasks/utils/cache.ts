import fsExtra from "fs-extra";
import isEqual from "lodash/isEqual";
import path from "path";

import {
  COMPILER_INPUT_FILENAME,
  COMPILER_OUTPUT_FILENAME,
} from "../../internal/constants";
import { CompilerFingerprint } from "../../internal/hyperion/compiler-version";
import { glob } from "../../internal/util/glob";
import { getPackageJson } from "../../internal/util/packageInfo";
import { HyperionConfig, ProjectPaths } from "../../types";

// Checks the earliest date of modification for compiled files against the latest date for source files (including libraries).
// Furthermore, cache is invalidated if Hardhat's version changes, a different
// compiler config is set in the config, or the resolved hypc binary changes
// (path, mtime, size or detected version — the config's `version` string
// alone cannot tell two local builds apart).
export async function areArtifactsCached(
  sourceTimestamps: number[],
  newHyperionConfig: HyperionConfig,
  paths: ProjectPaths,
  compilerFingerprint?: CompilerFingerprint
): Promise<boolean> {
  // No resolvable hypc binary means nothing can be verified — never report
  // a cache hit (a legacy cache without a stored fingerprint would otherwise
  // compare equal to an undefined one). The compile itself then surfaces
  // the real "binary not found" error.
  if (compilerFingerprint === undefined) {
    return false;
  }

  const oldConfig = await getLastUsedConfig(paths.cache);

  if (
    oldConfig === undefined ||
    !compareHyperionConfigs(oldConfig.hyperion, newHyperionConfig) ||
    !isEqual(oldConfig.compiler, compilerFingerprint) ||
    !(await compareHardhatVersion(oldConfig.hardhatVersion))
  ) {
    return false;
  }

  const maxSourceDate = getMaxSourceDate(sourceTimestamps);
  const minArtifactDate = await getMinArtifactDate(paths.artifacts);

  if (
    !(await fsExtra.pathExists(path.join(paths.cache, COMPILER_INPUT_FILENAME)))
  ) {
    return false;
  }

  if (
    !(await fsExtra.pathExists(
      path.join(paths.cache, COMPILER_OUTPUT_FILENAME)
    ))
  ) {
    return false;
  }

  const lastConfigTimestamp = await getLastUsedConfigTimestamp(paths.cache);
  if (
    lastConfigTimestamp !== undefined &&
    lastConfigTimestamp > maxSourceDate
  ) {
    return true;
  }

  return maxSourceDate < minArtifactDate;
}

async function getModificationDatesInDir(dir: string): Promise<number[]> {
  const pattern = path.join(dir, "**", "*");
  const files = await glob(pattern);

  return Promise.all(
    files.map(async (file) => (await fsExtra.stat(file)).ctimeMs)
  );
}

function getMaxSourceDate(sourceTimestamps: number[]): number {
  return Math.max(...sourceTimestamps);
}

async function getMinArtifactDate(artifactsPath: string): Promise<number> {
  const timestamps = await getModificationDatesInDir(artifactsPath);

  if (timestamps.length === 0) {
    return 0;
  }

  return Math.min(...timestamps);
}

const LAST_CONFIG_USED_FILENAME = "last-compiler-config.json";

function getPathToCachedLastConfigPath(cachePath: string) {
  const pathToLastConfigUsed = path.join(cachePath, LAST_CONFIG_USED_FILENAME);

  return pathToLastConfigUsed;
}

async function getLastUsedConfig(
  cachePath: string
): Promise<
  | {
      hyperion: HyperionConfig;
      hardhatVersion: string;
      compiler?: CompilerFingerprint;
    }
  | undefined
> {
  const pathToConfig = getPathToCachedLastConfigPath(cachePath);

  if (!(await fsExtra.pathExists(pathToConfig))) {
    return undefined;
  }

  return fsExtra.readJson(pathToConfig);
}

async function getLastUsedConfigTimestamp(
  cachePath: string
): Promise<number | undefined> {
  const pathToConfig = getPathToCachedLastConfigPath(cachePath);

  if (!(await fsExtra.pathExists(pathToConfig))) {
    return undefined;
  }

  return (await fsExtra.stat(pathToConfig)).ctimeMs;
}

export async function cacheHardhatConfig(
  paths: ProjectPaths,
  config: HyperionConfig,
  compilerFingerprint?: CompilerFingerprint
) {
  const pathToLastConfigUsed = getPathToCachedLastConfigPath(paths.cache);
  const newJson = {
    hyperion: config,
    hardhatVersion: await getCurrentHardhatVersion(),
    compiler: compilerFingerprint,
  };

  await fsExtra.ensureDir(path.dirname(pathToLastConfigUsed));

  return fsExtra.writeFile(
    pathToLastConfigUsed,
    JSON.stringify(newJson, undefined, 2),
    "utf-8"
  );
}

function compareHyperionConfigs(
  oldConfig: HyperionConfig,
  newConfig: HyperionConfig
): boolean {
  return isEqual(oldConfig, newConfig);
}

async function getCurrentHardhatVersion(): Promise<string> {
  const packageJson = await getPackageJson();

  return packageJson.version;
}

async function compareHardhatVersion(
  lastHardhatVersion: string
): Promise<boolean> {
  const currentVersion = await getCurrentHardhatVersion();

  return lastHardhatVersion === currentVersion;
}
