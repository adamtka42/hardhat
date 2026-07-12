export interface LocalCompilerIdentity {
  source: "local";
  resolvedPath: string;
  longVersion?: string;
  mtimeMs: number;
  size: number;
}

export interface DownloadedCompilerIdentity {
  source: "downloaded";
  version: string;
  longVersion: string;
  checksum: string;
  checksumAlgorithm: "keccak256" | "sha256";
  repositoryUrl: string;
}

export type CompilerIdentity =
  | LocalCompilerIdentity
  | DownloadedCompilerIdentity;

export interface ResolvedHyperionCompiler {
  path: string;
  source: CompilerIdentity["source"];
  version?: string;
  longVersion?: string;
  identity: CompilerIdentity;
}
