import { Artifact } from "../../types";
import { HardhatError } from "../core/errors";
import { ERRORS } from "../core/errors-list";

import { isValidQrlAddress } from "./address";

/**
 * A QRL address occupies 64 bytes, so a library placeholder spans 128 hex
 * characters in the bytecode: `__` + `$` + 122 hash chars + `$` + `__`.
 * The placeholder is always located by scanning for this exact shape at the
 * reported byte offset; the `length` field of a link reference is never
 * trusted (older hypc builds report the inherited 20-byte value).
 */
const PLACEHOLDER_HEX_LENGTH = 128;
const PLACEHOLDER_PATTERN = /^__\$[0-9a-f]{122}\$__$/;

export interface QrlLinkReference {
  sourceName: string;
  libraryName: string;
  start: number;
}

export function collectLinkReferences(artifact: Artifact): QrlLinkReference[] {
  const references: QrlLinkReference[] = [];
  const linkReferences = artifact.linkReferences ?? {};

  for (const sourceName of Object.keys(linkReferences)) {
    for (const libraryName of Object.keys(linkReferences[sourceName])) {
      for (const position of linkReferences[sourceName][libraryName]) {
        references.push({
          sourceName,
          libraryName,
          start: position.start,
        });
      }
    }
  }

  return references;
}

export function getNeededLibraryNames(artifact: Artifact): string[] {
  const names = new Set(
    collectLinkReferences(artifact).map(
      (ref) => `${ref.sourceName}:${ref.libraryName}`
    )
  );
  return Array.from(names).sort();
}

/**
 * Returns the artifact bytecode with every library placeholder replaced by
 * the corresponding deployed library address. Library names are accepted in
 * bare (`MathLib`) and fully qualified (`contracts/MathLib.hyp:MathLib`)
 * form. Throws when a provided library is unknown or ambiguous, when an
 * address is invalid, or when the bytecode does not contain the expected
 * placeholder at a reported offset.
 */
export function linkQrlBytecode(
  artifact: Artifact,
  libraries: { [libraryName: string]: string }
): string {
  const references = collectLinkReferences(artifact);

  const resolved = new Map<string, { address: string; used: boolean }>();
  for (const providedName of Object.keys(libraries)) {
    const matches = references.filter(
      (ref) =>
        `${ref.sourceName}:${ref.libraryName}` === providedName ||
        ref.libraryName === providedName
    );

    const matchedNames = new Set(
      matches.map((ref) => `${ref.sourceName}:${ref.libraryName}`)
    );

    if (matchedNames.size === 0) {
      throw new HardhatError(ERRORS.NETWORK.LINKING_UNKNOWN_LIBRARY, {
        contractName: artifact.contractName,
        library: providedName,
        libraries: formatLibraryList(getNeededLibraryNames(artifact)),
      });
    }

    if (matchedNames.size > 1) {
      throw new HardhatError(ERRORS.NETWORK.LINKING_AMBIGUOUS_LIBRARY, {
        contractName: artifact.contractName,
        library: providedName,
        candidates: formatLibraryList(Array.from(matchedNames).sort()),
      });
    }

    const address = libraries[providedName];
    if (typeof address !== "string" || !isValidQrlAddress(address)) {
      throw new HardhatError(ERRORS.NETWORK.LINKING_INVALID_ADDRESS, {
        contractName: artifact.contractName,
        library: providedName,
        address: String(address),
      });
    }

    const fullyQualifiedName = matchedNames.values().next().value as string;
    resolved.set(fullyQualifiedName, {
      address: address.slice(1).toLowerCase(),
      used: false,
    });
  }

  let bytecodeBody = stripHexPrefix(artifact.bytecode);

  for (const ref of references) {
    const fullyQualifiedName = `${ref.sourceName}:${ref.libraryName}`;
    const entry = resolved.get(fullyQualifiedName);
    if (entry === undefined) {
      continue;
    }

    const offset = ref.start * 2;
    const segment = bytecodeBody.slice(offset, offset + PLACEHOLDER_HEX_LENGTH);
    if (!PLACEHOLDER_PATTERN.test(segment)) {
      throw new HardhatError(ERRORS.NETWORK.LINKING_PLACEHOLDER_MISMATCH, {
        contractName: artifact.contractName,
        library: fullyQualifiedName,
        offset: ref.start,
      });
    }

    bytecodeBody =
      bytecodeBody.slice(0, offset) +
      entry.address +
      bytecodeBody.slice(offset + PLACEHOLDER_HEX_LENGTH);
    entry.used = true;
  }

  return `0x${bytecodeBody}`;
}

/**
 * Names of the libraries whose placeholders are still present in the
 * bytecode, in fully qualified form. Non-empty means the bytecode cannot be
 * deployed yet.
 */
export function getUnresolvedLibraries(
  artifact: Artifact,
  bytecode: string
): string[] {
  const body = stripHexPrefix(bytecode);
  const unresolved = new Set<string>();

  for (const ref of collectLinkReferences(artifact)) {
    const offset = ref.start * 2;
    const segment = body.slice(offset, offset + PLACEHOLDER_HEX_LENGTH);
    if (PLACEHOLDER_PATTERN.test(segment)) {
      unresolved.add(`${ref.sourceName}:${ref.libraryName}`);
    }
  }

  // Defensive net: any leftover placeholder marker counts as unresolved even
  // if the link references do not point at it.
  if (unresolved.size === 0 && body.includes("__$")) {
    unresolved.add("<unknown>");
  }

  return Array.from(unresolved).sort();
}

export function assertDeployableBytecode(
  artifact: Artifact,
  bytecode: string
): void {
  const unresolved = getUnresolvedLibraries(artifact, bytecode);
  if (unresolved.length > 0) {
    throw new HardhatError(ERRORS.NETWORK.UNLINKED_BYTECODE, {
      contractName: artifact.contractName,
      libraries: formatLibraryList(unresolved),
    });
  }
}

function formatLibraryList(names: string[]): string {
  return names.length > 0 ? names.join(", ") : "none";
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}
