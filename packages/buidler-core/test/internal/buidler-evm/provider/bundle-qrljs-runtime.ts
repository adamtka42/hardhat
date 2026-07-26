import { assert } from "chai";
import { execFile } from "child_process";
import crypto from "crypto";
import * as fs from "fs";
import fsExtra from "fs-extra";
import path from "path";
import { promisify } from "util";

import { useTmpDir } from "../../../helpers/fs";

const execFileAsync = promisify(execFile);

// The bundler is exercised in-process through its exported function — output
// location is an explicit argument, never an environment variable (a bad
// env value must not be able to delete anything).
// tslint:disable-next-line: no-var-requires
const { bundleQrlJsRuntime } = require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "bundle-qrljs-runtime.js"
));

const FIXTURE_LICENSE = `Mozilla Public License Version 2.0 (fixture text)`;

// Negative and guard-rail tests for the release bundler, run against a tiny
// synthetic qrljs checkout so they stay fast and never touch the real
// qrljs-runtime/ output (outDir is passed explicitly to the function).
describe("bundle-qrljs-runtime guard rails", function () {
  useTmpDir("qrljs-bundler-guards");

  it("rejects a checkout whose @theqrl/vm version is out of the supported range", async function () {
    this.timeout(60000);
    const checkout = await createFixtureCheckout(this.tmpDir, "0.0.1");
    const outDir = path.join(this.tmpDir, "out");

    const result = await runBundler(checkout, outDir);
    assert.notEqual(result.code, 0);
    assert.include(result.stderr, "does not satisfy the supported range");
  });

  it("stamps dirty checkouts, hashes the artifact, and preserves licenses", async function () {
    this.timeout(60000);
    const checkout = await createFixtureCheckout(this.tmpDir, "10.1.2");
    const outDir = path.join(this.tmpDir, "out");

    const clean = await runBundler(checkout, outDir);
    assert.equal(clean.code, 0, clean.stderr);

    const cleanManifest = readManifest(outDir);
    assert.match(cleanManifest.qrlJsCommit, /^[0-9a-f]{40}$/);
    assert.deepInclude(cleanManifest.packages, {
      name: "@theqrl/vm",
      version: "10.1.2",
    });

    // The manifest hash must identify the artifact content exactly.
    const actualSha = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(outDir, "runtime.cjs")))
      .digest("hex");
    assert.equal(cleanManifest.runtimeSha256, actualSha);

    // Bundled MPL-2.0 packages must carry their license text.
    const licenses = fs.readFileSync(
      path.join(outDir, "THIRD_PARTY_LICENSES"),
      "utf8"
    );
    assert.include(licenses, "@theqrl/vm@10.1.2 — MPL-2.0");
    assert.include(licenses, FIXTURE_LICENSE);

    // A modified tree must be visibly marked.
    fs.appendFileSync(
      path.join(checkout, "packages", "vm", "dist", "cjs", "index.js"),
      "\n// local modification\n"
    );
    const dirty = await runBundler(checkout, outDir);
    assert.equal(dirty.code, 0, dirty.stderr);
    assert.match(readManifest(outDir).qrlJsCommit, /^[0-9a-f]{40}-dirty$/);
  });

  it("lists every bundled version once, deduplicating physical copies", async function () {
    this.timeout(60000);
    // fixture-dep exists in TWO versions (nested installs) and version
    // 1.0.0 exists in TWO physical directories — the manifest must list
    // {1.0.0, 2.0.0} exactly once each.
    const checkout = await createFixtureCheckout(this.tmpDir, "10.1.2", {
      nestedDep: true,
    });
    const outDir = path.join(this.tmpDir, "out");

    const result = await runBundler(checkout, outDir);
    assert.equal(result.code, 0, result.stderr);

    const entries = readManifest(outDir)
      .packages.filter((pkg: any) => pkg.name === "fixture-dep")
      .map((pkg: any) => pkg.version);
    assert.deepEqual(entries, ["1.0.0", "2.0.0"]);
  });

  it("fails the smoke test cleanly when a bundled module exports undefined", async function () {
    this.timeout(60000);
    // A missing module export must produce the descriptive bundler error,
    // never a raw TypeError from the smoke test's property access.
    const checkout = await createFixtureCheckout(this.tmpDir, "10.1.2", {
      corruptVmExport: true,
    });
    const outDir = path.join(this.tmpDir, "out");

    const result = await runBundler(checkout, outDir);
    assert.notEqual(result.code, 0);
    assert.include(
      result.stderr,
      "bundled vm does not export qrl.QRLLocalProvider"
    );
  });

  it("aborts when a bundled package carries no license text", async function () {
    this.timeout(60000);
    // A release artifact must embed the real license of everything it
    // bundles — a manifest-declared license id without the text is not
    // enough (the @theqrl/mpt case).
    const checkout = await createFixtureCheckout(this.tmpDir, "10.1.2", {
      omitLicenseFor: "tx",
    });
    const outDir = path.join(this.tmpDir, "out");

    const result = await runBundler(checkout, outDir);
    assert.notEqual(result.code, 0);
    assert.include(result.stderr, "has no LICENSE file");
    assert.include(result.stderr, "@theqrl/tx");
  });

  it("aborts when the output directory contains files it did not generate", async function () {
    this.timeout(60000);
    // package.json publishes the whole qrljs-runtime/ directory — a stray
    // sentinel file must abort the bundling (and therefore npm pack) instead
    // of silently riding into the published artifact.
    const checkout = await createFixtureCheckout(this.tmpDir, "10.1.2");
    const outDir = path.join(this.tmpDir, "out");
    fsExtra.ensureDirSync(outDir);
    fs.writeFileSync(path.join(outDir, "stray-debug.log"), "sentinel");

    const result = await runBundler(checkout, outDir);
    assert.notEqual(result.code, 0);
    assert.include(result.stderr, "unexpected files");
    assert.include(result.stderr, "stray-debug.log");

    // After removing the sentinel the same directory bundles cleanly.
    fsExtra.removeSync(path.join(outDir, "stray-debug.log"));
    const clean = await runBundler(checkout, outDir);
    assert.equal(clean.code, 0, clean.stderr);
  });

  it("produces byte-identical artifacts from two different checkout locations", async function () {
    this.timeout(60000);
    // Identical trees committed with pinned git dates yield the same commit
    // hash; the bundler must then yield identical runtime.cjs, manifest,
    // and license artifacts regardless of WHERE the checkout lives.
    const checkoutA = await createFixtureCheckout(
      path.join(this.tmpDir, "location-a"),
      "10.1.2"
    );
    const checkoutB = await createFixtureCheckout(
      path.join(this.tmpDir, "deeper", "nested", "location-b"),
      "10.1.2"
    );
    const outA = path.join(this.tmpDir, "out-a");
    const outB = path.join(this.tmpDir, "out-b");

    const resultA = await runBundler(checkoutA, outA);
    const resultB = await runBundler(checkoutB, outB);
    assert.equal(resultA.code, 0, resultA.stderr);
    assert.equal(resultB.code, 0, resultB.stderr);

    for (const artifact of [
      "runtime.cjs",
      "manifest.json",
      "THIRD_PARTY_LICENSES",
    ]) {
      assert.equal(
        sha256(path.join(outA, artifact)),
        sha256(path.join(outB, artifact)),
        `${artifact} differs between checkout locations`
      );
    }
  });
});

function sha256(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function readManifest(outDir: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")
  );
}

async function runBundler(
  checkout: string,
  outDir: string
): Promise<{ code: number; stderr: string }> {
  try {
    bundleQrlJsRuntime(checkout, outDir);
    return { code: 0, stderr: "" };
  } catch (error) {
    return { code: 1, stderr: (error as Error).message };
  }
}

async function createFixtureCheckout(
  tmpDir: string,
  vmVersion: string,
  options: {
    nestedDep?: boolean;
    omitLicenseFor?: string;
    corruptVmExport?: boolean;
  } = {}
): Promise<string> {
  const checkout = path.join(tmpDir, "fixture-checkout");

  const modules: Array<[string, string, string]> = [
    ["vm", "QRLLocalProvider", vmVersion],
    ["util", "QRLAddress", "10.1.2"],
    ["tx", "QRLDynamicFeeTransaction", "10.1.2"],
  ];

  for (const [name, exportedClass, version] of modules) {
    const packageDir = path.join(checkout, "packages", name);
    fsExtra.ensureDirSync(path.join(packageDir, "dist", "cjs"));
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: `@theqrl/${name}`,
        version,
        license: "MPL-2.0",
      })
    );
    if (options.omitLicenseFor !== name) {
      fs.writeFileSync(path.join(packageDir, "LICENSE"), FIXTURE_LICENSE);
    }
    const importDep =
      options.nestedDep === true ? `require("fixture-dep");\n` : "";
    const exportExpr =
      options.corruptVmExport === true && name === "vm"
        ? "undefined"
        : `{ qrl: { ${exportedClass}: class ${exportedClass} {} } }`;
    fs.writeFileSync(
      path.join(packageDir, "dist", "cjs", "index.js"),
      `${importDep}module.exports = ${exportExpr};\n`
    );
  }

  if (options.nestedDep === true) {
    // fixture-dep@1.0.0 in TWO physical locations (vm, util) and @2.0.0 in
    // one (tx) — exercises both version preservation and pair dedup.
    writeNestedDep(checkout, "vm", "1.0.0");
    writeNestedDep(checkout, "util", "1.0.0");
    writeNestedDep(checkout, "tx", "2.0.0");
  }

  const git = (...args: string[]) =>
    execFileAsync("git", ["-C", checkout, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@test",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@test",
        // Pinned dates keep the commit hash identical for identical trees,
        // which the reproducibility test relies on.
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      },
    });
  await git("init", "--quiet");
  await git("add", "-A");
  await git("commit", "--quiet", "-m", "fixture");

  return checkout;
}

function writeNestedDep(
  checkout: string,
  parentPackage: string,
  version: string
) {
  const depDir = path.join(
    checkout,
    "packages",
    parentPackage,
    "node_modules",
    "fixture-dep"
  );
  fsExtra.ensureDirSync(depDir);
  fs.writeFileSync(
    path.join(depDir, "package.json"),
    JSON.stringify({ name: "fixture-dep", version, license: "MIT" })
  );
  fs.writeFileSync(path.join(depDir, "LICENSE"), "MIT fixture license");
  fs.writeFileSync(
    path.join(depDir, "index.js"),
    `module.exports = { fixtureDepVersion: "${version}" };\n`
  );
}
