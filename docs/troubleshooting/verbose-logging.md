# Verbose logging

Use verbose logging when a QRL Hardhat command fails before the real error is
visible, or when you need to collect enough context to debug a network,
configuration, plugin, or task issue.

## CLI flags

Run any Hardhat command with `--verbose`:

~~~sh
npx hardhat --verbose compile
npx hardhat --verbose test --network hardhatqrlvm
QRL_RPC_URL=http://127.0.0.1:33462 npx hardhat --verbose test --network qrl
~~~

`--verbose` enables the internal `debug` logger for namespaces matching
`hardhat*`. The current core namespaces include:

- `hardhat:core:cli`
- `hardhat:core:bre`
- `hardhat:core:plugins`
- `hardhat:core:execution-mode`
- `hardhat:core:scripts-runner`

The exact namespaces that appear depend on the command path.

Use `--show-stack-traces` when the compact Hardhat error message is not enough:

~~~sh
npx hardhat --show-stack-traces test --network hardhatqrlvm
npx hardhat --verbose --show-stack-traces run scripts/deploy.js --network qrl
~~~

## DEBUG environment variable

QRL Hardhat uses the `debug` package internally, so you can enable the same logs
with `DEBUG`:

~~~sh
DEBUG=hardhat* npx hardhat test --network hardhatqrlvm
DEBUG=hardhat:core:* npx hardhat compile
DEBUG=hardhat:core:bre npx hardhat run scripts/deploy.js --network qrl
~~~

Use `--verbose` for the broad default. Use `DEBUG` when you want a narrower
namespace while debugging a specific area.

## HARDHAT environment variables

CLI parameters can also be set with `HARDHAT_` environment variables:

~~~sh
HARDHAT_VERBOSE=true npx hardhat test --network hardhatqrlvm
HARDHAT_SHOW_STACK_TRACES=true npx hardhat test --network hardhatqrlvm
HARDHAT_NETWORK=hardhatqrlvm npx hardhat test
HARDHAT_MAX_MEMORY=4096 npx hardhat compile
~~~

Boolean values should be written as `true` or `false`.

Do not rely on old `BUIDLER_*` environment variables. This fork uses
`HARDHAT_*` for Hardhat CLI parameters.

## RPC debugging

`--verbose` shows Hardhat internals, but the HTTP provider does not dump raw
JSON-RPC request and response bodies. For endpoint problems, verify the node
directly:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_chainId","params":[],"id":1}'
~~~

Check accounts before testing deployment or transactions:

~~~sh
curl -s -X POST "$QRL_RPC_URL" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_accounts","params":[],"id":1}'
~~~

If the endpoint is a private go-qrl network, also check the node logs. Hardhat
can report connection and RPC errors, but the node logs are the source of truth
for server-side rejection details.

## hardhatqrlvm debugging

`hardhatqrlvm` uses the QRL runtime bundled with the installed package, or a
built `qrljs-monorepo` checkout when the development override is set. If it
fails before tests start, run with verbose logging to see which runtime
source was selected:

~~~sh
npx hardhat --verbose --show-stack-traces test --network hardhatqrlvm
~~~

For `BDLR123`, verbose output can confirm that Hardhat is creating a `hardhatqrlvm`
provider. The fix depends on the runtime source: if a development override
(`QRLJS_MONOREPO_PATH` / `networks.<network>.qrlJsMonorepoPath`) is set,
unset it or build the checkout it points to; without an override, the bundled
runtime in the installed package may be corrupted — reinstall the package.

## Capturing output

Redirect both stdout and stderr when sharing logs:

~~~sh
npx hardhat --verbose --show-stack-traces test --network hardhatqrlvm \
  > hardhat-qrlvm.log 2>&1

QRL_RPC_URL=http://127.0.0.1:33462 \
npx hardhat --verbose --show-stack-traces test --network qrl \
  > hardhat-qrl-http.log 2>&1
~~~

Review logs before sharing or committing them. They can contain local paths,
RPC URLs, account addresses, and other environment-specific details.

## Warnings are not verbose logs

Node.js deprecation warnings and npm update notices are not controlled by
`--verbose`. If tests pass and only those notices are printed, treat them as
toolchain warnings rather than Hardhat debug output.
