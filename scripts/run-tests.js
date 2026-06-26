const { spawnSync } = require("child_process");
const shell = require("shelljs");

process.env.FORCE_COLOR = "3";
process.env.TS_NODE_TRANSPILE_ONLY = "true";

shell.config.fatal = true;

function getTestArgsOrDefaults() {
  const testNodeArgs = process.argv.slice(2);

  if (
    !testNodeArgs.some((arg) => arg === "--timeout" || arg === "--no-timeout")
  ) {
    testNodeArgs.push("--timeout", "0");
  }

  if (!testNodeArgs.includes("--reporter")) {
    testNodeArgs.push("--reporter", "dot");
  }

  return testNodeArgs;
}

shell.exec("npm run build");
shell.exec("npm run build-test");

const spawnOptions = {
  shell: process.platform === "win32",
  stdio: "inherit",
};

const result = spawnSync(
  "npm",
  [
    "--prefix",
    "packages/buidler-core",
    "run",
    "test",
    "--",
    ...getTestArgsOrDefaults(),
  ],
  spawnOptions
);

if (result.error !== undefined) {
  console.error(result.error);
}

process.exit(result.status === null ? 1 : result.status);
