import { createHash } from "crypto";
import fsExtra from "fs-extra";
import { keccak_256 } from "js-sha3";
import nodeFetch = require("node-fetch");
import path from "path";
import { URL } from "url";

import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

import {
  DownloadedCompilerIdentity,
  ResolvedHyperionCompiler,
} from "./compiler-types";

export interface HyperionCompilerBuild {
  path: string;
  version: string;
  longVersion: string;
  checksum?: string;
  checksumAlgorithm?: "keccak256" | "sha256";
  keccak256?: string;
  sha256?: string;
}

export interface HyperionCompilersManifest {
  builds: HyperionCompilerBuild[];
  releases: { [version: string]: string };
  latestRelease?: string;
}

interface CompilerChecksum {
  value: string;
  algorithm: "keccak256" | "sha256";
}

interface ValidatedCompilerBuild {
  url: URL;
  checksum: CompilerChecksum;
}

export class HyperionCompilerDownloader {
  private readonly _repositoryUrl: string;
  private readonly _repositoryCacheDir: string;

  constructor(repositoryUrl: string, compilersCacheDir: string) {
    this._repositoryUrl = normalizeRepositoryUrl(repositoryUrl);
    const repositoryKey = createHash("sha256")
      .update(this._repositoryUrl)
      .digest("hex")
      .slice(0, 16);
    this._repositoryCacheDir = path.join(compilersCacheDir, repositoryKey);
  }

  public async resolve(version: string): Promise<ResolvedHyperionCompiler> {
    const manifest = await this._getManifest();
    const hasRelease = Object.prototype.hasOwnProperty.call(
      manifest.releases,
      version
    );
    if (!hasRelease) {
      throw new HardhatError(
        ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_VERSION_NOT_FOUND,
        { version, url: this._repositoryUrl }
      );
    }

    const buildPath = manifest.releases[version];
    if (typeof buildPath !== "string") {
      throw repositoryError(
        this._repositoryUrl,
        "Compiler release path must be a string"
      );
    }

    const build = manifest.builds.find(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        candidate.path === buildPath
    );
    if (build === undefined) {
      throw repositoryError(
        this._repositoryUrl,
        "Compiler release references a missing build"
      );
    }

    const validatedBuild = validateBuild(build, version, this._repositoryUrl);
    const destination = path.join(
      this._repositoryCacheDir,
      "builds",
      safePathSegment(version),
      path.posix.basename(validatedBuild.url.pathname)
    );

    if (await fsExtra.pathExists(destination)) {
      if (await this._verifyCompiler(destination, validatedBuild.checksum)) {
        return resolvedDownloadedCompiler(
          destination,
          build,
          validatedBuild.checksum,
          this._repositoryUrl
        );
      }
      await fsExtra.remove(destination);
    }

    await this._downloadCompiler(build, validatedBuild.url, destination);
    if (!(await this._verifyCompiler(destination, validatedBuild.checksum))) {
      await fsExtra.remove(destination);
      throw new HardhatError(
        ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_INVALID_CHECKSUM,
        {
          version: build.version,
          algorithm: validatedBuild.checksum.algorithm,
        }
      );
    }

    if (process.platform !== "win32") {
      await fsExtra.chmod(destination, 0o755);
    }
    return resolvedDownloadedCompiler(
      destination,
      build,
      validatedBuild.checksum,
      this._repositoryUrl
    );
  }

  private async _getManifest(): Promise<HyperionCompilersManifest> {
    const manifestPath = path.join(this._repositoryCacheDir, "list.json");
    try {
      const response = await nodeFetch(
        new URL("list.json", this._repositoryUrl).href
      );
      if (!response.ok) {
        throw new HardhatError(
          ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_REPOSITORY_ERROR,
          {
            url: this._repositoryUrl,
            error: `HTTP ${response.status} ${response.statusText}`,
          }
        );
      }
      const manifest = validateManifest(
        await response.json(),
        this._repositoryUrl
      );
      await fsExtra.ensureDir(path.dirname(manifestPath));
      await fsExtra.writeJson(manifestPath, manifest, { spaces: 2 });
      return manifest;
    } catch (error) {
      if (await fsExtra.pathExists(manifestPath)) {
        try {
          return validateManifest(
            await fsExtra.readJson(manifestPath),
            this._repositoryUrl
          );
        } catch {
          // Report the original repository failure instead of a stale cache.
        }
      }

      if (HardhatError.isHardhatError(error)) {
        throw error;
      }
      throw new HardhatError(
        ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_REPOSITORY_ERROR,
        { url: this._repositoryUrl, error: getErrorMessage(error) },
        error
      );
    }
  }

  private async _downloadCompiler(
    build: HyperionCompilerBuild,
    buildUrl: URL,
    destination: string
  ): Promise<void> {
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    try {
      const response = await nodeFetch(buildUrl.href);
      if (!response.ok) {
        throw new HardhatError(
          ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_DOWNLOAD_FAILED,
          {
            version: build.version,
            error: `HTTP ${response.status} ${response.statusText}`,
          }
        );
      }
      await fsExtra.ensureDir(path.dirname(destination));
      const compiler = Buffer.from(await response.arrayBuffer());
      await fsExtra.writeFile(temporary, compiler);
      await fsExtra.move(temporary, destination, { overwrite: true });
    } catch (error) {
      await fsExtra.remove(temporary);
      if (HardhatError.isHardhatError(error)) {
        throw error;
      }
      throw new HardhatError(
        ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_DOWNLOAD_FAILED,
        { version: build.version, error: getErrorMessage(error) },
        error
      );
    }
  }

  private async _verifyCompiler(
    compilerPath: string,
    checksum: CompilerChecksum
  ): Promise<boolean> {
    const compiler = await fsExtra.readFile(compilerPath);
    const actual = calculateChecksum(compiler, checksum.algorithm);
    return actual === normalizeChecksum(checksum.value);
  }
}

function resolvedDownloadedCompiler(
  compilerPath: string,
  build: HyperionCompilerBuild,
  checksum: CompilerChecksum,
  repositoryUrl: string
): ResolvedHyperionCompiler {
  const identity: DownloadedCompilerIdentity = {
    source: "downloaded",
    version: build.version,
    longVersion: build.longVersion,
    checksum: normalizeChecksum(checksum.value),
    checksumAlgorithm: checksum.algorithm,
    repositoryUrl,
  };
  return {
    path: compilerPath,
    source: "downloaded",
    version: build.version,
    longVersion: build.longVersion,
    identity,
  };
}

function calculateChecksum(
  input: Buffer,
  algorithm: "keccak256" | "sha256"
): string {
  return algorithm === "sha256"
    ? createHash("sha256").update(input).digest("hex")
    : keccak_256(input);
}

function normalizeChecksum(checksum: string): string {
  return checksum.replace(/^0x/i, "").toLowerCase();
}

function validateManifest(
  value: any,
  repositoryUrl: string
): HyperionCompilersManifest {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.builds) ||
    value.releases === null ||
    typeof value.releases !== "object" ||
    Array.isArray(value.releases)
  ) {
    throw repositoryError(repositoryUrl, "Invalid compiler manifest");
  }
  return value;
}

function validateBuild(
  build: HyperionCompilerBuild,
  requestedVersion: string,
  repositoryUrl: string
): ValidatedCompilerBuild {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(build.path);
  } catch (error) {
    throw repositoryError(repositoryUrl, "Invalid compiler build path", error);
  }

  const pathSegments = decodedPath.split(/[\\/]/);
  if (
    typeof build.path !== "string" ||
    build.path === "" ||
    build.path.startsWith("/") ||
    build.path.startsWith("\\") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(build.path) ||
    pathSegments.includes(".") ||
    pathSegments.includes("..") ||
    build.version !== requestedVersion ||
    typeof build.longVersion !== "string" ||
    build.longVersion === ""
  ) {
    throw repositoryError(repositoryUrl, "Invalid compiler build entry");
  }

  const baseUrl = new URL(repositoryUrl);
  const buildUrl = new URL(build.path, baseUrl);
  if (
    buildUrl.origin !== baseUrl.origin ||
    !buildUrl.pathname.startsWith(baseUrl.pathname) ||
    buildUrl.pathname === baseUrl.pathname ||
    buildUrl.pathname.endsWith("/")
  ) {
    throw repositoryError(
      repositoryUrl,
      "Compiler build URL is outside repository"
    );
  }
  return {
    url: buildUrl,
    checksum: getBuildChecksum(build, repositoryUrl),
  };
}

function getBuildChecksum(
  build: HyperionCompilerBuild,
  repositoryUrl: string
): CompilerChecksum {
  const checksums: CompilerChecksum[] = [];
  const hasGenericChecksum =
    build.checksum !== undefined || build.checksumAlgorithm !== undefined;

  if (hasGenericChecksum) {
    if (
      typeof build.checksum !== "string" ||
      (build.checksumAlgorithm !== "keccak256" &&
        build.checksumAlgorithm !== "sha256")
    ) {
      throw repositoryError(repositoryUrl, "Invalid compiler checksum");
    }
    checksums.push({
      value: build.checksum,
      algorithm: build.checksumAlgorithm,
    });
  }

  if (build.keccak256 !== undefined) {
    checksums.push({ value: build.keccak256, algorithm: "keccak256" });
  }
  if (build.sha256 !== undefined) {
    checksums.push({ value: build.sha256, algorithm: "sha256" });
  }

  if (
    checksums.length !== 1 ||
    !/^(0x)?[0-9a-fA-F]{64}$/.test(checksums[0].value)
  ) {
    throw repositoryError(
      repositoryUrl,
      "Compiler build must contain exactly one valid checksum"
    );
  }
  return checksums[0];
}

function normalizeRepositoryUrl(repositoryUrl: string): string {
  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch (error) {
    throw repositoryError(repositoryUrl, "Invalid repository URL", error);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw repositoryError(
      repositoryUrl,
      "Compiler repository must use HTTP or HTTPS"
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw repositoryError(
      repositoryUrl,
      "Compiler repository URL cannot contain a query or fragment"
    );
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.href;
}

function repositoryError(
  repositoryUrl: string,
  message: string,
  parent?: Error
): HardhatError {
  return new HardhatError(
    ERRORS.BUILTIN_TASKS.HYPERION_COMPILER_REPOSITORY_ERROR,
    { url: repositoryUrl, error: message },
    parent
  );
}

function getErrorMessage(error: any): string {
  return error instanceof Error ? error.message : String(error);
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
