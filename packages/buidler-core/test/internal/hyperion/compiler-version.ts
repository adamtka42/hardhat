import { assert } from "chai";
import * as fs from "fs";
import path from "path";

import {
  CompilerFingerprint,
  getCompilerFingerprint,
  getVersionMismatchWarning,
  parseHypcVersionOutput,
} from "../../../src/internal/hyperion/compiler-version";
import { useTmpDir } from "../../helpers/fs";

// Exact output format of a local hypc build (recorded 2026-07-12).
const REAL_VERSION_OUTPUT = `hypc, the hyperion compiler commandline interface
Version: 0.2.0-ci.2026.5.21+commit.cd63ffc3.mod.Linux.g++
`;

describe("hypc version detection", function () {
  describe("parseHypcVersionOutput", function () {
    it("parses the real hypc --version format", function () {
      assert.equal(
        parseHypcVersionOutput(REAL_VERSION_OUTPUT),
        "0.2.0-ci.2026.5.21+commit.cd63ffc3.mod.Linux.g++"
      );
    });

    it("parses a plain release version", function () {
      assert.equal(
        parseHypcVersionOutput("Version: 0.2.0+commit.abcdef12"),
        "0.2.0+commit.abcdef12"
      );
    });

    it("returns undefined for malformed output", function () {
      assert.isUndefined(parseHypcVersionOutput(""));
      assert.isUndefined(parseHypcVersionOutput("hypc: command not found"));
      assert.isUndefined(parseHypcVersionOutput("Version:"));
      assert.isUndefined(
        parseHypcVersionOutput("something Version: 1.2.3 trailing words")
      );
    });
  });

  describe("getVersionMismatchWarning", function () {
    const fingerprint: CompilerFingerprint = {
      resolvedPath: "/usr/local/bin/hypc",
      longVersion: "0.2.0-ci.2026.5.21+commit.cd63ffc3.mod.Linux.g++",
      mtimeMs: 1,
      size: 2,
    };

    it('never warns for the default "local" version', function () {
      assert.isUndefined(getVersionMismatchWarning("local", fingerprint));
      assert.isUndefined(getVersionMismatchWarning("local", undefined));
    });

    it("accepts an exact or prefixed match", function () {
      assert.isUndefined(getVersionMismatchWarning("0.2.0", fingerprint));
      assert.isUndefined(
        getVersionMismatchWarning(
          "0.2.0-ci.2026.5.21+commit.cd63ffc3.mod.Linux.g++",
          fingerprint
        )
      );
      assert.isUndefined(
        getVersionMismatchWarning("0.2.0", {
          ...fingerprint,
          longVersion: "0.2.0+commit.abcdef12",
        })
      );
    });

    it("warns on a version mismatch", function () {
      const warning = getVersionMismatchWarning("0.3.0", fingerprint);
      assert.isDefined(warning);
      assert.include(warning!, "0.3.0");
      assert.include(warning!, fingerprint.longVersion!);
      assert.include(warning!, fingerprint.resolvedPath);
    });

    it("does not treat a version prefix without separator as a match", function () {
      assert.isDefined(
        getVersionMismatchWarning("0.2", {
          ...fingerprint,
          longVersion: "0.20.1+commit.abcdef12",
        })
      );
    });

    it("warns when a concrete version cannot be verified", function () {
      assert.include(
        getVersionMismatchWarning("0.2.0", undefined)!,
        "could not be detected"
      );
      assert.include(
        getVersionMismatchWarning("0.2.0", {
          resolvedPath: "/usr/local/bin/hypc",
          mtimeMs: 1,
          size: 2,
        })!,
        "could not be detected"
      );
    });
  });

  describe("getCompilerFingerprint", function () {
    useTmpDir("hypc-fingerprint");

    it("returns undefined for a missing binary", async function () {
      assert.isUndefined(
        await getCompilerFingerprint(path.join(this.tmpDir, "no-such-hypc"))
      );
    });

    it("fingerprints a binary and tracks rebuilds at the same path", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const fakeHypc = path.join(this.tmpDir, "fake-hypc");
      writeFakeHypc(fakeHypc, "0.2.0+commit.11111111");

      const first = await getCompilerFingerprint(fakeHypc);
      assert.isDefined(first);
      assert.equal(first!.longVersion, "0.2.0+commit.11111111");
      assert.equal(first!.resolvedPath, path.resolve(fakeHypc));
      assert.isAbove(first!.size, 0);

      // Same binary again: identical fingerprint (served from the memo).
      const again = await getCompilerFingerprint(fakeHypc);
      assert.deepEqual(again, first);

      // A rebuild at the same path with the SAME version string must still
      // produce a different fingerprint (mtime/size change).
      writeFakeHypc(fakeHypc, "0.2.0+commit.11111111", "  ");
      const rebuilt = await getCompilerFingerprint(fakeHypc);
      assert.equal(rebuilt!.longVersion, "0.2.0+commit.11111111");
      assert.notDeepEqual(rebuilt, first);

      // A binary swap with a new version is re-probed, not served stale.
      writeFakeHypc(fakeHypc, "0.3.0+commit.22222222");
      const swapped = await getCompilerFingerprint(fakeHypc);
      assert.equal(swapped!.longVersion, "0.3.0+commit.22222222");
    });

    it("survives a binary whose output is malformed", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const fakeHypc = path.join(this.tmpDir, "broken-hypc");
      fs.writeFileSync(fakeHypc, `#!/bin/sh\necho "not a version"\n`, {
        mode: 0o755,
      });

      const fingerprint = await getCompilerFingerprint(fakeHypc);
      assert.isDefined(fingerprint);
      assert.isUndefined(fingerprint!.longVersion);
    });
  });
});

function writeFakeHypc(
  filePath: string,
  version: string,
  padding: string = ""
) {
  fs.writeFileSync(
    filePath,
    `#!/bin/sh\necho "hypc, the hyperion compiler commandline interface"\necho "Version: ${version}"${padding}\n`,
    { mode: 0o755 }
  );
}
