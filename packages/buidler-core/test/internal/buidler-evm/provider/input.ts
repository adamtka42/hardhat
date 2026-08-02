import { assert } from "chai";
import * as t from "io-ts";

import { InvalidArgumentsError } from "../../../../src/internal/buidler-evm/provider/errors";
import {
  blockTag,
  logTopics,
  optionalBlockTag,
  optionalBoolean,
  rpcAddress,
  rpcData,
  rpcHash,
  rpcQuantity,
  rpcStorageKey,
  rpcTopic,
  rpcTransactionRequest,
  validateParams,
} from "../../../../src/internal/buidler-evm/provider/input";

const QRL_ADDRESS = `Q${"1".repeat(128)}`;
const RPC_HASH = `0x${"2".repeat(64)}`;
const RPC_TOPIC = `0x${"3".repeat(128)}`;
const bigint = (value: string | number): bigint =>
  (global as any).BigInt(value);

describe("validateParams", function () {
  describe("0-arguments", function () {
    it("Should return an empty array if no argument is given", function () {
      assert.deepEqual(validateParams([]), []);
    });

    it("Should throw if params are given", function () {
      assert.throws(() => validateParams([1]), InvalidArgumentsError);
      assert.throws(() => validateParams([1, true]), InvalidArgumentsError);
      assert.throws(() => validateParams([{}]), InvalidArgumentsError);
      assert.throws(
        () => validateParams(["ASD", 123, false]),
        InvalidArgumentsError
      );
    });
  });

  describe("With multiple params", function () {
    it("Should throw if the number of params and arguments doesn't match", function () {
      assert.throws(
        () => validateParams([1], rpcHash, rpcQuantity),
        InvalidArgumentsError
      );
      assert.throws(
        () => validateParams([1, true], rpcHash),
        InvalidArgumentsError
      );
      assert.throws(
        () => validateParams([{}], rpcQuantity, rpcQuantity),
        InvalidArgumentsError
      );
      assert.throws(
        () => validateParams(["ASD", 123, false], rpcQuantity),
        InvalidArgumentsError
      );
    });

    it("Should return the right values", function () {
      assert.deepEqual(validateParams([QRL_ADDRESS], rpcAddress), [
        Uint8Array.from(Buffer.from(QRL_ADDRESS.slice(1), "hex")),
      ]);

      assert.deepEqual(validateParams([RPC_HASH, true], rpcHash, t.boolean), [
        Uint8Array.from(Buffer.from(RPC_HASH.slice(2), "hex")),
        true,
      ]);
    });
  });

  describe("Optional params", function () {
    it("Should fail if less than the minimum number of params are received", function () {
      assert.throws(
        () => validateParams([], rpcHash, optionalBlockTag),
        InvalidArgumentsError
      );
    });

    it("Should fail if more than the maximum number of params are received", function () {
      assert.throws(
        () =>
          validateParams([RPC_HASH, "latest", 123], rpcHash, optionalBlockTag),
        InvalidArgumentsError
      );
    });

    it("Should return undefined if optional params are missing", function () {
      assert.deepEqual(validateParams([RPC_HASH], rpcHash, optionalBlockTag), [
        Uint8Array.from(Buffer.from(RPC_HASH.slice(2), "hex")),
        undefined,
      ]);

      assert.deepEqual(
        validateParams([QRL_ADDRESS], rpcAddress, optionalBlockTag),
        [Uint8Array.from(Buffer.from(QRL_ADDRESS.slice(1), "hex")), undefined]
      );
    });
  });

  describe("QRL RPC values", function () {
    it("Decodes canonical quantities and even-length data", function () {
      assert.deepEqual(validateParams(["0x2a"], rpcQuantity), [bigint(42)]);
      assert.deepEqual(validateParams(["0x002a"], rpcData), [
        new Uint8Array([0, 42]),
      ]);
    });

    it("Rejects non-canonical quantities and malformed data", function () {
      assert.throws(
        () => validateParams(["0x00"], rpcQuantity),
        InvalidArgumentsError
      );
      assert.throws(
        () => validateParams(["0x1"], rpcData),
        InvalidArgumentsError
      );
    });

    it("Uses 32-byte hashes and 64-byte QRL topics", function () {
      assert.deepEqual(validateParams([RPC_TOPIC], rpcTopic), [
        Uint8Array.from(Buffer.from(RPC_TOPIC.slice(2), "hex")),
      ]);
      assert.doesNotThrow(() => validateParams([[RPC_TOPIC]], logTopics));
      assert.throws(
        () => validateParams([RPC_HASH], rpcTopic),
        InvalidArgumentsError
      );
      assert.throws(
        () => validateParams([RPC_TOPIC], rpcHash),
        InvalidArgumentsError
      );
    });

    it("Validates block lookup params and 32-byte storage keys", function () {
      assert.deepEqual(validateParams(["latest"], blockTag, optionalBoolean), [
        "latest",
        undefined,
      ]);
      assert.deepEqual(
        validateParams(["0x2", true], blockTag, optionalBoolean),
        [bigint(2), true]
      );
      assert.deepEqual(validateParams([RPC_HASH], rpcStorageKey), [
        Uint8Array.from(Buffer.from(RPC_HASH.slice(2), "hex")),
      ]);
      assert.throws(
        () => validateParams(["0x01"], rpcStorageKey),
        InvalidArgumentsError
      );
    });

    it("Decodes QRL transaction fee and gas fields", function () {
      const [request] = validateParams(
        [
          {
            from: QRL_ADDRESS,
            to: QRL_ADDRESS,
            gas: "0x5208",
            gasLimit: "0x5208",
            gasPrice: "0x2",
            maxFeePerGas: "0x2",
            maxPriorityFeePerGas: "0x1",
            value: "0x3",
            nonce: "0x0",
            chainId: "0x1",
            data: "0x1234",
          },
        ],
        rpcTransactionRequest
      );

      assert.deepEqual(request.from, request.to);
      assert.equal(request.gas, bigint(21000));
      assert.equal(request.gasLimit, bigint(21000));
      assert.equal(request.gasPrice, bigint(2));
      assert.equal(request.maxFeePerGas, bigint(2));
      assert.equal(request.maxPriorityFeePerGas, bigint(1));
      assert.equal(request.value, bigint(3));
      assert.equal(request.nonce, bigint(0));
      assert.equal(request.chainId, bigint(1));
      assert.deepEqual(request.data, new Uint8Array([0x12, 0x34]));
    });
  });
});
