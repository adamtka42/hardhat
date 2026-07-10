# Running a standalone local node

`hardhat node` starts an HTTP and WebSocket JSON-RPC server on top of the
in-process local QRL network, so external clients — frontends, wallets,
scripts in other languages, or a second Hardhat process — can connect to it.

~~~sh
$ npx hardhat node
Started HTTP and WebSocket JSON-RPC server at http://localhost:8545/

Accounts
========
Account #0: Q0101…0101 (1000000000000 wei)
~~~

The process keeps running and serves the chain until stopped (Ctrl+C shuts it
down gracefully). State lives as long as the process: deploy once, then keep
interacting from any number of clients.

## What it serves

The endpoint is the same `qrlLocal` provider used by `hardhat test`/`run`, so
the network's full config applies: accounts, `initialDate`, failure flags,
`allowUnlimitedContractSize`, `consoleLog`, `stackTraces`. Everything the
local network supports works over the wire:

- the `qrl_*` method surface plus the go-qrl compatibility probes
  (`net_*`, `web3_*`),
- local helpers: `qrl_mine`, `qrl_snapshot`/`qrl_revert`,
  `qrl_increaseTime`, `qrl_setNextBlockTimestamp`,
- `debug_traceCall` / `debug_traceTransaction`,
- failed transactions/calls return their revert `data` and
  `transactionHash` through the JSON-RPC error object,
- contract `console.log` output prints in the **node's** terminal.

Batches are executed per-request (one failing entry does not abort the
batch); ids map 1:1.

## Options

~~~sh
npx hardhat node --hostname 127.0.0.1 --port 8545
~~~

- `--hostname` (default `localhost`) — note `localhost` may resolve to the
  IPv6 `::1`; pass `127.0.0.1` explicitly for IPv4-only clients.
- `--port` (default `8545`; `0` picks a free port, printed in the startup
  line).

The node always serves a network of type `qrl-local` — by default the one
named `qrlLocal` in your config. `--network` is accepted only when it names a
qrl-local-type network; it never proxies to an HTTP network.

## Connecting a second Hardhat process

Add an HTTP network pointing at the node; with `accounts: "remote"` the
node's local accounts are used and transactions need no local signing:

~~~js
networks: {
  nodeHttp: {
    url: "http://127.0.0.1:8545",
    accounts: "remote",
  },
},
~~~

~~~sh
npx hardhat test --network nodeHttp
~~~

## Limitations

- `qrl_subscribe` (WebSocket subscriptions) is not implemented by the local
  provider yet; request/response over WebSocket works.
- `qrl_sendRawTransaction` is not supported by the local network yet, so
  clients must submit unsigned transactions via `qrl_sendTransaction`.
- The account banner prints addresses and balances only — the local accounts
  carry no key material.
