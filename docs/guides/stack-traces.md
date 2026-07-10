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
  hex words (wider than Ethereum's 256-bit — tools that parse hex strings
  work unchanged).
- Historical transactions are traceable: the local chain retains the
  pre-block state of every mined block. `qrl_revert` drops the retained
  states of rolled-back blocks.
- `gasCost` is derived by differencing consecutive steps within a frame — an
  approximation for frame-crossing opcodes.
- Not supported yet: custom tracers (`tracer` config) and memory capture
  (`enableMemory`); both return a clear error.

## Limitations

- The trace shows the failing call path with source locations; it does not
  infer error causes the way upstream Hardhat's heuristics did (wrong
  argument counts, non-payable transfers, etc.).
- Frames whose bytecode cannot be matched to a compiled contract (e.g.
  contracts deployed from other projects) are silently skipped.
- Gas estimation failures of reverting transactions are traced through the
  call path (`qrl_estimateGas` uses the same decoding).
