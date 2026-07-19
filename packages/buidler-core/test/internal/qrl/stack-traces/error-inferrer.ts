import { assert } from "chai";

import { buildQrlStackTraceLines } from "../../../../src/internal/qrl/stack-traces";
import { QrlDebugInfo } from "../../../../src/internal/qrl/stack-traces/debug-info";
import { QrlStackTraceDecoder } from "../../../../src/internal/qrl/stack-traces/decoder";
import { inferQrlStackTrace } from "../../../../src/internal/qrl/stack-traces/error-inferrer";
import { QrlStackTraceEntryType } from "../../../../src/internal/qrl/stack-traces/types";

const CODE = "5f5ffd";
const SOURCE = "function probe(uint256 value) public { revert(); }";

function debugInfo(overrides: any = {}): QrlDebugInfo {
  const contract = {
    sourceName: "Probe.hyp",
    contractName: "Probe",
    abi: [
      {
        type: "function",
        name: "probe",
        stateMutability: "nonpayable",
        inputs: [{ name: "value", type: "uint256" }],
        outputs: [],
      },
    ],
    contractKind: "contract",
    bytecode: CODE,
    bytecodeSourceMap: "0:50:0;0:50:0;0:50:0",
    deployedBytecode: CODE,
    deployedSourceMap: "0:50:0;0:50:0;0:50:0",
    linkReferences: {},
    deployedLinkReferences: {},
    immutableReferences: {},
    methodIdentifiers: { "probe(uint256)": "12345678" },
    ...overrides,
  };
  return {
    contracts: [contract],
    sourceContent: new Map([["Probe.hyp", SOURCE]]),
    sourceNamesByIndex: new Map([[0, "Probe.hyp"]]),
    astBySourceName: new Map([
      [
        "Probe.hyp",
        {
          nodeType: "SourceUnit",
          nodes: [
            {
              nodeType: "ContractDefinition",
              name: "Probe",
              contractKind: "contract",
              src: "0:50:0",
              nodes: [
                {
                  nodeType: "FunctionDefinition",
                  name: "probe",
                  kind: "function",
                  visibility: "public",
                  stateMutability: "nonpayable",
                  src: "0:50:0",
                },
              ],
            },
          ],
        },
      ],
    ]),
  };
}

function frame(input: number[], value: any = (global as any).BigInt(0)): any {
  return {
    kind: "call",
    depth: 0,
    input: new Uint8Array(input),
    value,
    gasLimit: (global as any).BigInt(100000),
    returnValue: new Uint8Array([1]),
    errorMessage: "revert",
    lastPc: 2,
    code: new Uint8Array([0x5f, 0x5f, 0xfd]),
    steps: [{ pc: 0 }, { pc: 1 }, { pc: 2 }],
    children: [],
  };
}

describe("QRL stack trace inference", function () {
  it("infers nonpayable calls with value", function () {
    const decoder = new QrlStackTraceDecoder(debugInfo());
    const input = [0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)];
    const call = frame(input, (global as any).BigInt(1));
    call.returnValue = new Uint8Array(0);
    const [diagnostic] = inferQrlStackTrace(call, decoder);
    assert.equal(
      diagnostic.type,
      QrlStackTraceEntryType.FUNCTION_NOT_PAYABLE_ERROR
    );
    assert.equal(diagnostic.sourceReference!.functionName, "probe");
  });

  it("infers invalid static calldata length", function () {
    const decoder = new QrlStackTraceDecoder(debugInfo());
    const [diagnostic] = inferQrlStackTrace(
      frame([0x12, 0x34, 0x56, 0x78]),
      decoder
    );
    assert.equal(diagnostic.type, QrlStackTraceEntryType.INVALID_PARAMS_ERROR);
  });

  it("infers an unknown selector without fallback", function () {
    const decoder = new QrlStackTraceDecoder(debugInfo());
    const call = frame([0xde, 0xad, 0xbe, 0xef]);
    call.returnValue = new Uint8Array(0);
    const [diagnostic] = inferQrlStackTrace(call, decoder);
    assert.equal(
      diagnostic.type,
      QrlStackTraceEntryType.UNRECOGNIZED_FUNCTION_WITHOUT_FALLBACK_ERROR
    );
  });

  it("classifies failed precompile frames", function () {
    const decoder = new QrlStackTraceDecoder(debugInfo());
    const value = frame([]);
    value.precompile = { toString: () => "Q-precompile" };
    const [diagnostic] = inferQrlStackTrace(value, decoder);
    assert.equal(diagnostic.type, QrlStackTraceEntryType.PRECOMPILE_ERROR);
    assert.equal(diagnostic.precompile, "Q-precompile");
  });

  it("matches immutable ranges and resolves identical bytecode to the last contract", function () {
    const first = debugInfo({ contractName: "First" }).contracts[0];
    const second = debugInfo({
      contractName: "Second",
      deployedBytecode: "5f0000fd",
      deployedSourceMap: "0:50:0;0:50:0;0:50:0;0:50:0",
      immutableReferences: { "1": [{ start: 1, length: 2 }] },
    }).contracts[0];
    const info = debugInfo();
    info.contracts = [first, { ...first, contractName: "Last" }, second];
    const decoder = new QrlStackTraceDecoder(info);
    assert.equal(decoder.identifyContract(CODE, false)!.contractName, "Last");
    assert.equal(
      decoder.identifyContract("5faabbfd", false)!.contractName,
      "Second"
    );

    const qrlImmutable = debugInfo({
      contractName: "QrlImmutable",
      deployedBytecode: `5f${"00".repeat(64)}fd`,
      deployedSourceMap: new Array(66).fill("0:50:0").join(";"),
      immutableReferences: { "2": [{ start: 1, length: 32 }] },
    }).contracts[0];
    const qrlDecoder = new QrlStackTraceDecoder({
      ...info,
      contracts: [qrlImmutable],
    });
    assert.equal(
      qrlDecoder.identifyContract(`5f${"00".repeat(63)}aafd`, false)!
        .contractName,
      "QrlImmutable"
    );
  });

  it("uses ordered steps to distinguish propagated and handled identical failures", function () {
    const outer = debugInfo({
      contractName: "Outer",
      deployedBytecode: "f15ffd",
      deployedSourceMap: "0:10:0;0:10:0;0:10:0",
    }).contracts[0];
    const inner = debugInfo({ contractName: "Inner" }).contracts[0];
    const info = debugInfo();
    info.contracts = [outer, inner];
    const decoder = new QrlStackTraceDecoder(info);
    const input = [0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)];
    const child = frame(input);
    child.returnValue = new Uint8Array(0);
    const root = {
      ...frame(input),
      code: new Uint8Array([0xf1, 0x5f, 0xfd]),
      returnValue: new Uint8Array(0),
      steps: [{ pc: 0 }, child, { pc: 1 }, { pc: 2 }],
      children: [child],
    };

    const propagated = inferQrlStackTrace(root, decoder);
    assert.lengthOf(propagated, 2);
    assert.equal(propagated[0].type, QrlStackTraceEntryType.REVERT_ERROR);
    assert.equal(propagated[1].type, QrlStackTraceEntryType.CALLSTACK_ENTRY);

    outer.deployedSourceMap = "0:10:0;20:10:0;20:10:0";
    const handled = inferQrlStackTrace(
      root,
      new QrlStackTraceDecoder({ ...info, contracts: [outer, inner] })
    );
    assert.lengthOf(handled, 1);
    assert.equal(handled[0].type, QrlStackTraceEntryType.REVERT_ERROR);
    assert.equal(handled[0].sourceReference!.contractName, "Outer");
  });

  it("infers constructor argument and value prelude failures", function () {
    const abi = [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [{ name: "value", type: "uint256" }],
      },
    ];
    const decoder = new QrlStackTraceDecoder(
      debugInfo({ abi, methodIdentifiers: {} })
    );
    const creation = {
      ...frame([]),
      kind: "create",
      input: new Uint8Array([0x5f, 0x5f, 0xfd]),
      code: new Uint8Array([0x5f, 0x5f, 0xfd]),
      returnValue: new Uint8Array(0),
    };

    let [diagnostic] = inferQrlStackTrace(creation, decoder);
    assert.equal(diagnostic.type, QrlStackTraceEntryType.INVALID_PARAMS_ERROR);

    creation.value = (global as any).BigInt(1);
    [diagnostic] = inferQrlStackTrace(creation, decoder);
    assert.equal(
      diagnostic.type,
      QrlStackTraceEntryType.FUNCTION_NOT_PAYABLE_ERROR
    );
  });

  it("validates dynamic calldata before classifying a body revert", function () {
    const abi = [
      {
        type: "function",
        name: "probe",
        stateMutability: "nonpayable",
        inputs: [{ name: "value", type: "string" }],
        outputs: [],
      },
    ];
    const decoder = new QrlStackTraceDecoder(
      debugInfo({
        abi,
        methodIdentifiers: { "probe(string)": "12345678" },
      })
    );
    const malformed = [0x12, 0x34, 0x56, 0x78, ...new Array(63).fill(0), 0x40];
    const [diagnostic] = inferQrlStackTrace(frame(malformed), decoder);
    assert.equal(diagnostic.type, QrlStackTraceEntryType.INVALID_PARAMS_ERROR);
  });

  it("infers returndata, non-contract, and call setup failures", function () {
    const outer = debugInfo({
      deployedBytecode: "f15ffd",
      deployedSourceMap: "0:10:0;0:10:0;0:10:0",
    }).contracts[0];
    const inner = debugInfo({ contractName: "Inner" }).contracts[0];
    const info = debugInfo();
    info.contracts = [outer, inner];
    const decoder = new QrlStackTraceDecoder(info);
    const input = [0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)];

    const successfulChild = {
      ...frame(input),
      depth: 1,
      errorMessage: undefined,
      returnValue: new Uint8Array(0),
    };
    const root = {
      ...frame(input),
      code: new Uint8Array([0xf1, 0x5f, 0xfd]),
      returnValue: new Uint8Array(0),
      steps: [{ pc: 0 }, successfulChild, { pc: 1 }, { pc: 2 }],
      children: [successfulChild],
    };
    assert.equal(
      inferQrlStackTrace(root, decoder)[0].type,
      QrlStackTraceEntryType.RETURNDATA_SIZE_ERROR
    );

    successfulChild.code = new Uint8Array(0);
    assert.equal(
      inferQrlStackTrace(root, decoder)[0].type,
      QrlStackTraceEntryType.NONCONTRACT_ACCOUNT_CALLED_ERROR
    );

    root.steps = [{ pc: 0 }, { pc: 1 }, { pc: 2 }];
    root.children = [];
    assert.equal(
      inferQrlStackTrace(root, decoder)[0].type,
      QrlStackTraceEntryType.CALL_FAILED_ERROR
    );
  });

  it("distinguishes receive and fallback without misclassifying library reverts", function () {
    const fallbackDecoder = new QrlStackTraceDecoder(
      debugInfo({
        abi: [
          { type: "receive", stateMutability: "payable" },
          { type: "fallback", stateMutability: "nonpayable" },
        ],
        methodIdentifiers: {},
      })
    );
    const emptyCall = frame([], (global as any).BigInt(1));
    emptyCall.returnValue = new Uint8Array(0);
    assert.equal(
      inferQrlStackTrace(emptyCall, fallbackDecoder)[0].type,
      QrlStackTraceEntryType.REVERT_ERROR
    );

    const dataCall = frame([0xde, 0xad, 0xbe, 0xef], (global as any).BigInt(1));
    dataCall.returnValue = new Uint8Array(0);
    assert.equal(
      inferQrlStackTrace(dataCall, fallbackDecoder)[0].type,
      QrlStackTraceEntryType.FALLBACK_NOT_PAYABLE_ERROR
    );

    const libraryDecoder = new QrlStackTraceDecoder(
      debugInfo({ contractKind: "library" })
    );
    assert.equal(
      inferQrlStackTrace(
        frame([0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)]),
        libraryDecoder
      )[0].type,
      QrlStackTraceEntryType.REVERT_ERROR
    );
  });

  it("resolves overloaded function starts by canonical signature", function () {
    const source = `function probe(uint256 value) public {}
function probe(address value) public {}`;
    const secondOffset = source.indexOf("function probe(address");
    const info = debugInfo({
      abi: [
        {
          type: "function",
          name: "probe",
          stateMutability: "nonpayable",
          inputs: [{ name: "value", type: "uint256" }],
          outputs: [],
        },
        {
          type: "function",
          name: "probe",
          stateMutability: "nonpayable",
          inputs: [{ name: "value", type: "address" }],
          outputs: [],
        },
      ],
      methodIdentifiers: {
        "probe(uint256)": "12345678",
        "probe(address)": "87654321",
      },
    });
    info.sourceContent.set("Probe.hyp", source);
    info.astBySourceName.get("Probe.hyp").nodes[0].nodes = [
      {
        nodeType: "FunctionDefinition",
        name: "probe",
        kind: "function",
        src: `0:${secondOffset - 1}:0`,
        parameters: {
          parameters: [{ typeDescriptions: { typeString: "uint256" } }],
        },
      },
      {
        nodeType: "FunctionDefinition",
        name: "probe",
        kind: "function",
        src: `${secondOffset}:${source.length - secondOffset}:0`,
        parameters: {
          parameters: [{ typeDescriptions: { typeString: "address" } }],
        },
      },
    ];

    const call = frame(
      [0x87, 0x65, 0x43, 0x21, ...new Array(64).fill(0)],
      (global as any).BigInt(1)
    );
    call.returnValue = new Uint8Array(0);
    const [diagnostic] = inferQrlStackTrace(
      call,
      new QrlStackTraceDecoder(info)
    );
    assert.equal(
      diagnostic.type,
      QrlStackTraceEntryType.FUNCTION_NOT_PAYABLE_ERROR
    );
    assert.equal(diagnostic.sourceReference!.line, 2);
  });

  it("renders inferred causes without changing plain revert lines", async function () {
    const decoder = new QrlStackTraceDecoder(debugInfo());
    const input = [0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)];
    const nonpayable = frame(input, (global as any).BigInt(7));
    nonpayable.returnValue = new Uint8Array(0);
    const inferred = await buildQrlStackTraceLines(nonpayable, decoder);
    assert.equal(
      inferred[0],
      "  Error: non-payable function was called with value 7"
    );

    const plain = await buildQrlStackTraceLines(frame(input), decoder);
    assert.notMatch(plain[0], /Error:/);
    assert.match(plain[0], /at Probe.probe/);
  });

  it("classifies unrecognized runtime and creation frames", function () {
    const decoder = new QrlStackTraceDecoder(debugInfo());
    const runtime = frame([0xde, 0xad, 0xbe, 0xef]);
    runtime.code = new Uint8Array([0xfe]);
    runtime.lastPc = 0;
    assert.equal(
      inferQrlStackTrace(runtime, decoder)[0].type,
      QrlStackTraceEntryType.UNRECOGNIZED_CONTRACT_ERROR
    );

    const creation = {
      ...runtime,
      kind: "create",
      input: new Uint8Array([0xfe]),
    };
    assert.equal(
      inferQrlStackTrace(creation, decoder)[0].type,
      QrlStackTraceEntryType.UNRECOGNIZED_CREATE_ERROR
    );
  });

  it("classifies unrecognized caller frames on a propagated failure", function () {
    const info = debugInfo();
    const decoder = new QrlStackTraceDecoder(info);
    const input = [0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)];
    const child = frame(input);
    const root = {
      ...frame(input),
      code: new Uint8Array([0xf1, 0x5f, 0xfd, 0x00]),
      steps: [{ pc: 0 }, child, { pc: 1 }, { pc: 2 }],
      children: [child],
    };
    let diagnostics = inferQrlStackTrace(root, decoder);
    assert.equal(diagnostics[0].type, QrlStackTraceEntryType.REVERT_ERROR);
    assert.equal(
      diagnostics[1].type,
      QrlStackTraceEntryType.UNRECOGNIZED_CONTRACT_CALLSTACK_ENTRY
    );

    root.kind = "create";
    root.input = root.code;
    diagnostics = inferQrlStackTrace(root, decoder);
    assert.equal(
      diagnostics[1].type,
      QrlStackTraceEntryType.UNRECOGNIZED_CREATE_CALLSTACK_ENTRY
    );
  });

  it("falls back to other execution error for an unknown recognized failure", function () {
    const info = debugInfo({
      deployedBytecode: "00",
      deployedSourceMap: "0:50:0",
    });
    const decoder = new QrlStackTraceDecoder(info);
    const value = frame([0x12, 0x34, 0x56, 0x78, ...new Array(64).fill(0)]);
    value.code = new Uint8Array([0x00]);
    value.lastPc = 0;
    value.steps = [{ pc: 0 }];
    value.returnValue = new Uint8Array(0);
    assert.equal(
      inferQrlStackTrace(value, decoder)[0].type,
      QrlStackTraceEntryType.OTHER_EXECUTION_ERROR
    );
  });
});
