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

The default configuration uses a local compiler:

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

Local compiler selection follows this order:

1. `hyperion.compilerPath` from the config,
2. the `HYPERION_HYPC_PATH` environment variable,
3. the `HYPC_PATH` environment variable,
4. `hypc` from `PATH`.

An explicit local path or either local-path environment variable always takes
precedence over downloading. `version: "local"` also always selects the local
backend.

To select a compiler from an HTTP(S) repository, configure a concrete version
and repository URL:

~~~js
module.exports = {
  hyperion: {
    version: "0.2.0",
    compilerRepositoryUrl: "https://compilers.example/hyperion/linux-amd64/",
    optimizer: {
      enabled: false,
      runs: 200,
    },
  },
};
~~~

The URL can instead be provided through
`HYPERION_COMPILER_REPOSITORY_URL`. There is no default compiler repository
today. Without a repository URL, a concrete version still uses the local
compiler and is compared with `hypc --version`; a mismatch produces a warning
but does not stop compilation.

Downloaded compiler selection uses `list.json` at the repository root:

~~~json
{
  "builds": [
    {
      "path": "builds/hypc-0.2.0",
      "version": "0.2.0",
      "longVersion": "0.2.0+commit.abcdef12",
      "keccak256": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ],
  "releases": {
    "0.2.0": "builds/hypc-0.2.0"
  },
  "latestRelease": "0.2.0"
}
~~~

The upstream-compatible `keccak256` field is preferred. Repositories may
alternatively provide `sha256`, or a `checksum` plus a `checksumAlgorithm`
of `sha256` or `keccak256`. Each build must contain exactly one checksum.
QRL Hardhat verifies the compiler before every use, deletes a corrupt cached
file, and downloads it again. A newly downloaded file with an invalid checksum
is removed and never executed. Build paths must remain below the repository
URL.

Manifests and compiler binaries are cached below:

~~~text
cache/hyperion-compilers/
~~~

If the repository is temporarily unavailable, a previously cached valid
manifest and compiler can be used offline. `hardhat clean` removes this
project-local compiler cache along with other generated cache data.

A repository can be tested locally without additional infrastructure:

~~~sh
python3 -m http.server 8080 --directory ./compiler-repository
HYPERION_COMPILER_REPOSITORY_URL=http://127.0.0.1:8080/ npx hardhat compile
~~~

`optimizer.enabled` and `optimizer.runs` are passed into the Hyperion standard
JSON input.

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
- the resolved local `hypc` changed: its path, modification time, size, or
  detected version differs from the one that produced the cache,
- a downloaded compiler's version, long version, checksum, checksum algorithm,
  or repository URL differs from the cached identity,
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

### Compiler download fails

Check `hyperion.compilerRepositoryUrl`, the requested `version`, and the
repository's `list.json`. For an offline build, either retain a previously
verified project cache or configure `compilerPath`/`HYPERION_HYPC_PATH`.

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
