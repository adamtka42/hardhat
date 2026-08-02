# Hyperion stack traces

When a transaction or call reverts on `hardhatqrlvm`, QRL Hardhat appends a
Hyperion stack trace to the error: the chain of contracts and functions that
led to the revert, with source file and line for every frame.

```text
Error: QRL execution reverted (reason: 'too small', tx: 0x3f8a…)
  at Inner.fail (contracts/Nested.hyp:6)
  at Outer.callInner (contracts/Nested.hyp:19)
```

The innermost frame (where the `require`/`revert` fired) comes first, like a
conventional stack trace. The decoded revert reason and the raw revert data
(`error.data`) stay available as before.

## How it works

- The local VM records executed bytecode, ordered opcode positions, native
  precompile markers, and nested frames. For transactions this is a replay of
  the mined transaction on retained pre-block state, so historical transactions
  and contracts created inside reverted executions remain traceable.
- The compiler instruction source maps, ASTs, method identifiers, immutable
  references, and version metadata are cached during compilation. They identify
  runtime/init bytecode, map instructions to `.hyp` locations, reconstruct
  internal calls, and recognize compiler-generated dispatch failures.

## Requirements and degradation

Stack traces need:

1. a QRL runtime with execution tracing support (the runtime bundled with
   installed packages supports it; a qrljs-monorepo override must be a
   recent-enough build), and
2. the compile cache produced by this project's compilation (`cache/`).

When either is missing (e.g. artifacts copied from elsewhere, or after
`hardhat clean` without recompiling), errors degrade gracefully to the plain
decoded-reason message — nothing breaks.

## Configuration

Stack traces are on by default for `hardhatqrlvm` networks. Disable per network:

```js
hardhatqrlvm: {
  qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
  stackTraces: false,
},
```

## debug_traceCall and debug_traceTransaction

The underlying tracer is also exposed as the go-qrl-compatible `debug`
namespace on `hardhatqrlvm`:

```js
const trace = await network.provider.send("debug_traceTransaction", [txHash]);
// { gas, failed, returnValue, structLogs: [{ pc, op, gas, gasCost, depth, stack }] }

const callTrace = await network.provider.send("debug_traceCall", [
  { from, to, data },
  "latest",
  { disableStack: true },
]);
```

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

## Diagnostic failure accounting

Stack-trace generation is isolated from contract execution. If the collector,
decoder, or inference pipeline fails internally, Hardhat preserves the original
contract error and increments a diagnostic counter. The `hardhat test` task
prints a warning when that counter is non-zero.

The current value is available on `hardhatqrlvm` for tooling and regression tests:

```js
const failures = await network.provider.send("qrl_getStackTraceFailuresCount");
```

A non-zero value reports a Hardhat/qrljs diagnostic failure, not a contract
revert and not an unrecognized third-party contract.

## Limitations

- Bytecode that is not present in the current compilation cache is rendered as
  `<UnrecognizedContract>` with its QRL address. Its nested failure chain and
  revert data are retained, but source file/function information is unavailable.
- Source-level inference depends on compiler source maps and AST output. Missing
  cache data degrades to the original provider error without affecting
  execution.
- Unlike Solidity/EVM library runtime code, current Hyperion library runtime
  code permits direct calls. The three upstream direct-library-call errors
  therefore have no QRL failure equivalent and ordinary library reverts are
  not mislabeled.
- Exact go-qrl `debug_trace*` storage capture and CALL/CREATE opcode gas-cost
  semantics remain outside source-level stack-trace diagnostics; the deliberate
  differences are listed above.
