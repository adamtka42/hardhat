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

The endpoint is the same `hardhatqrlvm` provider used by `hardhat test`/`run`, so
the network's full config applies: accounts, `initialDate`, failure flags,
`allowUnlimitedContractSize`, `consoleLog`, `stackTraces`. Everything the
local network supports works over the wire:

- the `qrl_*` method surface plus the go-qrl compatibility probes
  (`net_*`, `web3_*`),
- local helpers: `qrl_mine`, `qrl_snapshot`/`qrl_revert`,
  `qrl_increaseTime`, `qrl_setNextBlockTimestamp`,
- log, block, and pending-transaction filters (`qrl_newFilter`,
  `qrl_newBlockFilter`, `qrl_newPendingTransactionFilter`,
  `qrl_getFilterChanges`, `qrl_getFilterLogs`, `qrl_uninstallFilter`),
- pending transaction inspection through `qrl_pendingTransactions`,
- signed transaction submission through `qrl_sendRawTransaction`,
- message signing through `qrl_sign` for accounts configured with a seed,
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

The node always serves the reserved `hardhatqrlvm` network from your config.
Passing another name through `--network` is rejected; the task never proxies to
an HTTP network.

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

## Local signing

`qrl_sendRawTransaction` verifies the ML-DSA signature and public key before
executing a transaction. The signed transaction must use the local chain id
and the sender's current nonce.

An account can optionally include its extended QRL seed. This enables
`qrl_sign` for that account:

~~~js
accounts: [
  {
    address: process.env.HARDHAT_QRLVM_ADDRESS,
    seed: process.env.HARDHAT_QRLVM_SEED,
    balance: "1000000000000000000000000",
  },
],
~~~

The seed must derive the configured address. Accounts without a seed continue
to support normal local transactions, but cannot be used with `qrl_sign`.
The node banner never prints the seed.

## WebSocket subscriptions

WebSocket clients can subscribe to push notifications with `qrl_subscribe`
(go-qrl wire format; notifications arrive as `qrl_subscription` messages):

- `newHeads` — every mined block header,
- `newPendingTransactions` — pending pool admissions as hashes, or full
  transaction objects when the optional second parameter is `true`,
- `logs` — logs matching optional `address`/`topics` criteria.

Subscriptions belong to the WebSocket connection that created them: other
connections cannot observe or remove them, and closing the connection cleans
them up. Over plain HTTP, `qrl_subscribe`/`qrl_unsubscribe` are rejected —
push notifications need a live connection.

## Limitations

- Installed polling filters expire after five minutes of inactivity (as in
  go-qrl); each `qrl_getFilterChanges`/`qrl_getFilterLogs` call refreshes
  the deadline. WebSocket subscriptions do not expire — they live until
  unsubscribed or disconnected.
