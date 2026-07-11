# Hyperion stack traces

When a transaction or call reverts on `qrlLocal`, QRL Hardhat appends a
Hyperion stack trace to the error: the chain of contracts and functions that
led to the revert, with source file and line for every frame.

~~~text
Error: QRL execution reverted (reason: 'too small', tx: 0x3f8a…)
  at Inner.fail (contracts/Nested.hyp:6)
  at Outer.callInner (contracts/Nested.hyp:19)
~~~

The innermost frame (where the `require`/`revert` fired) comes first, like a
conventional stack trace. The decoded revert reason and the raw revert data
(`error.data`) stay available as before.

## How it works

- The local VM records the call tree of the failing execution (for
  transactions this is a replay of the mined transaction on retained
  pre-block state, so historical transactions are traceable too).
- The compiler's instruction source maps and ASTs — cached in
  `cache/compiler-output.json` during compilation — map each frame's failure
  point back to a `.hyp` source location and enclosing function.

## Requirements and degradation

Stack traces need:

1. a qrljs-monorepo build with execution tracing support, and
2. the compile cache produced by this project's compilation (`cache/`).

When either is missing (e.g. artifacts copied from elsewhere, or after
`hardhat clean` without recompiling), errors degrade gracefully to the plain
decoded-reason message — nothing breaks.

## Configuration

Stack traces are on by default for `qrl-local` networks. Disable per network:

~~~js
qrlLocal: {
  type: "qrl-local",
  qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
  stackTraces: false,
},
~~~

## debug_traceCall and debug_traceTransaction

The underlying tracer is also exposed as the go-qrl-compatible `debug`
namespace on `qrlLocal`:

~~~js
const trace = await network.provider.send("debug_traceTransaction", [txHash]);
// { gas, failed, returnValue, structLogs: [{ pc, op, gas, gasCost, depth, stack }] }

const callTrace = await network.provider.send("debug_traceCall", [
  { from, to, data },
  "latest",
  { disableStack: true },
]);
~~~

Notes:

- `structLogs` follows the go-qrl/geth shape; stack values are **512-bit**
  hex words and memory is chunked into **64-byte** words (the QRL VM word
  size), matching go-qrl.
- Historical transactions are traceable: the local chain retains the
  pre-block state of every mined block. `qrl_revert` drops the retained
  states of rolled-back blocks.
- `gasCost` is exact for a frame's final instruction and derived by
  differencing consecutive steps otherwise — for frame-crossing opcodes
  (CALL/CREATE) this includes the child's consumption, which differs from
  go-qrl's pre-execution opcode cost.
- `enableMemory` is supported (64-byte word chunks); `limit` stops
  collection as soon as it is reached.
- **Storage is never captured** — a deliberate divergence from go-qrl, whose
  default records SLOAD/SSTORE. Omitting `disableStorage` returns a trace
  without storage; explicitly requesting it (`disableStorage: false`) fails
  with a clear error. Custom tracers (`tracer` config) are rejected too.

## Limitations

- The trace shows the failing call path with source locations; it does not
  infer error causes the way upstream Hardhat's heuristics did (wrong
  argument counts, non-payable transfers, etc.).
- Frames whose bytecode cannot be matched to a compiled contract (e.g.
  contracts deployed from other projects) are silently skipped.
- Failure attribution follows matching revert payloads: an empty-payload
  bubble stops at the outer contract, and a HANDLED nested failure whose
  reason is byte-identical to the outer contract's own revert is attributed
  to the inner one — both are undecidable without instruction-level
  analysis.
- Gas estimation failures of reverting transactions are traced through the
  call path (`qrl_estimateGas` uses the same decoding).
