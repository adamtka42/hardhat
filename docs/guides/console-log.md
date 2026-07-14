# Contract console logging

QRL Hardhat supports `console.log`-style debugging from Hyperion contracts when
those contracts run on `qrlLocal`. It is a development tool: use it in tests and
local scripts, then remove it from production contract code when you are done
debugging.

The feature mirrors the familiar Hardhat `console.sol` workflow, but it is QRL
native. Contracts import `console.hyp`, call `console.log(...)`, and the local
QRL VM streams decoded log lines to the terminal.

## Usage

Import the library from the Hardhat package root:

~~~solidity
// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

import "@theqrl/hardhat/console.hyp";

contract Sample {
    uint256 private value;

    function store(uint256 newValue) public {
        console.log("sender", msg.sender);
        console.log("old", value);
        console.log("new", newValue);
        value = newValue;
    }

    function retrieve() public view returns (uint256) {
        console.log("value", value);
        return value;
    }
}
~~~

Run the contract on `qrlLocal`:

~~~sh
npx hardhat test --network qrlLocal
~~~

Example output:

~~~text
sender Q01010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101
old 0
new 42
value 42
~~~

`console.log` also works during `callStatic`/`qrl_call`. Logs printed before a
revert are still emitted, which makes failed branches easier to inspect.

## Supported signatures

The first version supports these signatures:

~~~text
log()
log(string)
log(uint256)
log(bool)
log(address)
log(bytes)
log(bytes32)
log(string,string)
log(string,uint256)
log(string,bool)
log(string,address)
log(uint256,string)
log(uint256,uint256)
log(uint256,bool)
log(uint256,address)
log(bool,string)
log(bool,uint256)
log(bool,bool)
log(bool,address)
log(address,string)
log(address,uint256)
log(address,bool)
log(address,address)
~~~

Use canonical ABI types in expectations and overload discussions: `uint256`,
not `uint`.

Values are printed as follows:

| Type | Output |
| --- | --- |
| `string` | the string value |
| `uint256` | decimal |
| `bool` | `true` or `false` |
| `address` | QRL address |
| `bytes`, `bytes32` | `0x`-prefixed hex |

Multiple values are joined by one space. Each `console.log` call prints one
line.

## Networks

| Network type | Behavior |
| --- | --- |
| `qrlLocal` | logs are decoded and printed by default |
| HTTP go-qrl networks | contract calls succeed, but no logs are printed |
| private/public networks | same as HTTP networks: silent success |

The contract-side call is a normal zero-value `staticcall` to an address with no
code. On real networks the call succeeds with empty returndata and no Hardhat
listener is present, so the contract keeps running but nothing is printed.

## Disabling output

Set `consoleLog: false` on a `qrl-local` network to disable output without
changing contract behavior:

~~~js
module.exports = {
  networks: {
    qrlLocal: {
      type: "qrl-local",
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      consoleLog: false,
    },
  },
};
~~~

The field is accepted on HTTP network configs too, so shared configs do not
fail validation, but it only has an effect on `qrl-local` networks.

## Gas and state

QRL Hardhat observes the console call; it does not intercept or replace VM
execution. The `staticcall` itself costs gas everywhere, including real
networks, but attaching the local log listener does not change gas accounting or
state.

`qrl_estimateGas` suppresses console output to avoid repeated logs from the
estimation loop. `qrl_call` and `callStatic` do print logs.

## Limitations

- `console.log` functions are `view`, so they cannot be called from `pure`
  functions.
- Only the signatures listed above are supported in the first version.
- The feature requires a QRL runtime with console log listener support. The
  runtime bundled with installed packages supports it; a `qrljs-monorepo`
  override must be a recent-enough build. If `consoleLog: true` is set
  explicitly and the loaded runtime is too old, Hardhat prints a warning.
- This is for development and testing. Do not rely on console logs as an on-chain
  event or production observability mechanism.
