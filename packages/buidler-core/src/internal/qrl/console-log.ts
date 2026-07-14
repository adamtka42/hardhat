import { keccak_256 } from "js-sha3";

import { decodeQrlFunctionResult, getFunctionSignature } from "./abi";
import { CONSOLE_LOG_SIGNATURES } from "./console-log-signatures";

/**
 * Address observed for contract console logging; must stay byte-identical to
 * `QRL_CONSOLE_LOG_ADDRESS` in qrljs-monorepo's `@theqrl/util` (the e2e suite
 * asserts the two constants match) and to the `CONSOLE_ADDRESS` literal in
 * the bundled `console.hyp`. The low bytes spell ASCII "qrl.console.log".
 */
export const QRL_CONSOLE_LOG_ADDRESS = `Q${"0".repeat(
  98
)}71726c2e636f6e736f6c652e6c6f67`;

// The selector map is GENERATED together with console.hyp from one type
// matrix (scripts/console-library-generator.js), so the library and the
// decoder cannot drift apart. A unit test regenerates and compares both.
const CONSOLE_LOG_TYPE_SETS: string[][] = CONSOLE_LOG_SIGNATURES.map(
  ([, types]) => types
);

// Synthetic ABI reusing the standard QRL ABI machinery: the log argument
// types double as outputs so `decodeQrlFunctionResult` can decode the call
// body, while the inputs make `getFunctionSignature` produce the canonical
// `log(...)` signature the selectors are derived from.
const CONSOLE_LOG_ABI = CONSOLE_LOG_TYPE_SETS.map((types) => ({
  type: "function",
  name: "log",
  inputs: types.map((type, index) => ({ name: `p${index}`, type })),
  outputs: types.map((type, index) => ({ name: `p${index}`, type })),
  stateMutability: "view",
}));

interface ConsoleLogEntry {
  signature: string;
  types: string[];
}

const SELECTOR_TO_ENTRY: Map<string, ConsoleLogEntry> = new Map(
  CONSOLE_LOG_ABI.map((fragment, index) => {
    const signature = getFunctionSignature(fragment);
    const selector = keccak_256(signature).slice(0, 8);
    return [selector, { signature, types: CONSOLE_LOG_TYPE_SETS[index] }];
  })
);

export function getConsoleLogSelectors(): Map<string, ConsoleLogEntry> {
  return new Map(SELECTOR_TO_ENTRY);
}

function formatConsoleLogValue(type: string, value: any): string {
  if (type === "string") {
    return String(value);
  }

  if (type === "bool") {
    return value === true ? "true" : "false";
  }

  // Integers decode to BN-like values (int256 may be negative); address,
  // bytes, and bytesN decode to their canonical string forms (checksummed
  // Q-address / 0x-hex).
  if (type.startsWith("uint") || type.startsWith("int")) {
    return value.toString(10);
  }

  return String(value);
}

/**
 * Decodes the raw calldata of a contract console log call into a printable
 * line, or returns `undefined` for unknown selectors or undecodable bodies.
 */
export function decodeQrlConsoleLog(data: Uint8Array): string | undefined {
  if (data.length < 4) {
    return undefined;
  }

  const hex = Buffer.from(data).toString("hex");
  const entry = SELECTOR_TO_ENTRY.get(hex.slice(0, 8));
  if (entry === undefined) {
    return undefined;
  }

  if (entry.types.length === 0) {
    return "";
  }

  let values: any[];
  try {
    values = decodeQrlFunctionResult(
      CONSOLE_LOG_ABI,
      entry.signature,
      `0x${hex.slice(8)}`
    );
  } catch {
    return undefined;
  }

  return values
    .map((value, index) => formatConsoleLogValue(entry.types[index], value))
    .join(" ");
}

/**
 * Decodes and prints one contract console log line. Unknown selectors are
 * surfaced as a short diagnostic instead of being silently dropped.
 * `process.stdout.write` is used so the output escapes test-runner console
 * wrappers.
 */
export function printQrlConsoleLog(data: Uint8Array): void {
  const line = decodeQrlConsoleLog(data);

  if (line === undefined) {
    const selector =
      data.length >= 4
        ? `0x${Buffer.from(data.slice(0, 4)).toString("hex")}`
        : `0x${Buffer.from(data).toString("hex")}`;
    process.stdout.write(`console.log <unknown selector ${selector}>\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}
