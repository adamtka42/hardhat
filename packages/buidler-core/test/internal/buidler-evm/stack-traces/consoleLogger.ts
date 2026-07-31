import { assert } from "chai";
import * as fs from "fs";
import { keccak_256 } from "js-sha3";
import path from "path";

import {
  createQrlConsoleLogTraceListener,
  decodeQrlConsoleLog,
  getConsoleLogSelectors,
  QRL_CONSOLE_LOG_ADDRESS,
} from "../../../../src/internal/buidler-evm/stack-traces/consoleLogger";
import { CONSOLE_LOG_SIGNATURES } from "../../../../src/internal/buidler-evm/stack-traces/logger";
import { encodeQrlFunctionData } from "../../../../src/internal/qrl/abi";
import { toQrlChecksumAddress } from "../../../../src/internal/qrl/address";

function encodeConsoleCall(types: string[], args: any[]): Uint8Array {
  const abi = [
    {
      type: "function",
      name: "log",
      inputs: types.map((type, index) => ({ name: `p${index}`, type })),
      outputs: [],
      stateMutability: "view",
    },
  ];
  const signature = `log(${types.join(",")})`;
  const data = encodeQrlFunctionData(abi, signature, args);
  return Buffer.from(data.slice(2), "hex");
}

describe("QRL console log decoding", () => {
  const senderAddress = `Q${"a".repeat(128)}`;

  it("uses the canonical console address", () => {
    assert.equal(QRL_CONSOLE_LOG_ADDRESS.length, 129);
    assert.match(
      QRL_CONSOLE_LOG_ADDRESS,
      /^Q0+71726c2e636f6e736f6c652e6c6f67$/
    );
    assert.equal(
      Buffer.from("71726c2e636f6e736f6c652e6c6f67", "hex").toString(),
      "qrl.console.log"
    );
  });

  it("recognizes console calls through neutral VM frame events", () => {
    const received: Uint8Array[] = [];
    const listener = createQrlConsoleLogTraceListener((input) =>
      received.push(input)
    );
    const consoleTarget = { toString: () => QRL_CONSOLE_LOG_ADDRESS };

    listener.enterFrame({
      kind: "staticcall",
      target: consoleTarget,
      input: new Uint8Array([1]),
      value: (global as any).BigInt(0),
    });
    listener.enterFrame({
      kind: "call",
      target: consoleTarget,
      input: new Uint8Array([2]),
      value: (global as any).BigInt(0),
    });
    listener.enterFrame({
      kind: "delegatecall",
      target: consoleTarget,
      input: new Uint8Array([3]),
      value: (global as any).BigInt(0),
    });
    listener.enterFrame({
      kind: "call",
      target: consoleTarget,
      input: new Uint8Array([4]),
      value: (global as any).BigInt(1),
    });

    assert.deepEqual(received, [new Uint8Array([1]), new Uint8Array([2])]);
  });

  it("derives a unique selector for every generated signature", () => {
    const selectors = getConsoleLogSelectors();

    // 1 empty + 38 singles (int256, uint256, string, bool, address, bytes,
    // bytes1..32) + 4^2 + 4^3 + 4^4 combinations = 375 unique signatures.
    assert.equal(selectors.size, 375);
    for (const selector of selectors.keys()) {
      assert.match(selector, /^[0-9a-f]{8}$/);
    }
  });

  it("matches the artifacts committed by the console library generator", () => {
    // Anti-drift guard: console.hyp and logger.ts must be
    // exactly what the current generator produces from its type matrix.
    // tslint:disable-next-line: no-var-requires
    const { generateConsoleLibrary } = require(path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "console-library-generator.js"
    ));
    const generated = generateConsoleLibrary();

    const packageRoot = path.join(__dirname, "..", "..", "..", "..");
    const committedHyp = fs.readFileSync(
      path.join(packageRoot, "console.hyp"),
      "utf8"
    );
    const committedSignatures = fs.readFileSync(
      path.join(
        packageRoot,
        "src",
        "internal",
        "buidler-evm",
        "stack-traces",
        "logger.ts"
      ),
      "utf8"
    );

    assert.equal(committedHyp, generated.consoleHyp);
    assert.equal(committedSignatures, generated.signaturesTs);
  });

  it("stores selectors that match their recomputed signatures", () => {
    for (const [selector, types] of CONSOLE_LOG_SIGNATURES) {
      const signature = `log(${types.join(",")})`;
      assert.equal(
        selector,
        keccak_256(signature).slice(0, 8),
        `selector mismatch for ${signature}`
      );
    }
  });

  it("decodes int256 logs including negative values", () => {
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["int256"], [-42])),
      "-42"
    );
  });

  it("decodes fixed-bytes logs of arbitrary width", () => {
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["bytes7"], ["0x01020304050607"])),
      "0x01020304050607"
    );
  });

  it("decodes three- and four-argument logs", () => {
    assert.equal(
      decodeQrlConsoleLog(
        encodeConsoleCall(["string", "uint256", "bool"], ["total", 7, true])
      ),
      "total 7 true"
    );

    assert.equal(
      decodeQrlConsoleLog(
        encodeConsoleCall(
          ["uint256", "uint256", "uint256", "uint256"],
          [1, 2, 3, 4]
        )
      ),
      "1 2 3 4"
    );

    assert.equal(
      decodeQrlConsoleLog(
        encodeConsoleCall(
          ["string", "address", "uint256", "uint256"],
          ["balance", senderAddress, 100, 250]
        )
      ),
      `balance ${toQrlChecksumAddress(senderAddress)} 100 250`
    );
  });

  it("decodes zero-argument logs to an empty line", () => {
    assert.equal(decodeQrlConsoleLog(encodeConsoleCall([], [])), "");
  });

  it("decodes string logs", () => {
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["string"], ["hello qrl"])),
      "hello qrl"
    );
  });

  it("decodes uint256 logs as decimal", () => {
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["uint256"], [123456])),
      "123456"
    );
  });

  it("decodes bool logs", () => {
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["bool"], [true])),
      "true"
    );
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["bool"], [false])),
      "false"
    );
  });

  it("decodes address logs as checksummed QRL addresses", () => {
    const line = decodeQrlConsoleLog(
      encodeConsoleCall(["address"], [senderAddress])
    );

    assert.isString(line);
    assert.match(line!, /^Q[0-9a-fA-F]{128}$/);
    assert.equal(line!.toLowerCase(), senderAddress.toLowerCase());
  });

  it("decodes bytes and bytes32 logs as hex", () => {
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["bytes"], ["0x123456"])),
      "0x123456"
    );
    const word = `0x${"11".repeat(32)}`;
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["bytes32"], [word])),
      word
    );
  });

  it("decodes two-argument logs joined with a space", () => {
    assert.equal(
      decodeQrlConsoleLog(
        encodeConsoleCall(["string", "uint256"], ["amount", 42])
      ),
      "amount 42"
    );
    assert.equal(
      decodeQrlConsoleLog(encodeConsoleCall(["uint256", "bool"], [7, true])),
      "7 true"
    );
  });

  it("returns undefined for unknown selectors", () => {
    assert.isUndefined(
      decodeQrlConsoleLog(Buffer.from(`deadbeef${"00".repeat(64)}`, "hex"))
    );
    assert.isUndefined(decodeQrlConsoleLog(Buffer.from("00", "hex")));
  });

  it("returns undefined for a truncated body", () => {
    const valid = encodeConsoleCall(["uint256"], [42]);
    assert.isUndefined(decodeQrlConsoleLog(valid.slice(0, valid.length - 8)));
  });
});
