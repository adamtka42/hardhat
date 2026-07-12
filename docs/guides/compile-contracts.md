# Compiling contracts

QRL Hardhat compiles Hyperion contracts with the built-in `compile` task. Source
files use the `.hyp` extension and are read from `config.paths.sources`, which
defaults to `./contracts`.

Run compilation with:

~~~sh
npx hardhat compile
~~~

If the sources and compiler configuration have not changed, QRL Hardhat reuses
the cache:

~~~text
All contracts have already been compiled, skipping compilation.
~~~

Force recompilation with:

~~~sh
npx hardhat compile --force
~~~

or clear generated files first:

~~~sh
npx hardhat clean
npx hardhat compile
~~~

## Source files

The compile task includes every Hyperion source matching:

~~~text
contracts/**/*.hyp
~~~

if `paths.sources` is the default `./contracts`. You can customize the source
root in `hardhat.config.js`:

~~~js
module.exports = {
  paths: {
    sources: "./src/contracts",
  },
};
~~~

Imports are resolved relative to the project root and the Hyperion resolver used
by the compile task.

## Hyperion compiler configuration

Configure the Hyperion compiler with the `hyperion` field:

~~~js
module.exports = {
  hyperion: {
    version: "local",
    compilerPath: process.env.HYPERION_HYPC_PATH,
    optimizer: {
      enabled: false,
      runs: 200,
    },
  },
};
~~~

`compilerPath` points at the `hypc` executable. The binary is resolved in this
order:

1. `hyperion.compilerPath` from the config,
2. the `HYPERION_HYPC_PATH` environment variable,
3. the `HYPC_PATH` environment variable,
4. `hypc` from `PATH`.

`optimizer.enabled` and `optimizer.runs` are passed into the Hyperion standard
JSON input.

`version` declares which compiler version the project expects:

- `"local"` (the default) accepts whatever binary resolves — no check is made.
  The detected version is logged when running with `DEBUG=buidler*`.
- A concrete version such as `"0.2.0"` is compared against the output of
  `hypc --version`. On a mismatch the compile prints a one-line warning and
  continues with the binary's actual version — it is never an error, because
  local Hyperion builds carry `-ci`/`+commit` suffixes. A version matches when
  it equals the detected long version or is its release prefix (for example
  `"0.2.0"` matches `0.2.0-ci.2026.5.21+commit.cd63ffc3`).

Hyperion has no binary distribution registry yet, so unlike upstream Hardhat's
`solc.version`, the `version` field never downloads a compiler.

## Compiler input and output

QRL Hardhat builds a Hyperion standard JSON input with:

- `language: "Hyperion"`,
- all `.hyp` source contents,
- `settings.optimizer` from `config.hyperion.optimizer`.

The compiler output is converted into Hardhat artifacts. During compilation,
QRL Hardhat also writes the compiler input and output JSON files into the cache
directory:

~~~text
cache/compiler-input.json
cache/compiler-output.json
cache/last-compiler-config.json
~~~

These files are useful when debugging compiler behavior or comparing generated
artifacts.

## Artifacts

Compiled artifacts are written to `config.paths.artifacts`, which defaults to
`./artifacts`.

Each artifact contains:

- `contractName`: the contract name,
- `sourceName`: the source file path relative to the project root,
- `abi`: the Hyperion ABI,
- `bytecode`: `0x`-prefixed deployment bytecode,
- `deployedBytecode`: `0x`-prefixed runtime bytecode,
- `linkReferences`,
- `deployedLinkReferences`.

For unique contract names, QRL Hardhat writes a root artifact:

~~~text
artifacts/ContractName.json
~~~

It also writes source-qualified artifacts:

~~~text
artifacts/contracts/Token.hyp/Token.json
~~~

If two source files define the same contract name, use the fully qualified name
when reading artifacts or creating factories:

~~~js
const token = await qrl.getContractFactory("contracts/Token.hyp:Token");
~~~

## Cache invalidation

Compilation is skipped only when all relevant cache checks pass. QRL Hardhat
recompiles when:

- `compile --force` is used,
- source timestamps are newer than artifact timestamps,
- artifacts are missing,
- `cache/compiler-input.json` or `cache/compiler-output.json` is missing,
- the stored Hyperion config differs from the current config,
- the resolved `hypc` binary changed — its path, modification time, size, or
  detected version differs from the one that produced the cache. Rebuilding
  the compiler at the same path invalidates the cache even when the version
  string is unchanged,
- the QRL Hardhat package version differs from the cached version.

Use `npx hardhat clean` when you want to remove cache and artifacts explicitly.

## No Hyperion sources

If no `.hyp` source files are found, the compile task prints:

~~~text
No Hyperion source file available.
~~~

This usually means `paths.sources` points at the wrong directory, or contracts
use a non-`.hyp` extension.

## Troubleshooting

### Compiler binary not found

Set `hyperion.compilerPath` or `HYPERION_HYPC_PATH` to a valid `hypc` binary:

~~~sh
HYPERION_HYPC_PATH=/path/to/hypc npx hardhat compile
~~~

### Stale artifacts

Run:

~~~sh
npx hardhat clean
npx hardhat compile
~~~

This removes cache and artifacts before compiling again.

### Contract not found by `hre.qrl`

Make sure the contract was compiled and that the name is unambiguous. If multiple
sources define the same contract name, use a fully qualified name:

~~~js
await hre.qrl.getContractFactory("contracts/MyToken.hyp:MyToken");
~~~

### Solidity or EVM compiler options

QRL Hardhat does not use `solc`, `evmVersion`, Solidity hardfork settings, or
multi-version Solidity compiler configuration. Use Hyperion `.hyp` contracts and
the `hyperion` config field instead.
