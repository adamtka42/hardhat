#!/usr/bin/env node
// Generates the QRL contract console API from ONE type matrix:
//   - console.hyp                                  (the Hyperion library)
//   - src/internal/buidler-evm/stack-traces/logger.ts (decoder metadata)
// Adapted from upstream Hardhat's scripts/console-library-generator.js.
// Both artifacts always come from the same run, so the library and the
// decoder cannot drift apart; a unit test regenerates and compares.
//
// Usage: node scripts/console-library-generator.js

const fs = require("fs");
const path = require("path");
const { keccak_256 } = require("js-sha3");

// The console address observed by hardhatqrlvm; low bytes spell
// "qrl.console.log". Must stay byte-identical to QRL_CONSOLE_LOG_ADDRESS in
// src/internal/buidler-evm/stack-traces/consoleLogger.ts and in
// qrljs-monorepo's @theqrl/util.
const CONSOLE_ADDRESS = `Q${"0".repeat(98)}71726c2e636f6e736f6c652e6c6f67`;

const MAX_FIXED_BYTES = 32;

// Single-argument types: every one gets BOTH a log(<type>) overload and a
// named helper (logInt, logUint, logBytes7, ...).
function singleTypes() {
  const types = [
    { hyp: "int256", canonical: "int256", helper: "Int" },
    { hyp: "uint256", canonical: "uint256", helper: "Uint" },
    { hyp: "string memory", canonical: "string", helper: "String" },
    { hyp: "bool", canonical: "bool", helper: "Bool" },
    { hyp: "address", canonical: "address", helper: "Address" },
    { hyp: "bytes memory", canonical: "bytes", helper: "Bytes" },
  ];

  for (let size = 1; size <= MAX_FIXED_BYTES; size++) {
    types.push({
      hyp: `bytes${size}`,
      canonical: `bytes${size}`,
      helper: `Bytes${size}`,
    });
  }

  return types;
}

// Types participating in 2..4-argument combinations (same matrix as the
// ETH baseline).
const COMBINATION_TYPES = [
  { hyp: "uint256", canonical: "uint256" },
  { hyp: "string memory", canonical: "string" },
  { hyp: "bool", canonical: "bool" },
  { hyp: "address", canonical: "address" },
];

const MAX_PARAMETERS = 4;

function generateFunction(name, params) {
  const signature = `log(${params.map((p) => p.canonical).join(",")})`;
  const args = params.map((_, index) => `p${index}`);
  const inputList = params
    .map((param, index) => `${param.hyp} p${index}`)
    .join(", ");
  const callArgs = args.length > 0 ? `, ${args.join(", ")}` : "";

  return (
    `    function ${name}(${inputList}) internal view {\n` +
    `        (bool ignored, ) = CONSOLE_ADDRESS.staticcall(\n` +
    `            abi.encodeWithSignature("${signature}"${callArgs})\n` +
    `        );\n` +
    `        ignored;\n` +
    `    }\n`
  );
}

function generateConsoleLibrary() {
  const singles = singleTypes();

  // Deduplicated selector map: signature -> canonical type list. log(...)
  // overloads and named helpers share signatures deliberately (a helper
  // encodes the same log(<types>) signature).
  const typeSetsBySignature = new Map();
  const addSignature = (params) => {
    const signature = `log(${params.map((p) => p.canonical).join(",")})`;
    if (!typeSetsBySignature.has(signature)) {
      typeSetsBySignature.set(
        signature,
        params.map((p) => p.canonical)
      );
    }
  };

  const functions = [];

  // log()
  functions.push(generateFunction("log", []));
  addSignature([]);

  // Named helpers: logInt(int256), ..., logBytes32(bytes32).
  for (const type of singles) {
    functions.push(generateFunction(`log${type.helper}`, [type]));
    addSignature([type]);
  }

  // Single-argument log(<type>) overloads — only for types that cannot make
  // overload resolution ambiguous. int256 would clash with uint256 on
  // number literals; bytes1..31 widen implicitly into each other and into
  // bytes32; and STRING LITERALS convert to bytes/bytes32 too, so
  // log("hello") would be ambiguous if log(bytes)/log(bytes32) overloads
  // existed. All of those are reachable through their named helpers
  // (logInt, logBytes, logBytes32, ...) — the same rule as the ETH
  // baseline, whose log() overloads covered exactly uint/string/bool/
  // address. The log(bytes)/log(bytes32) SIGNATURES stay in the decoder
  // metadata because the named helpers encode them.
  const overloadSafeSingles = singles.filter((type) =>
    ["uint256", "string", "bool", "address"].includes(type.canonical)
  );
  for (const type of overloadSafeSingles) {
    functions.push(generateFunction("log", [type]));
  }

  // 2..4-argument combinations over the combination matrix.
  for (let arity = 2; arity <= MAX_PARAMETERS; arity++) {
    const total = Math.pow(COMBINATION_TYPES.length, arity);
    for (let index = 0; index < total; index++) {
      const params = [];
      for (let position = 0; position < arity; position++) {
        const divider = Math.pow(
          COMBINATION_TYPES.length,
          arity - position - 1
        );
        params.push(
          COMBINATION_TYPES[
            Math.floor(index / divider) % COMBINATION_TYPES.length
          ]
        );
      }
      functions.push(generateFunction("log", params));
      addSignature(params);
    }
  }

  const consoleHyp =
    `// SPDX-License-Identifier: MIT\n` +
    `// Development-only contract console logging for QRL Hardhat.\n` +
    `//\n` +
    `// AUTOGENERATED by scripts/console-library-generator.js — do not edit\n` +
    `// by hand; regenerate instead. The decoder metadata in\n` +
    `// src/internal/buidler-evm/stack-traces/logger.ts comes from the same run.\n` +
    `//\n` +
    `// Usage: import "@theqrl/hardhat/console.hyp"; then call console.log(...)\n` +
    `// inside contract functions (view or state-changing; not pure). On\n` +
    `// hardhatqrlvm the logs are decoded and printed by Hardhat. On real networks\n` +
    `// the calls silently succeed (the console address has no code), so\n` +
    `// contracts behave identically everywhere; only local output differs.\n` +
    `pragma hyperion >=0.0;\n` +
    `\n` +
    `library console {\n` +
    `    address constant CONSOLE_ADDRESS =\n` +
    `        ${CONSOLE_ADDRESS};\n` +
    `\n` +
    `${functions.join("\n")}}\n`;

  const entries = [...typeSetsBySignature.entries()].map(
    ([signature, types]) => {
      const selector = keccak_256(signature).slice(0, 8);
      const list = types.map((type) => `"${type}"`).join(", ");
      return `  ["${selector}", [${list}]],`;
    }
  );

  const signaturesTs =
    `// AUTOGENERATED by scripts/console-library-generator.js — do not edit\n` +
    `// by hand; regenerate instead. console.hyp comes from the same run, so\n` +
    `// the library and this decoder metadata cannot drift apart.\n` +
    `// tslint:disable\n` +
    `\n` +
    `/** Selector (8 hex chars) -> canonical argument types of log(...). */\n` +
    `export const CONSOLE_LOG_SIGNATURES: ReadonlyArray<\n` +
    `  [string, string[]]\n` +
    `> = [\n` +
    `${entries.join("\n")}\n` +
    `];\n`;

  return { consoleHyp, signaturesTs };
}

module.exports = { generateConsoleLibrary };

if (require.main === module) {
  const { consoleHyp, signaturesTs } = generateConsoleLibrary();
  const packageRoot = path.join(__dirname, "..");

  fs.writeFileSync(path.join(packageRoot, "console.hyp"), consoleHyp);
  fs.writeFileSync(
    path.join(
      packageRoot,
      "src",
      "internal",
      "buidler-evm",
      "stack-traces",
      "logger.ts"
    ),
    signaturesTs
  );

  // eslint-disable-next-line no-console
  console.error(
    `console-library-generator: wrote console.hyp and logger.ts`
  );
}
