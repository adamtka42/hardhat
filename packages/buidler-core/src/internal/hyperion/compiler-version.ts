import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import { LocalCompilerIdentity } from "./compiler-types";

const execFileAsync = promisify(execFile);

// Identifies the exact hypc binary a compilation ran with. The detected
// version string alone is not enough as a cache key: two local builds can
// carry the same version, so the resolved path, mtime and size are part of
// the fingerprint to catch binary swaps and rebuilds.
export type CompilerFingerprint = LocalCompilerIdentity;

/**
 * Resolves the hypc binary exactly like the compiler invocation does:
 * config `compilerPath`, then HYPERION_HYPC_PATH, then HYPC_PATH, then
 * `hypc` from PATH. Path-like values are made absolute against the project
 * root (the compiler runs with `cwd: projectRoot`), so the version probe
 * and the compilation always target the same binary. Bare names are
 * returned as-is and looked up on PATH at execution time.
 */
export function resolveHypcPath(
  compilerPath: string | undefined,
  projectRoot: string
): string {
  const configured =
    compilerPath !== undefined
      ? compilerPath
      : process.env.HYPERION_HYPC_PATH !== undefined
      ? process.env.HYPERION_HYPC_PATH
      : process.env.HYPC_PATH !== undefined
      ? process.env.HYPC_PATH
      : "hypc";

  return isPathLike(configured)
    ? path.resolve(projectRoot, configured)
    : configured;
}

function isPathLike(binary: string): boolean {
  return binary.includes(path.sep) || binary.includes("/");
}

/**
 * Extracts the long version (e.g. `0.2.0-ci.2026.5.21+commit.cd63ffc3...`)
 * from `hypc --version` output:
 *
 *   hypc, the hyperion compiler commandline interface
 *   Version: 0.2.0-ci.2026.5.21+commit.cd63ffc3.mod.Linux.g++
 */
export function parseHypcVersionOutput(output: string): string | undefined {
  const match = output.match(/^\s*Version:\s*(\S+)\s*$/m);
  return match !== null ? match[1] : undefined;
}

/**
 * Returns the warning to print when the configured `hyperion.version`
 * disagrees with the binary, or undefined when nothing should be printed.
 * `"local"` never warns; a concrete version matches when it is the detected
 * long version or its release prefix (local builds carry `-`/`+` suffixes).
 */
export function getVersionMismatchWarning(
  configuredVersion: string,
  compiler:
    | { path: string; longVersion?: string }
    | CompilerFingerprint
    | undefined
): string | undefined {
  if (configuredVersion === "local") {
    return undefined;
  }

  if (compiler === undefined || compiler.longVersion === undefined) {
    return `Hyperion config claims version ${configuredVersion}, but the version of the hypc binary could not be detected.`;
  }

  const detected = compiler.longVersion;
  if (
    detected === configuredVersion ||
    detected.startsWith(`${configuredVersion}+`) ||
    detected.startsWith(`${configuredVersion}-`)
  ) {
    return undefined;
  }

  const compilerPath =
    "path" in compiler ? compiler.path : compiler.resolvedPath;
  return `Hyperion config claims version ${configuredVersion}, but ${compilerPath} reports ${detected}. Compiling with the binary's version.`;
}

// `hypc --version` results memoized per binary identity, so repeated
// fingerprint requests within one run cost a single exec.
const versionCache = new Map<
  string,
  { mtimeMs: number; size: number; longVersion?: string }
>();

/**
 * Stats and version-probes the resolved hypc binary. Returns undefined when
 * the binary cannot be found — the compile itself will then fail with the
 * real error, and the cache treats "unknown binary" as a miss. The project
 * root anchors relative and empty PATH entries, mirroring how execFile
 * resolves a bare name with `cwd: projectRoot`.
 */
export async function getCompilerFingerprint(
  hypcPath: string,
  projectRoot: string
): Promise<CompilerFingerprint | undefined> {
  const resolvedPath = resolveBinaryOnPath(hypcPath, projectRoot);
  if (resolvedPath === undefined) {
    return undefined;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolvedPath);
  } catch {
    return undefined;
  }

  const cached = versionCache.get(resolvedPath);
  if (
    cached !== undefined &&
    cached.mtimeMs === stats.mtimeMs &&
    cached.size === stats.size
  ) {
    return makeFingerprint(resolvedPath, stats, cached.longVersion);
  }

  let longVersion: string | undefined;
  try {
    const { stdout } = await execFileAsync(resolvedPath, ["--version"], {
      shell: process.platform === "win32",
    });
    longVersion = parseHypcVersionOutput(stdout.toString());
  } catch {
    longVersion = undefined;
  }

  versionCache.set(resolvedPath, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    longVersion,
  });

  return makeFingerprint(resolvedPath, stats, longVersion);
}

// The fingerprint is persisted in the compile cache as JSON, where undefined
// values disappear — omit the key entirely so a stat-identical reload
// compares deep-equal to a freshly computed fingerprint.
function makeFingerprint(
  resolvedPath: string,
  stats: fs.Stats,
  longVersion: string | undefined
): CompilerFingerprint {
  const fingerprint: CompilerFingerprint = {
    source: "local",
    resolvedPath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
  if (longVersion !== undefined) {
    fingerprint.longVersion = longVersion;
  }
  return fingerprint;
}

function resolveBinaryOnPath(
  binary: string,
  projectRoot: string
): string | undefined {
  if (isPathLike(binary)) {
    return fs.existsSync(binary) ? path.resolve(binary) : undefined;
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter);
  // The bare name is tried first so an explicit `hypc.exe` does not get a
  // second PATHEXT extension appended.
  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")]
      : [""];

  for (const entry of pathEntries) {
    // Relative and empty PATH entries resolve against the project root —
    // exactly what execFile sees when running with `cwd: projectRoot`.
    const entryDir = path.resolve(projectRoot, entry);
    for (const extension of extensions) {
      const candidate = path.join(entryDir, binary + extension.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Missing or unreadable entries are skipped.
      }
    }
  }

  return undefined;
}
