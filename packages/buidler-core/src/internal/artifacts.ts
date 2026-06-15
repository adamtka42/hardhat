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
  contractOutput: any
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

  return {
    contractName,
    abi: contractOutput.abi,
    bytecode,
    deployedBytecode,
    linkReferences,
    deployedLinkReferences,
  };
}

function getArtifactPath(artifactsPath: string, contractName: string): string {
  return path.join(artifactsPath, `${contractName}.json`);
}

/**
 * Stores an artifact in the given path.
 *
 * @param artifactsPath the artifacts' directory.
 * @param artifact the artifact to be stored.
 */
export async function saveArtifact(artifactsPath: string, artifact: Artifact) {
  await fsExtra.ensureDir(artifactsPath);
  await fsExtra.writeJSON(
    path.join(artifactsPath, `${artifact.contractName}.json`),
    artifact,
    {
      spaces: 2,
    }
  );
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
