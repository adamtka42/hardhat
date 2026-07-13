#!/usr/bin/env node
// Bundles the qrljs runtime (vm, util, tx) from a locally built
// qrljs-monorepo checkout into self-contained CJS files shipped inside the
// packed @theqrl/hardhat artifact. This is the interim distribution channel
// until the @theqrl/* runtime packages are published to a registry.
//
// Usage: node scripts/bundle-qrljs-runtime.js [qrljs-checkout-path]
// The path defaults to the QRLJS_MONOREPO_PATH environment variable.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ENTRIES = {
  vm: "packages/vm/dist/cjs/index.js",
  util: "packages/util/dist/cjs/index.js",
  tx: "packages/tx/dist/cjs/index.js",
};

// Packages whose sources end up inside the bundles; their licenses must be
// preserved in the shipped artifact.
const BUNDLED_PACKAGES = [
  "packages/vm",
  "packages/util",
  "packages/tx",
  "packages/evm",
  "packages/block",
  "packages/statemanager",
  "packages/common",
  "packages/trie",
  "packages/rlp",
];

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`bundle-qrljs-runtime: ${message}`);
  process.exit(1);
}

function main() {
  const checkoutArg = process.argv[2] ?? process.env.QRLJS_MONOREPO_PATH;
  if (checkoutArg === undefined) {
    fail(
      "no qrljs checkout given. Pass a path or set QRLJS_MONOREPO_PATH to a built qrljs-monorepo."
    );
  }
  const checkout = path.resolve(checkoutArg);

  for (const entry of Object.values(ENTRIES)) {
    if (!fs.existsSync(path.join(checkout, entry))) {
      fail(
        `${entry} not found under ${checkout}. Build qrljs-monorepo first (npm run build --workspaces).`
      );
    }
  }

  const esbuild = resolveEsbuild(checkout);
  const outDir = path.join(__dirname, "..", "qrljs-runtime");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // One synthetic entry produces ONE bundle so vm, util, and tx share a
  // single inlined copy of every dependency. Separate bundles would each
  // carry their own @theqrl/util and break instanceof checks across the
  // module boundary (dual-package hazard).
  const entrySource = `module.exports = {\n${Object.entries(ENTRIES)
    .map(([name, entry]) => `  ${name}: require(${JSON.stringify(
      path.join(checkout, entry)
    )}),`)
    .join("\n")}\n};\n`;
  const entryFile = path.join(outDir, "entry.js");
  fs.writeFileSync(entryFile, entrySource);

  const result = esbuild.buildSync({
    entryPoints: [entryFile],
    outfile: path.join(outDir, "runtime.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    keepNames: true,
    logLevel: "warning",
  });
  fs.rmSync(entryFile);
  if (result.errors.length > 0) {
    fail(`esbuild failed: ${JSON.stringify(result.errors)}`);
  }

  writeManifest(outDir, checkout, esbuild);
  writeLicenses(outDir, checkout);
  smokeTest(outDir);

  // Diagnostics go to stderr so `npm pack --json` keeps a clean stdout.
  // eslint-disable-next-line no-console
  console.error(
    `bundle-qrljs-runtime: bundled vm, util, tx from ${checkout} into ${outDir}`
  );
}

function resolveEsbuild(checkout) {
  // The bundle inherently requires the qrljs checkout, which carries esbuild
  // as a dev tool; prefer a local install when present.
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
    `esbuild not found in hardhat or in ${checkout}/node_modules. Install qrljs dev dependencies first.`
  );
}

function writeManifest(outDir, checkout, esbuild) {
  let qrlJsCommit = "unknown";
  try {
    qrlJsCommit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // A non-git checkout still produces a valid bundle.
  }

  const packageVersions = {};
  for (const pkg of BUNDLED_PACKAGES) {
    const manifestPath = path.join(checkout, pkg, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      packageVersions[manifest.name] = manifest.version;
    }
  }

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(
      {
        qrlJsCommit,
        packageVersions,
        esbuildVersion: esbuild.version,
        builtAt: new Date().toISOString(),
      },
      undefined,
      2
    )}\n`
  );
}

function writeLicenses(outDir, checkout) {
  const sections = [];

  const rootLicense = path.join(checkout, "LICENSE");
  if (fs.existsSync(rootLicense)) {
    sections.push(
      `qrljs-monorepo (@theqrl/* packages)\n\n${fs.readFileSync(
        rootLicense,
        "utf8"
      )}`
    );
  }

  // Third-party dependencies pulled into the bundles.
  for (const dep of ["@noble/hashes"]) {
    const depDir = path.join(checkout, "node_modules", dep);
    const manifestPath = path.join(depDir, "package.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    let text = `license: ${manifest.license}`;
    for (const licenseFile of ["LICENSE", "LICENSE.md", "LICENCE"]) {
      const licensePath = path.join(depDir, licenseFile);
      if (fs.existsSync(licensePath)) {
        text = fs.readFileSync(licensePath, "utf8");
        break;
      }
    }
    sections.push(`${dep}@${manifest.version}\n\n${text}`);
  }

  fs.writeFileSync(
    path.join(outDir, "THIRD_PARTY_LICENSES"),
    sections.join(`\n${"=".repeat(72)}\n\n`)
  );
}

function smokeTest(outDir) {
  const { vm, util, tx } = require(path.join(outDir, "runtime.cjs"));

  if (vm.qrl?.QRLLocalProvider === undefined) {
    fail("bundled vm does not export qrl.QRLLocalProvider");
  }
  if (util.qrl?.QRLAddress === undefined) {
    fail("bundled util does not export qrl.QRLAddress");
  }
  if (tx.qrl?.QRLDynamicFeeTransaction === undefined) {
    fail("bundled tx does not export qrl.QRLDynamicFeeTransaction");
  }
}

main();
