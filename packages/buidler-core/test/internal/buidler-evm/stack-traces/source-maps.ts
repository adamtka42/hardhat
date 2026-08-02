import { assert } from "chai";

import {
  buildQrlPcToInstruction,
  decodeQrlSourceMap,
  offsetToLine,
} from "../../../../src/internal/buidler-evm/stack-traces/source-maps";

describe("QRL source maps", function () {
  describe("decodeQrlSourceMap", function () {
    it("decodes full and inherited entries", function () {
      const locations = decodeQrlSourceMap("10:5:0:i;;20:3::o;:2:1");

      assert.deepEqual(locations, [
        { offset: 10, length: 5, sourceIndex: 0, jumpType: "i" },
        { offset: 10, length: 5, sourceIndex: 0, jumpType: "i" },
        { offset: 20, length: 3, sourceIndex: 0, jumpType: "o" },
        { offset: 20, length: 2, sourceIndex: 1, jumpType: "o" },
      ]);
    });
  });

  describe("buildQrlPcToInstruction", function () {
    it("skips Ethereum-range push data", function () {
      // PUSH1 0x2a; PUSH0; MSTORE; STOP
      const map = buildQrlPcToInstruction(
        new Uint8Array([0x60, 0x2a, 0x5f, 0x52, 0x00])
      );

      assert.deepEqual(map, [0, -1, 1, 2, 3]);
    });

    it("skips the QRL PUSH33-64 range used by 64-byte addresses", function () {
      // PUSH64 <64 bytes>; STOP — an Ethereum-style decoder would treat 0x9f
      // as a non-push opcode and desynchronize immediately.
      const bytecode = new Uint8Array(1 + 64 + 1);
      bytecode[0] = 0x9f;
      bytecode[65] = 0x00;

      const map = buildQrlPcToInstruction(bytecode);

      assert.equal(map[0], 0);
      assert.equal(map[65], 1);
      assert.isTrue(map.slice(1, 65).every((value) => value === -1));
    });
  });

  describe("offsetToLine", function () {
    it("converts character offsets to 1-based lines", function () {
      const source = "line one\nline two\nline three\n";

      assert.equal(offsetToLine(source, 0), 1);
      assert.equal(offsetToLine(source, 8), 1);
      assert.equal(offsetToLine(source, 9), 2);
      assert.equal(offsetToLine(source, 18), 3);
    });
  });
});
