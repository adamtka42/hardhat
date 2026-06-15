const shell = require("shelljs");

process.env.FORCE_COLOR = "3";
process.env.TS_NODE_TRANSPILE_ONLY = "true";

shell.config.fatal = true;

function getTestArgsOrDefaults() {
  const testNodeArgs = process.argv.slice(2);
  const testNodeArgsLookupStr = testNodeArgs.join(" ");

  if (!/(no-)?timeout/.test(testNodeArgsLookupStr)) {
    testNodeArgs.push('--timeout "0"');
  }

  if (!/reporter(?!-)/.test(testNodeArgsLookupStr)) {
    testNodeArgs.push('--reporter "dot"');
  }

  return testNodeArgs.length > 0 ? `-- ${testNodeArgs.join(" ")}` : "";
}

shell.exec("npm run build");
shell.exec("npm run build-test");

const testRunCommand = `npm run test ${getTestArgsOrDefaults()}`;
shell.exec(
  `npx lerna exec --scope @nomiclabs/buidler -- ${testRunCommand}`
);
