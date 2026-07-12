import path from "path";

import { HyperionConfig } from "../../types";
import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

import { HyperionCompilerDownloader } from "./compiler-downloader";
import {
  LocalCompilerIdentity,
  ResolvedHyperionCompiler,
} from "./compiler-types";
import { getCompilerFingerprint, resolveHypcPath } from "./compiler-version";

export const HYPERION_COMPILER_REPOSITORY_ENV =
  "HYPERION_COMPILER_REPOSITORY_URL";

const DEFAULT_HYPERION_COMPILER_REPOSITORY_URL: string | undefined = undefined;

export async function resolveHyperionCompiler(
  config: HyperionConfig,
  projectRoot: string,
  cacheDir: string
): Promise<ResolvedHyperionCompiler> {
  const repositoryUrl =
    config.compilerRepositoryUrl ??
    process.env[HYPERION_COMPILER_REPOSITORY_ENV] ??
    DEFAULT_HYPERION_COMPILER_REPOSITORY_URL;
  const hasExplicitLocalCompiler =
    config.compilerPath !== undefined ||
    process.env.HYPERION_HYPC_PATH !== undefined ||
    process.env.HYPC_PATH !== undefined;

  if (
    config.version !== "local" &&
    repositoryUrl !== undefined &&
    !hasExplicitLocalCompiler
  ) {
    const downloader = new HyperionCompilerDownloader(
      repositoryUrl,
      path.join(cacheDir, "hyperion-compilers")
    );
    return downloader.resolve(config.version);
  }

  const selectedPath = resolveHypcPath(config.compilerPath, projectRoot);
  const fingerprint = await getCompilerFingerprint(selectedPath, projectRoot);
  if (fingerprint === undefined) {
    throw new HardhatError(ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_NOT_FOUND, {
      path: selectedPath,
    });
  }

  const identity: LocalCompilerIdentity = fingerprint;
  return {
    path: fingerprint.resolvedPath,
    source: "local",
    version: config.version === "local" ? undefined : config.version,
    longVersion: fingerprint.longVersion,
    identity,
  };
}
