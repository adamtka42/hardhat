import { assert } from "chai";
import * as fs from "fs";
import path from "path";

import {
  CompilerFingerprint,
  getCompilerFingerprint,
  getVersionMismatchWarning,
  parseHypcVersionOutput,
  resolveHypcPath,
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

  describe("resolveHypcPath", function () {
    const envVars = ["HYPERION_HYPC_PATH", "HYPC_PATH"];
    const savedEnv: Array<string | undefined> = [];

    beforeEach(function () {
      for (const name of envVars) {
        savedEnv.push(process.env[name]);
        delete process.env[name];
      }
    });

    afterEach(function () {
      for (const name of envVars) {
        const value = savedEnv.shift();
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    it("falls back to a bare hypc for PATH lookup", function () {
      assert.equal(resolveHypcPath(undefined, "/project"), "hypc");
    });

    it("resolves a relative compilerPath against the project root", function () {
      // The compiler executes with cwd = project root, so the version probe
      // must resolve relative paths the same way.
      assert.equal(
        resolveHypcPath("tools/hypc", "/project"),
        path.join("/project", "tools", "hypc")
      );
    });

    it("keeps absolute paths and resolves env fallbacks", function () {
      assert.equal(resolveHypcPath("/opt/hypc", "/project"), "/opt/hypc");

      process.env.HYPC_PATH = "bin/hypc";
      assert.equal(
        resolveHypcPath(undefined, "/project"),
        path.join("/project", "bin", "hypc")
      );
    });
  });

  describe("getVersionMismatchWarning", function () {
    const fingerprint: CompilerFingerprint = {
      source: "local",
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
          source: "local",
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
        await getCompilerFingerprint(
          path.join(this.tmpDir, "no-such-hypc"),
          this.tmpDir
        )
      );
    });

    it("fingerprints a binary and tracks rebuilds at the same path", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const fakeHypc = path.join(this.tmpDir, "fake-hypc");
      writeFakeHypc(fakeHypc, "0.2.0+commit.11111111");

      const first = await getCompilerFingerprint(fakeHypc, this.tmpDir);
      assert.isDefined(first);
      assert.equal(first!.longVersion, "0.2.0+commit.11111111");
      assert.equal(first!.resolvedPath, path.resolve(fakeHypc));
      assert.isAbove(first!.size, 0);

      // Same binary again: identical fingerprint (served from the memo).
      const again = await getCompilerFingerprint(fakeHypc, this.tmpDir);
      assert.deepEqual(again, first);

      // A rebuild at the same path with the SAME version string must still
      // produce a different fingerprint (mtime/size change).
      writeFakeHypc(fakeHypc, "0.2.0+commit.11111111", "  ");
      const rebuilt = await getCompilerFingerprint(fakeHypc, this.tmpDir);
      assert.equal(rebuilt!.longVersion, "0.2.0+commit.11111111");
      assert.notDeepEqual(rebuilt, first);

      // A binary swap with a new version is re-probed, not served stale.
      writeFakeHypc(fakeHypc, "0.3.0+commit.22222222");
      const swapped = await getCompilerFingerprint(fakeHypc, this.tmpDir);
      assert.equal(swapped!.longVersion, "0.3.0+commit.22222222");
    });

    it("fingerprints a project-relative compilerPath", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      // Reviewer repro: compilerPath = "tools/hypc" relative to the project
      // root worked for compilation (cwd) but not for the version probe.
      fs.mkdirSync(path.join(this.tmpDir, "tools"));
      const relativeHypc = path.join("tools", "hypc");
      writeFakeHypc(
        path.join(this.tmpDir, relativeHypc),
        "0.2.0+commit.33333333"
      );

      const fingerprint = await getCompilerFingerprint(
        resolveHypcPath(relativeHypc, this.tmpDir),
        this.tmpDir
      );
      assert.isDefined(fingerprint);
      assert.equal(fingerprint!.longVersion, "0.2.0+commit.33333333");
      assert.equal(
        fingerprint!.resolvedPath,
        path.join(this.tmpDir, "tools", "hypc")
      );
    });

    it("resolves relative and empty PATH entries against the project root", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      // Reviewer repro: PATH=tools with a bare `hypc` is found by execFile
      // running with cwd = project root — the fingerprint must match that.
      fs.mkdirSync(path.join(this.tmpDir, "tools"));
      writeFakeHypc(
        path.join(this.tmpDir, "tools", "hypc"),
        "0.2.0+commit.44444444"
      );
      fs.mkdirSync(path.join(this.tmpDir, "cwd-root"));
      writeFakeHypc(
        path.join(this.tmpDir, "cwd-root", "hypc"),
        "0.2.0+commit.55555555"
      );

      const previousPath = process.env.PATH;
      try {
        process.env.PATH = "tools";
        const relativeEntry = await getCompilerFingerprint("hypc", this.tmpDir);
        assert.equal(relativeEntry?.longVersion, "0.2.0+commit.44444444");
        assert.equal(
          relativeEntry?.resolvedPath,
          path.join(this.tmpDir, "tools", "hypc")
        );

        // An empty PATH entry means the working directory of the exec —
        // the project root here.
        process.env.PATH = `${path.join(this.tmpDir, "missing")}:`;
        const emptyEntry = await getCompilerFingerprint(
          "hypc",
          path.join(this.tmpDir, "cwd-root")
        );
        assert.equal(emptyEntry?.longVersion, "0.2.0+commit.55555555");
      } finally {
        process.env.PATH = previousPath;
      }
    });

    it("survives a binary whose output is malformed", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const fakeHypc = path.join(this.tmpDir, "broken-hypc");
      fs.writeFileSync(fakeHypc, `#!/bin/sh\necho "not a version"\n`, {
        mode: 0o755,
      });

      const fingerprint = await getCompilerFingerprint(fakeHypc, this.tmpDir);
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
