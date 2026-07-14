import BN from "bn.js";
import { assert } from "chai";

import { ERRORS } from "../../../src/internal/core/errors-list";
import {
  decodeQrlEventLog,
  decodeQrlFunctionResult,
  encodeQrlFunctionData,
} from "../../../src/internal/qrl/abi";
import { expectHardhatError } from "../../helpers/errors";

const WORD_HEX = 128;

function word(value: number): string {
  return new BN(value).toString(16).padStart(WORD_HEX, "0");
}

// Round-trip helpers built on the public API: encode arguments through a
// function fragment, then decode the same payload back through an identical
// outputs fragment. This exercises encoder and decoder symmetrically.
function makeAbi(inputs: any[]): any[] {
  return [
    {
      type: "function",
      name: "probe",
      inputs,
      outputs: inputs,
      stateMutability: "view",
    },
  ];
}

function roundTrip(inputs: any[], args: any[]): any[] {
  const abi = makeAbi(inputs);
  const encoded = encodeQrlFunctionData(abi, "probe", args);
  // Strip the 4-byte selector; outputs decode from the bare parameter data.
  return decodeQrlFunctionResult(abi, "probe", `0x${encoded.slice(10)}`);
}

const CONFIG_COMPONENTS = [
  { name: "threshold", type: "uint256" },
  { name: "active", type: "bool" },
];

describe("QRL ABI tuple codec", () => {
  it("round-trips a static tuple with named and positional values", () => {
    const inputs = [
      { name: "config", type: "tuple", components: CONFIG_COMPONENTS },
    ];

    for (const value of [{ threshold: 5, active: true }, [5, true]]) {
      const [decoded] = roundTrip(inputs, [value]);
      assert.equal(decoded[0].toString(), "5");
      assert.equal(decoded[1], true);
      assert.equal(decoded.threshold.toString(), "5");
      assert.equal(decoded.active, true);
    }
  });

  it("encodes a static tuple inline (no offset indirection)", () => {
    const inputs = [
      { name: "config", type: "tuple", components: CONFIG_COMPONENTS },
    ];
    const encoded = encodeQrlFunctionData(makeAbi(inputs), "probe", [
      { threshold: 5, active: true },
    ]);

    assert.equal(encoded.slice(10), `${word(5)}${word(1)}`);
  });

  it("round-trips a dynamic tuple (string component) via offsets", () => {
    const inputs = [
      {
        name: "labeled",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "label", type: "string" },
        ],
      },
    ];

    const [decoded] = roundTrip(inputs, [{ id: 7, label: "hello tuple" }]);
    assert.equal(decoded.id.toString(), "7");
    assert.equal(decoded.label, "hello tuple");
  });

  it("round-trips nested tuples", () => {
    const inputs = [
      {
        name: "outer",
        type: "tuple",
        components: [
          { name: "inner", type: "tuple", components: CONFIG_COMPONENTS },
          { name: "note", type: "string" },
        ],
      },
    ];

    const [decoded] = roundTrip(inputs, [
      { inner: { threshold: 9, active: false }, note: "nested" },
    ]);
    assert.equal(decoded.inner.threshold.toString(), "9");
    assert.equal(decoded.inner.active, false);
    assert.equal(decoded.note, "nested");
  });

  it("round-trips a dynamic array of static tuples", () => {
    const inputs = [
      { name: "history", type: "tuple[]", components: CONFIG_COMPONENTS },
    ];

    const [decoded] = roundTrip(inputs, [
      [
        { threshold: 1, active: true },
        { threshold: 2, active: false },
      ],
    ]);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].threshold.toString(), "1");
    assert.equal(decoded[0].active, true);
    assert.equal(decoded[1].threshold.toString(), "2");
    assert.equal(decoded[1].active, false);
  });

  it("round-trips an empty dynamic array of tuples", () => {
    const inputs = [
      { name: "history", type: "tuple[]", components: CONFIG_COMPONENTS },
    ];

    const [decoded] = roundTrip(inputs, [[]]);
    assert.deepEqual(decoded, []);
  });

  it("round-trips a dynamic array of dynamic tuples", () => {
    const inputs = [
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "label", type: "string" },
        ],
      },
    ];

    const [decoded] = roundTrip(inputs, [
      [
        { id: 1, label: "first" },
        { id: 2, label: "second entry with a longer label" },
      ],
    ]);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].label, "first");
    assert.equal(decoded[1].label, "second entry with a longer label");
  });

  it("round-trips a fixed-size array of static tuples", () => {
    const inputs = [
      { name: "pair", type: "tuple[2]", components: CONFIG_COMPONENTS },
    ];

    const [decoded] = roundTrip(inputs, [
      [
        { threshold: 3, active: false },
        { threshold: 4, active: true },
      ],
    ]);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].threshold.toString(), "3");
    assert.equal(decoded[1].threshold.toString(), "4");
  });

  it("round-trips a tuple alongside scalar parameters", () => {
    const inputs = [
      { name: "before", type: "uint256" },
      { name: "config", type: "tuple", components: CONFIG_COMPONENTS },
      { name: "after", type: "string" },
    ];

    const [before, config, after] = roundTrip(inputs, [
      42,
      { threshold: 5, active: true },
      "trailing",
    ]);
    assert.equal(before.toString(), "42");
    assert.equal(config.threshold.toString(), "5");
    assert.equal(after, "trailing");
  });

  it("accepts full signatures with tuple types for overload resolution", () => {
    const abi = makeAbi([
      { name: "config", type: "tuple", components: CONFIG_COMPONENTS },
    ]);

    // Signature-derived component types carry no names, so values must be
    // positional.
    const encoded = encodeQrlFunctionData(abi, "probe((uint256,bool))", [
      [5, true],
    ]);
    assert.equal(encoded.slice(10), `${word(5)}${word(1)}`);
  });

  it("rejects fixed-size arrays of dynamic elements with a wrong length", () => {
    // string[2]
    const stringPair = makeAbi([{ name: "pair", type: "string[2]" }]);
    for (const wrong of [[], ["a"], ["a", "b", "c"]]) {
      expectHardhatError(
        () => encodeQrlFunctionData(stringPair, "probe", [wrong]),
        ERRORS.NETWORK.INVALID_QRL_ABI,
        /must be an array with 2 elements/
      );
    }
    // The legal length still encodes.
    encodeQrlFunctionData(stringPair, "probe", [["a", "b"]]);

    // dynamic tuple[2]
    const tuplePair = makeAbi([
      {
        name: "pair",
        type: "tuple[2]",
        components: [
          { name: "id", type: "uint256" },
          { name: "label", type: "string" },
        ],
      },
    ]);
    for (const wrong of [[], [{ id: 1, label: "x" }]]) {
      expectHardhatError(
        () => encodeQrlFunctionData(tuplePair, "probe", [wrong]),
        ERRORS.NETWORK.INVALID_QRL_ABI,
        /must be an array with 2 elements/
      );
    }
    encodeQrlFunctionData(tuplePair, "probe", [
      [
        { id: 1, label: "x" },
        { id: 2, label: "y" },
      ],
    ]);
  });

  it("encodes a dynamic tuple to an independently constructed byte vector", () => {
    // (uint256 id, string label) with id=7, label="hi" — layout derived by
    // hand from the ABI rules (64-byte words), NOT by running the codec:
    //   param head:  offset 64 to the tuple
    //   tuple head:  word(7), offset 128 to the string tail
    //   tuple tail:  word(2 = strlen), "hi" right-padded
    const abi = makeAbi([
      {
        name: "labeled",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "label", type: "string" },
        ],
      },
    ]);

    const expected =
      word(64) + // offset to the dynamic tuple
      word(7) + // id
      word(128) + // offset of "label" relative to the tuple start
      word(2) + // string byte length
      "6869".padEnd(128, "0"); // "hi" right-padded to one word

    const encoded = encodeQrlFunctionData(abi, "probe", [
      { id: 7, label: "hi" },
    ]);
    assert.equal(encoded.slice(10), expected);

    // And the decoder reads the hand-built vector back.
    const [decoded] = decodeQrlFunctionResult(abi, "probe", `0x${expected}`);
    assert.equal(decoded.id.toString(), "7");
    assert.equal(decoded.label, "hi");
  });

  it("rejects tuple values with missing components", () => {
    const abi = makeAbi([
      { name: "config", type: "tuple", components: CONFIG_COMPONENTS },
    ]);

    expectHardhatError(
      () => encodeQrlFunctionData(abi, "probe", [{ threshold: 5 }]),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      /missing the "active" component/
    );

    expectHardhatError(
      () => encodeQrlFunctionData(abi, "probe", [[5]]),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      /must have 2 elements/
    );
  });

  it("keeps colliding component names positional-only", () => {
    const inputs = [
      {
        name: "weird",
        type: "tuple",
        components: [
          { name: "length", type: "uint256" },
          { name: "value", type: "uint256" },
        ],
      },
    ];

    const [decoded] = roundTrip(inputs, [[7, 8]]);
    // Array length must stay intact; the "length" component is reachable
    // positionally.
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].toString(), "7");
    assert.equal(decoded.value.toString(), "8");
  });
});

describe("QRL ABI anonymous events", () => {
  const ANONYMOUS_ABI = [
    {
      type: "event",
      name: "Ping",
      anonymous: true,
      inputs: [
        { name: "sender", type: "uint256", indexed: true },
        { name: "amount", type: "uint256", indexed: false },
      ],
    },
    {
      type: "event",
      name: "Pong",
      anonymous: false,
      inputs: [{ name: "amount", type: "uint256", indexed: false }],
    },
  ];

  it("decodes an anonymous event by explicit name (no signature topic)", () => {
    const decoded = decodeQrlEventLog(ANONYMOUS_ABI, "Ping", {
      topics: [`0x${word(11)}`],
      data: `0x${word(22)}`,
    });

    assert.equal(decoded.eventName, "Ping");
    assert.equal(decoded.args.sender.toString(), "11");
    assert.equal(decoded.args.amount.toString(), "22");
  });

  it("rejects anonymous logs with a wrong topic count", () => {
    expectHardhatError(
      () =>
        decodeQrlEventLog(ANONYMOUS_ABI, "Ping", {
          topics: [`0x${word(1)}`, `0x${word(2)}`],
          data: `0x${word(22)}`,
        }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      /indexed topics/
    );
  });

  it("still validates the signature topic of named events", () => {
    expectHardhatError(
      () =>
        decodeQrlEventLog(ANONYMOUS_ABI, "Pong", {
          topics: [`0x${word(123)}`],
          data: `0x${word(22)}`,
        }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      /does not match event Pong/
    );
  });

  it("returns the raw topic for indexed tuple values", () => {
    const abi = [
      {
        type: "event",
        name: "Configured",
        anonymous: false,
        inputs: [
          {
            name: "config",
            type: "tuple",
            indexed: true,
            components: CONFIG_COMPONENTS,
          },
        ],
      },
    ];
    const topicZero = eventTopic("Configured((uint256,bool))");
    const hashTopic = word(999);

    const decoded = decodeQrlEventLog(abi, "Configured", {
      topics: [`0x${topicZero}`, `0x${hashTopic}`],
      data: "0x",
    });

    assert.equal(decoded.args.config, `0x${hashTopic}`);
  });
});

function eventTopic(signature: string): string {
  // tslint:disable-next-line: no-var-requires
  const { keccak_256 } = require("js-sha3");
  return `${keccak_256(signature)}`.padEnd(WORD_HEX, "0");
}
