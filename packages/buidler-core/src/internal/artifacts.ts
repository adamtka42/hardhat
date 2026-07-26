import fsExtra from "fs-extra";
import * as path from "path";

import { Artifact } from "../types";

import { HardhatError } from "./core/errors";
import { ERRORS } from "./core/errors-list";

/**
 * Retrieves an artifact for the given `contractName` from the compilation output.
 *
 * @param contractName the contract's name.
 * @param contractOutput the contract's compilation output as emitted by Hyperion.
 */
export function getArtifactFromContractOutput(
  contractName: string,
  contractOutput: any,
  sourceName?: string
): Artifact {
  const compilerBytecode =
    contractOutput.bytecodeOutput && contractOutput.bytecodeOutput.bytecode;
  let bytecode: string =
    compilerBytecode && compilerBytecode.object ? compilerBytecode.object : "";

  if (bytecode.slice(0, 2).toLowerCase() !== "0x") {
    bytecode = `0x${bytecode}`;
  }

  const compilerDeployedBytecode =
    contractOutput.bytecodeOutput &&
    contractOutput.bytecodeOutput.deployedBytecode;
  let deployedBytecode: string =
    compilerDeployedBytecode && compilerDeployedBytecode.object
      ? compilerDeployedBytecode.object
      : "";

  if (deployedBytecode.slice(0, 2).toLowerCase() !== "0x") {
    deployedBytecode = `0x${deployedBytecode}`;
  }

  const linkReferences =
    compilerBytecode && compilerBytecode.linkReferences
      ? compilerBytecode.linkReferences
      : {};
  const deployedLinkReferences =
    compilerDeployedBytecode && compilerDeployedBytecode.linkReferences
      ? compilerDeployedBytecode.linkReferences
      : {};

  const artifact: Artifact = {
    contractName,
    abi: contractOutput.abi,
    bytecode,
    deployedBytecode,
    linkReferences,
    deployedLinkReferences,
  };

  if (sourceName !== undefined) {
    artifact.sourceName = sourceName;
  }

  return artifact;
}

function getArtifactPath(artifactsPath: string, contractName: string): string {
  const parsed = parseFullyQualifiedName(contractName);

  if (parsed !== undefined) {
    return getSourceArtifactPath(
      artifactsPath,
      parsed.sourceName,
      parsed.contractName
    );
  }

  return path.join(artifactsPath, `${contractName}.json`);
}

function getSourceArtifactPath(
  artifactsPath: string,
  sourceName: string,
  contractName: string
): string {
  return path.join(artifactsPath, sourceName, `${contractName}.json`);
}

function parseFullyQualifiedName(
  contractName: string
): { sourceName: string; contractName: string } | undefined {
  const separator = contractName.lastIndexOf(":");

  if (separator === -1) {
    return undefined;
  }

  return {
    sourceName: contractName.slice(0, separator),
    contractName: contractName.slice(separator + 1),
  };
}

/**
 * Stores an artifact in the given path.
 *
 * @param artifactsPath the artifacts' directory.
 * @param artifact the artifact to be stored.
 */
export async function saveArtifact(
  artifactsPath: string,
  artifact: Artifact,
  saveRootArtifact: boolean = true
) {
  if (artifact.sourceName !== undefined) {
    await writeArtifact(
      getSourceArtifactPath(
        artifactsPath,
        artifact.sourceName,
        artifact.contractName
      ),
      artifact
    );
  }

  if (saveRootArtifact || artifact.sourceName === undefined) {
    await writeArtifact(
      getArtifactPath(artifactsPath, artifact.contractName),
      artifact
    );
  }
}

async function writeArtifact(artifactPath: string, artifact: Artifact) {
  await fsExtra.ensureDir(path.dirname(artifactPath));
  await fsExtra.writeJSON(artifactPath, artifact, {
    spaces: 2,
  });
}

/**
 * Asynchronically reads an artifact with the given `contractName` from the given `artifactPath`.
 *
 * @param artifactsPath the artifacts' directory.
 * @param contractName  the contract's name.
 */
export async function readArtifact(
  artifactsPath: string,
  contractName: string
): Promise<Artifact> {
  const artifactPath = getArtifactPath(artifactsPath, contractName);

  if (!fsExtra.pathExistsSync(artifactPath)) {
    throw new HardhatError(ERRORS.ARTIFACTS.NOT_FOUND, { contractName });
  }

  return fsExtra.readJson(artifactPath);
}

/**
 * Synchronically reads an artifact with the given `contractName` from the given `artifactPath`.
 *
 * @param artifactsPath the artifacts directory.
 * @param contractName  the contract's name.
 */
export function readArtifactSync(
  artifactsPath: string,
  contractName: string
): Artifact {
  const artifactPath = getArtifactPath(artifactsPath, contractName);

  if (!fsExtra.pathExistsSync(artifactPath)) {
    throw new HardhatError(ERRORS.ARTIFACTS.NOT_FOUND, { contractName });
  }

  return fsExtra.readJsonSync(artifactPath);
}
