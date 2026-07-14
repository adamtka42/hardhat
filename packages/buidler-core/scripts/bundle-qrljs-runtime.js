#!/usr/bin/env node
// Bundles the qrljs runtime (vm, util, tx) from a locally built
// qrljs-monorepo checkout into a self-contained CJS file shipped inside the
// packed @theqrl/hardhat artifact. This is the interim distribution channel
// until the @theqrl/* runtime packages are published to a registry.
//
// Usage: node scripts/bundle-qrljs-runtime.js [qrljs-checkout-path]
// The path defaults to the QRLJS_MONOREPO_PATH environment variable.

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const semver = require("semver");

const ENTRIES = {
  vm: "packages/vm/dist/cjs/index.js",
  util: "packages/util/dist/cjs/index.js",
  tx: "packages/tx/dist/cjs/index.js",
};

// Generated artifacts. Cleanup removes ONLY these names — never the whole
// output directory, whatever it is.
const GENERATED_FILES = [
  "runtime.cjs",
  "manifest.json",
  "THIRD_PARTY_LICENSES",
];

function fail(message) {
  throw new Error(`bundle-qrljs-runtime: ${message}`);
}

/**
 * Bundles the runtime from `checkoutArg` into `outDir`. Throws on failure.
 * The CLI entry below fixes outDir to <package root>/qrljs-runtime; tests
 * call this function directly with a temporary directory — there is
 * deliberately NO environment-variable control of the output location.
 */
function bundleQrlJsRuntime(checkoutArg, outDir) {
  if (checkoutArg === undefined) {
    fail(
      "no qrljs checkout given. Pass a path or set QRLJS_MONOREPO_PATH to a built qrljs-monorepo."
    );
  }
  // realpath keeps the artifact byte-identical when the checkout is reached
  // through a symlink (esbuild canonicalizes resolved imports itself).
  const checkout = fs.realpathSync(path.resolve(checkoutArg));

  for (const entry of Object.values(ENTRIES)) {
    if (!fs.existsSync(path.join(checkout, entry))) {
      fail(
        `${entry} not found under ${checkout}. Build qrljs-monorepo first (npm run build --workspaces).`
      );
    }
  }

  const esbuild = resolveEsbuild(checkout);
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of GENERATED_FILES) {
    fs.rmSync(path.join(outDir, name), { force: true });
  }

  // One synthetic entry produces ONE bundle so vm, util, and tx share a
  // single inlined copy of every dependency. Separate bundles would each
  // carry their own @theqrl/util and break instanceof checks across the
  // module boundary (dual-package hazard). The entry is fed through stdin
  // with checkout-relative imports and absWorkingDir=checkout, so the path
  // comments esbuild writes into the bundle are relative — the same commit
  // produces a byte-identical artifact regardless of checkout location.
  const entrySource = `module.exports = {\n${Object.entries(ENTRIES)
    .map(([name, entry]) => `  ${name}: require(${JSON.stringify(`./${entry}`)}),`)
    .join("\n")}\n};\n`;

  const result = esbuild.buildSync({
    stdin: {
      contents: entrySource,
      resolveDir: checkout,
      sourcefile: "qrljs-runtime-entry.js",
      loader: "js",
    },
    absWorkingDir: checkout,
    outfile: path.join(outDir, "runtime.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    keepNames: true,
    logLevel: "warning",
    metafile: true,
  });
  if (result.errors.length > 0) {
    fail(`esbuild failed: ${JSON.stringify(result.errors)}`);
  }

  // The metafile lists every file that actually ended up inside the bundle;
  // packages and licenses are derived from it instead of a manual list.
  const bundledPackages = collectBundledPackages(result.metafile, checkout);

  enforceCompatibilityRange(bundledPackages);
  writeManifest(outDir, checkout, esbuild, bundledPackages);
  writeLicenses(outDir, bundledPackages);
  smokeTest(outDir);
  assertOnlyGeneratedFiles(outDir);

  // Logging is the CLI's job — in-process callers (tests) stay silent.
  return {
    checkout,
    outDir,
    packageCount: Object.keys(bundledPackages).length,
  };
}

function resolveEsbuild(checkout) {
  // Prefer the version pinned in hardhat's own devDependencies; fall back to
  // the qrljs checkout (which the bundling process requires anyway).
  const candidates = [
    () => require("esbuild"),
    () => require(require.resolve("esbuild", { paths: [checkout] })),
  ];
  for (const candidate of candidates) {
    try {
      return candidate();
    } catch {
      // Try the next location.
    }
  }
  return fail(
    `esbuild not found in hardhat or in ${checkout}/node_modules. Install dev dependencies first.`
  );
}

// Maps every input file recorded by esbuild to its owning package and reads
// that package's name, version, license id, and license text.
function collectBundledPackages(metafile, checkout) {
  const packages = {};

  for (const inputPath of Object.keys(metafile.inputs)) {
    // The stdin pseudo-entry owns no package; metafile paths are relative
    // to absWorkingDir (the checkout).
    if (inputPath.includes("<stdin>") || inputPath.includes("qrljs-runtime-entry")) {
      continue;
    }
    const absolutePath = path.resolve(checkout, inputPath);

    const owner = findOwningPackage(absolutePath);
    if (owner === undefined) {
      fail(`cannot locate the package owning bundled file ${absolutePath}`);
    }

    if (packages[owner.dir] !== undefined) {
      continue;
    }

    const licenseText = readLicenseText(owner.dir);
    if (licenseText === undefined) {
      // A release artifact must carry the real license text of everything
      // it embeds — a placeholder is not acceptable.
      fail(
        `bundled package ${owner.manifest.name}@${owner.manifest.version} (${owner.dir}) has no LICENSE file. Add the license text to the package before bundling.`
      );
    }

    packages[owner.dir] = {
      name: owner.manifest.name,
      version: owner.manifest.version,
      license: owner.manifest.license ?? "UNKNOWN",
      licenseText,
    };
  }

  return packages;
}

function findOwningPackage(filePath) {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    const manifestPath = path.join(dir, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      // Build outputs often carry a stub {"type": "commonjs"} package.json;
      // the owning package is the closest manifest with a name.
      if (manifest.name !== undefined) {
        return { dir, manifest };
      }
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

function readLicenseText(packageDir) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"]) {
    const licensePath = path.join(packageDir, name);
    if (fs.existsSync(licensePath)) {
      return fs.readFileSync(licensePath, "utf8");
    }
  }
  return undefined;
}

// The interim compatibility matrix: hardhat's package.json declares the
// supported @theqrl/vm version range; packing an out-of-range checkout fails.
function enforceCompatibilityRange(bundledPackages) {
  const hardhatManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  const range = hardhatManifest.qrljsRuntime?.vmVersionRange;
  if (range === undefined) {
    fail("package.json is missing the qrljsRuntime.vmVersionRange field");
  }

  const vm = Object.values(bundledPackages).find(
    (pkg) => pkg.name === "@theqrl/vm"
  );
  if (vm === undefined) {
    fail("the bundle does not contain @theqrl/vm");
  }

  if (!semver.satisfies(vm.version, range)) {
    fail(
      `bundled @theqrl/vm ${vm.version} does not satisfy the supported range ${range} declared in package.json`
    );
  }
}

function writeManifest(outDir, checkout, esbuild, bundledPackages) {
  let qrlJsCommit = "unknown";
  try {
    qrlJsCommit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dirty = execFileSync(
      "git",
      ["-C", checkout, "status", "--porcelain"],
      { encoding: "utf8" }
    ).trim();
    if (dirty !== "") {
      qrlJsCommit += "-dirty";
    }
  } catch {
    // A non-git checkout still produces a valid bundle.
  }

  // A LIST, not a name-keyed map: the bundle can legitimately contain the
  // same package in several versions (e.g. two @noble/hashes copies).
  // Multiple physical directories of the SAME name+version collapse into
  // one entry — the pair is what identifies bundle content.
  const seenPairs = new Set();
  const packages = Object.values(bundledPackages)
    .map((pkg) => ({ name: pkg.name, version: pkg.version }))
    .filter((pkg) => {
      const key = `${pkg.name}@${pkg.version}`;
      if (seenPairs.has(key)) {
        return false;
      }
      seenPairs.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    );

  // The content hash identifies the artifact exactly — two different dirty
  // trees can never share a manifest.
  const runtimeSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(outDir, "runtime.cjs")))
    .digest("hex");

  // No build timestamp: identical inputs must produce an identical artifact.
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(
      {
        qrlJsCommit,
        packages,
        runtimeSha256,
        esbuildVersion: esbuild.version,
      },
      undefined,
      2
    )}\n`
  );
}

function writeLicenses(outDir, bundledPackages) {
  const sections = [];
  const seen = new Set();

  const sorted = Object.values(bundledPackages).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const pkg of sorted) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    sections.push(`${key} — ${pkg.license}\n\n${pkg.licenseText}`);
  }

  fs.writeFileSync(
    path.join(outDir, "THIRD_PARTY_LICENSES"),
    sections.join(`\n${"=".repeat(72)}\n\n`)
  );
}

function smokeTest(outDir) {
  const bundlePath = path.join(outDir, "runtime.cjs");
  // In-process callers (tests) may bundle repeatedly into the same path.
  delete require.cache[require.resolve(bundlePath)];
  const { vm, util, tx } = require(bundlePath);

  // Full optional chains: a broken bundle may lack a whole module export —
  // that must fail with the message below, never a raw TypeError.
  if (vm?.qrl?.QRLLocalProvider === undefined) {
    fail("bundled vm does not export qrl.QRLLocalProvider");
  }
  if (util?.qrl?.QRLAddress === undefined) {
    fail("bundled util does not export qrl.QRLAddress");
  }
  if (tx?.qrl?.QRLDynamicFeeTransaction === undefined) {
    fail("bundled tx does not export qrl.QRLDynamicFeeTransaction");
  }
}

// package.json publishes the whole qrljs-runtime/ directory; a stale
// artifact or stray local file would silently ride into the npm tarball.
// Cleanup deliberately deletes only known names, so packing must ABORT when
// anything else is present.
function assertOnlyGeneratedFiles(outDir) {
  const extras = fs
    .readdirSync(outDir)
    .filter((name) => !GENERATED_FILES.includes(name));
  if (extras.length > 0) {
    fail(
      `unexpected files in ${outDir}: ${extras.join(
        ", "
      )}. The published directory may contain only ${GENERATED_FILES.join(
        ", "
      )} — remove the extra files and re-run.`
    );
  }
}

module.exports = { bundleQrlJsRuntime };

if (require.main === module) {
  try {
    const summary = bundleQrlJsRuntime(
      process.argv[2] ?? process.env.QRLJS_MONOREPO_PATH,
      path.join(__dirname, "..", "qrljs-runtime")
    );
    // Diagnostics go to stderr so `npm pack --json` keeps a clean stdout.
    // eslint-disable-next-line no-console
    console.error(
      `bundle-qrljs-runtime: bundled ${summary.packageCount} packages from ${summary.checkout} into ${summary.outDir}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error.message);
    process.exit(1);
  }
}
