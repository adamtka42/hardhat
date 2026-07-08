import { assert } from "chai";

import { encodeQrlFunctionData } from "../../../src/internal/qrl/abi";
import {
  decodeQrlConsoleLog,
  getConsoleLogSelectors,
  QRL_CONSOLE_LOG_ADDRESS,
} from "../../../src/internal/qrl/console-log";

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

  it("derives a unique selector for every MVP signature", () => {
    const selectors = getConsoleLogSelectors();

    assert.equal(selectors.size, 23);
    for (const selector of selectors.keys()) {
      assert.match(selector, /^[0-9a-f]{8}$/);
    }
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
