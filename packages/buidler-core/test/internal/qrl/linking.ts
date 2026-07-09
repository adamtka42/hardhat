import { assert } from "chai";

import { ERRORS } from "../../../src/internal/core/errors-list";
import {
  assertDeployableBytecode,
  getNeededLibraryNames,
  getUnresolvedLibraries,
  linkQrlBytecode,
} from "../../../src/internal/qrl/linking";
import { Artifact } from "../../../src/types";
import { expectHardhatError } from "../../helpers/errors";

const LIBRARY_ADDRESS = `Q${"ab".repeat(64)}`;
const OTHER_LIBRARY_ADDRESS = `Q${"cd".repeat(64)}`;

// `__` + `$` + 122 hash chars + `$` + `__` — 128 hex chars, the 64-byte slot.
function makePlaceholder(seed: string): string {
  return `__$${seed.repeat(122).slice(0, 122)}$__`;
}

function makeArtifact(options: {
  placeholders: Array<{
    sourceName: string;
    libraryName: string;
    seed: string;
  }>;
  prefix?: string;
  separator?: string;
}): Artifact {
  const prefix = options.prefix !== undefined ? options.prefix : "6080";
  const separator = options.separator !== undefined ? options.separator : "5f";

  let bytecode = prefix;
  const linkReferences: Artifact["linkReferences"] = {};

  for (const placeholder of options.placeholders) {
    const start = bytecode.length / 2;
    bytecode += makePlaceholder(placeholder.seed) + separator;

    if (linkReferences[placeholder.sourceName] === undefined) {
      linkReferences[placeholder.sourceName] = {};
    }
    if (
      linkReferences[placeholder.sourceName][placeholder.libraryName] ===
      undefined
    ) {
      linkReferences[placeholder.sourceName][placeholder.libraryName] = [];
    }
    // `length: 20` on purpose: real hypc builds before the fix report the
    // inherited Ethereum value, and linking must never trust it.
    linkReferences[placeholder.sourceName][placeholder.libraryName].push({
      start,
      length: 20,
    });
  }

  return {
    contractName: "UsesMathLib",
    abi: [],
    bytecode: `0x${bytecode}`,
    deployedBytecode: "0x",
    linkReferences,
    deployedLinkReferences: {},
  };
}

describe("QRL library linking", function () {
  it("lists needed library names", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
        { sourceName: "contracts/Other.hyp", libraryName: "Other", seed: "b" },
      ],
    });

    assert.deepEqual(getNeededLibraryNames(artifact), [
      "contracts/MathLib.hyp:MathLib",
      "contracts/Other.hyp:Other",
    ]);
  });

  it("links a placeholder with a bare library name", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });

    const linked = linkQrlBytecode(artifact, { MathLib: LIBRARY_ADDRESS });

    assert.equal(linked, `0x6080${"ab".repeat(64)}5f`);
    assert.deepEqual(getUnresolvedLibraries(artifact, linked), []);
  });

  it("links with a fully qualified library name", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });

    const linked = linkQrlBytecode(artifact, {
      "contracts/MathLib.hyp:MathLib": LIBRARY_ADDRESS,
    });

    assert.equal(linked, `0x6080${"ab".repeat(64)}5f`);
  });

  it("links every occurrence of a repeated placeholder", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });

    const linked = linkQrlBytecode(artifact, { MathLib: LIBRARY_ADDRESS });

    assert.equal(linked, `0x6080${"ab".repeat(64)}5f${"ab".repeat(64)}5f`);
  });

  it("links multiple libraries and lowercases the address body", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
        { sourceName: "contracts/Other.hyp", libraryName: "Other", seed: "b" },
      ],
    });

    const linked = linkQrlBytecode(artifact, {
      MathLib: `Q${"AB".repeat(64)}`,
      "contracts/Other.hyp:Other": OTHER_LIBRARY_ADDRESS,
    });

    assert.equal(linked, `0x6080${"ab".repeat(64)}5f${"cd".repeat(64)}5f`);
  });

  it("supports partial linking", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
        { sourceName: "contracts/Other.hyp", libraryName: "Other", seed: "b" },
      ],
    });

    const linked = linkQrlBytecode(artifact, { MathLib: LIBRARY_ADDRESS });

    assert.deepEqual(getUnresolvedLibraries(artifact, linked), [
      "contracts/Other.hyp:Other",
    ]);
  });

  it("rejects unknown library names", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });

    expectHardhatError(
      () => linkQrlBytecode(artifact, { WrongLib: LIBRARY_ADDRESS }),
      ERRORS.NETWORK.LINKING_UNKNOWN_LIBRARY
    );
  });

  it("rejects ambiguous bare library names", function () {
    const artifact = makeArtifact({
      placeholders: [
        { sourceName: "contracts/A.hyp", libraryName: "MathLib", seed: "a" },
        { sourceName: "contracts/B.hyp", libraryName: "MathLib", seed: "b" },
      ],
    });

    expectHardhatError(
      () => linkQrlBytecode(artifact, { MathLib: LIBRARY_ADDRESS }),
      ERRORS.NETWORK.LINKING_AMBIGUOUS_LIBRARY
    );
  });

  it("rejects invalid library addresses", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });

    expectHardhatError(
      () => linkQrlBytecode(artifact, { MathLib: "0x1234" }),
      ERRORS.NETWORK.LINKING_INVALID_ADDRESS
    );
  });

  it("rejects link references that do not point at a placeholder", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });
    // Corrupt the placeholder marker.
    const corrupted: Artifact = {
      ...artifact,
      bytecode: artifact.bytecode.replace("__$", "000"),
    };

    expectHardhatError(
      () => linkQrlBytecode(corrupted, { MathLib: LIBRARY_ADDRESS }),
      ERRORS.NETWORK.LINKING_PLACEHOLDER_MISMATCH
    );
  });

  it("blocks deployment of bytecode with unresolved placeholders", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });

    expectHardhatError(
      () => assertDeployableBytecode(artifact, artifact.bytecode),
      ERRORS.NETWORK.UNLINKED_BYTECODE
    );
  });

  it("accepts fully linked bytecode for deployment", function () {
    const artifact = makeArtifact({
      placeholders: [
        {
          sourceName: "contracts/MathLib.hyp",
          libraryName: "MathLib",
          seed: "a",
        },
      ],
    });
    const linked = linkQrlBytecode(artifact, { MathLib: LIBRARY_ADDRESS });

    assertDeployableBytecode(artifact, linked);
  });

  it("accepts bytecode without link references untouched", function () {
    const artifact: Artifact = {
      contractName: "Plain",
      abi: [],
      bytecode: "0x60806040",
      deployedBytecode: "0x",
      linkReferences: {},
      deployedLinkReferences: {},
    };

    assert.deepEqual(getNeededLibraryNames(artifact), []);
    assertDeployableBytecode(artifact, artifact.bytecode);
  });
});
