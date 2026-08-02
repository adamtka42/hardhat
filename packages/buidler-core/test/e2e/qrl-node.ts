import { assert } from "chai";
import { ChildProcess, execFile, spawn } from "child_process";
import fsExtra from "fs-extra";
import http from "http";
import { keccak_256 } from "js-sha3";
import path from "path";
import { promisify } from "util";

import { useTmpDir } from "../helpers/fs";

const execFileAsync = promisify(execFile);

const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const HARDHAT_ROOT = path.join(PACKAGE_ROOT, "..", "..");
const ZOND_ROOT = path.dirname(HARDHAT_ROOT);
const LOCAL_HYPC_PATH = path.join(
  ZOND_ROOT,
  "hyperion",
  "build",
  "hypc",
  "hypc"
);
const LOCAL_QRLJS_MONOREPO_PATH = path.join(
  path.dirname(ZOND_ROOT),
  "qrljs-monorepo"
);

function resolveHypcPath(): string | undefined {
  if (process.env.HYPERION_HYPC_PATH !== undefined) {
    return process.env.HYPERION_HYPC_PATH;
  }
  if (fsExtra.pathExistsSync(LOCAL_HYPC_PATH)) {
    return LOCAL_HYPC_PATH;
  }
  return undefined;
}

function resolveQrlJsMonorepoPath(): string | undefined {
  const configured =
    process.env.QRLJS_MONOREPO_PATH ?? LOCAL_QRLJS_MONOREPO_PATH;
  return fsExtra.pathExistsSync(
    path.join(configured, "packages", "vm", "dist", "cjs", "index.js")
  )
    ? configured
    : undefined;
}

const NODE_ACCOUNT_SEED = `0x010000${"05".repeat(48)}`;
// tslint:disable-next-line: no-var-requires
const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
const SENDER = seedToAccount(NODE_ACCOUNT_SEED).address;
const RAW_TX_RECEIVER = `Q${"02".repeat(64)}`;

function signedRawTransfer(qrlJsMonorepoPath: string): string {
  const txQrl = require(path.join(
    qrlJsMonorepoPath,
    "packages",
    "tx",
    "dist",
    "cjs",
    "index.js"
  )).qrl;
  const accountsEntry = require.resolve("@theqrl/web3-qrl-accounts");
  const { newMLDSA87WalletFromExtendedSeed } = require(path.join(
    path.dirname(accountsEntry),
    "qrl_wallet.js"
  ));
  const wallet = newMLDSA87WalletFromExtendedSeed(
    Uint8Array.from(Buffer.from(NODE_ACCOUNT_SEED.slice(2), "hex"))
  );
  const descriptor = wallet.descriptor.toBytes();
  const unsigned = new txQrl.QRLDynamicFeeTransaction({
    chainId: (global as any).BigInt(1337),
    nonce: (global as any).BigInt(0),
    gasTipCap: (global as any).BigInt(0),
    gasFeeCap: (global as any).BigInt(0),
    gasLimit: (global as any).BigInt(21000),
    to: RAW_TX_RECEIVER,
    value: (global as any).BigInt(7),
    data: new Uint8Array(0),
    descriptor,
    extraParams: new Uint8Array(),
  });
  const signed = new txQrl.QRLDynamicFeeTransaction({
    chainId: unsigned.chainId,
    nonce: unsigned.nonce,
    gasTipCap: unsigned.gasTipCap,
    gasFeeCap: unsigned.gasFeeCap,
    gasLimit: unsigned.gasLimit,
    to: unsigned.to,
    value: unsigned.value,
    data: unsigned.data,
    descriptor,
    extraParams: new Uint8Array(),
    signature: wallet.sign(unsigned.getMessageToSign()),
    publicKey: wallet.getPK(),
  });
  return `0x${Buffer.from(signed.serialize()).toString("hex")}`;
}

async function prepareProject(projectRoot: string) {
  await fsExtra.ensureDir(path.join(projectRoot, "contracts"));
  await fsExtra.ensureDir(path.join(projectRoot, "scripts"));
  await fsExtra.ensureDir(path.join(projectRoot, "node_modules", "@theqrl"));

  const linkPath = path.join(projectRoot, "node_modules", "@theqrl", "hardhat");
  await fsExtra.symlink(PACKAGE_ROOT, linkPath, "dir");

  await fsExtra.writeFile(
    path.join(projectRoot, "contracts", "Probe.hyp"),
    `// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

import "@theqrl/hardhat/console.hyp";

contract Probe {
    uint256 public value;

    function store(uint256 newValue) public {
        console.log("store", newValue);
        value = newValue;
    }

    function boom() public {
        value = 1;
        require(false, "boom");
    }
}
`
  );

  await fsExtra.writeFile(
    path.join(projectRoot, "hardhat.config.js"),
    `const localAccountAddress = process.env.QRL_NODE_E2E_ADDRESS;

module.exports = {
  defaultNetwork: "hardhatqrlvm",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    hardhatqrlvm: {
      chainId: 1337,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{
        address: localAccountAddress,
        balance: "1000000000000",
        seed: process.env.QRL_NODE_E2E_SEED,
      }],
      blockGasLimit: 30000000,
    },
    nodeHttp: {
      url: process.env.NODE_URL || "http://localhost:8545",
      accounts: "remote",
      from: localAccountAddress,
    },
  },
};
`
  );

  await fsExtra.writeFile(
    path.join(projectRoot, "scripts", "via-http.js"),
    `async function main() {
  const Probe = await qrl.getContractFactory("Probe");
  const probe = await Probe.deploy();
  const tx = await probe.store(42);
  await tx.wait();
  console.log("value over http:", (await probe.value()).toString(10));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`
  );
}

function startNode(
  projectRoot: string,
  env: NodeJS.ProcessEnv
): { child: ChildProcess; output: () => string; ready: Promise<number> } {
  const child = spawn(
    process.execPath,
    [
      "node_modules/@theqrl/hardhat/internal/cli/cli.js",
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    { cwd: projectRoot, env }
  );

  let output = "";
  const ready = new Promise<number>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(
        /Started HTTP and WebSocket JSON-RPC server at http:\/\/.*:(\d+)\//
      );
      if (match !== null) {
        resolve(parseInt(match[1], 10));
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("exit", (code) =>
      reject(new Error(`node exited early (${code}):\n${output}`))
    );
    const timer = setTimeout(
      () => reject(new Error(`node did not start in time:\n${output}`)),
      60000
    );
    timer.unref();
  });

  return { child, output: () => output, ready };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 10000
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function rpcRequest(port: number, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

describe("QRL node e2e", function () {
  useTmpDir("qrl-node-e2e");

  it("serves the local network over HTTP for external clients", async function () {
    this.timeout(420000);

    const hypcPath = resolveHypcPath();
    const qrlJsMonorepoPath = resolveQrlJsMonorepoPath();
    if (hypcPath === undefined || qrlJsMonorepoPath === undefined) {
      this.skip();
      return;
    }

    await execFileAsync("npm", ["run", "build"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });

    await prepareProject(this.tmpDir);

    const env = {
      ...process.env,
      HYPERION_HYPC_PATH: hypcPath,
      QRLJS_MONOREPO_PATH: qrlJsMonorepoPath,
      QRL_NODE_E2E_ADDRESS: SENDER,
      QRL_NODE_E2E_SEED: NODE_ACCOUNT_SEED,
    };

    // Compile ahead of time so the node serves ready artifacts.
    await execFileAsync(
      process.execPath,
      ["node_modules/@theqrl/hardhat/internal/cli/cli.js", "compile"],
      { cwd: this.tmpDir, env, maxBuffer: 1024 * 1024 * 20 }
    );

    // The node refuses to serve non-hardhatqrlvm networks.
    try {
      await execFileAsync(
        process.execPath,
        [
          "node_modules/@theqrl/hardhat/internal/cli/cli.js",
          "node",
          "--network",
          "nodeHttp",
        ],
        { cwd: this.tmpDir, env, maxBuffer: 1024 * 1024 * 20 }
      );
      assert.fail("node --network nodeHttp should have failed");
    } catch (error) {
      assert.include(
        `${error.stdout}${error.stderr}`,
        "JSON-RPC server can only be started"
      );
    }

    const node = startNode(this.tmpDir, env);
    try {
      const port = await node.ready;

      // Banner: funded account, no secret material. The banner is written
      // right after the sentinel; wait for the chunk to arrive.
      await waitFor(() => node.output().includes("Account #0"));
      assert.include(node.output(), `Account #0: ${SENDER}`);
      assert.notInclude(node.output(), NODE_ACCOUNT_SEED);
      assert.notMatch(node.output(), /private/i);

      // Raw HTTP: single request and an independent batch.
      const chainId = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_chainId",
        params: [],
        id: 1,
      });
      assert.equal(chainId.result, "0x539");

      // Real offline ML-DSA-87 signing through the standalone JSON-RPC
      // endpoint: decode, verify, derive sender, execute, and return receipt.
      const rawResponse = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_sendRawTransaction",
        params: [signedRawTransfer(qrlJsMonorepoPath)],
        id: 10,
      });
      assert.match(rawResponse.result, /^0x[0-9a-f]{64}$/);
      const rawReceipt = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_getTransactionReceipt",
        params: [rawResponse.result],
        id: 11,
      });
      assert.equal(rawReceipt.result.status, "0x1");
      assert.equal(rawReceipt.result.from.toLowerCase(), SENDER.toLowerCase());
      const receiverBalance = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_getBalance",
        params: [RAW_TX_RECEIVER, "latest"],
        id: 12,
      });
      assert.equal(receiverBalance.result, "0x7");

      const signedMessage = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_sign",
        params: [SENDER, "0xdeadbeef"],
        id: 13,
      });
      assert.match(signedMessage.result, /^0x[0-9a-f]+$/i);

      const blockFilter = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_newBlockFilter",
        params: [],
        id: 14,
      });
      assert.match(blockFilter.result, /^0x[0-9a-f]+$/i);

      const batch = await rpcRequest(port, [
        { jsonrpc: "2.0", method: "net_version", params: [], id: 2 },
        { jsonrpc: "2.0", method: "qrl_nonexistent", params: [], id: 3 },
      ]);
      assert.lengthOf(batch, 2);
      assert.equal(batch[0].result, "1337");
      assert.equal(batch[1].error.code, -32601);

      // Full workflow from a SECOND hardhat process over plain HTTP.
      const scriptResult = await execFileAsync(
        process.execPath,
        [
          "node_modules/@theqrl/hardhat/internal/cli/cli.js",
          "run",
          "scripts/via-http.js",
          "--network",
          "nodeHttp",
        ],
        {
          cwd: this.tmpDir,
          env: { ...env, NODE_URL: `http://127.0.0.1:${port}` },
          maxBuffer: 1024 * 1024 * 20,
        }
      );
      assert.include(scriptResult.stdout.toString(), "value over http: 42");

      const blockChanges = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_getFilterChanges",
        params: [blockFilter.result],
        id: 15,
      });
      assert.isAtLeast(blockChanges.result.length, 2);
      const uninstalled = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_uninstallFilter",
        params: [blockFilter.result],
        id: 16,
      });
      assert.isTrue(uninstalled.result);

      // WebSocket push (qrl_subscribe): a real WS client receives newHeads
      // notifications without polling; unsubscribe stops them. Uses the
      // go-qrl wire format (qrl_subscription notifications).
      // tslint:disable-next-line: no-implicit-dependencies no-var-requires
      const WebSocketClient = require("ws");
      const ws = new WebSocketClient(`ws://127.0.0.1:${port}`);
      const wsMessages: any[] = [];
      ws.on("message", (raw: any) => wsMessages.push(JSON.parse(`${raw}`)));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      const wsRequest = (body: any) =>
        new Promise<any>((resolve, reject) => {
          const handler = (raw: any) => {
            const message = JSON.parse(`${raw}`);
            if (message.id === body.id) {
              ws.off("message", handler);
              resolve(message);
            }
          };
          ws.on("message", handler);
          ws.once("error", reject);
          ws.send(JSON.stringify(body));
        });

      const subscribeResponse = await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_subscribe",
        params: ["newHeads"],
        id: 40,
      });
      assert.match(subscribeResponse.result, /^0x[0-9a-f]+$/);
      const subscriptionId = subscribeResponse.result;

      // Mine over HTTP; the notification must arrive over the WS PUSH
      // channel without any further WS request.
      await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_mine",
        params: [],
        id: 41,
      });
      await waitFor(() =>
        wsMessages.some(
          (message) =>
            message.method === "qrl_subscription" &&
            message.params?.subscription === subscriptionId &&
            typeof message.params?.result?.number === "string"
        )
      );

      // Full transport coverage of the remaining subscription types over
      // the REAL WebSocket envelope: pending transactions (hash and full
      // object variants) and criteria-filtered logs.
      const pendingHashesResponse = await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_subscribe",
        params: ["newPendingTransactions"],
        id: 50,
      });
      const pendingObjectsResponse = await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_subscribe",
        params: ["newPendingTransactions", true],
        id: 51,
      });

      const wsTransfer = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_sendTransaction",
        params: [{ from: SENDER, to: RAW_TX_RECEIVER, value: "0x1" }],
        id: 52,
      });
      await waitFor(() =>
        wsMessages.some(
          (message) =>
            message.method === "qrl_subscription" &&
            message.params?.subscription === pendingHashesResponse.result &&
            message.params?.result === wsTransfer.result
        )
      );
      await waitFor(() =>
        wsMessages.some(
          (message) =>
            message.method === "qrl_subscription" &&
            message.params?.subscription === pendingObjectsResponse.result &&
            message.params?.result?.hash === wsTransfer.result &&
            typeof message.params?.result?.from === "string"
        )
      );

      // Logs subscription: deploy a minimal LOG1 emitter (topic 0x...7b)
      // through raw calldata and observe the pushed, criteria-matched log.
      const LOG_TOPIC = `0x${"00".repeat(63)}7b`;
      const loggerDeploy = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_sendTransaction",
        params: [
          {
            from: SENDER,
            data: "0x600b600a5f39600b5ff3602a5f52607b60405fc100",
            gas: "0x30d40",
          },
        ],
        id: 53,
      });
      const loggerReceipt = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_getTransactionReceipt",
        params: [loggerDeploy.result],
        id: 54,
      });
      const logsResponse = await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_subscribe",
        params: [
          "logs",
          {
            address: loggerReceipt.result.contractAddress,
            topics: [LOG_TOPIC],
          },
        ],
        id: 55,
      });
      await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_sendTransaction",
        params: [
          {
            from: SENDER,
            to: loggerReceipt.result.contractAddress,
            gas: "0x30d40",
          },
        ],
        id: 56,
      });
      await waitFor(() =>
        wsMessages.some(
          (message) =>
            message.method === "qrl_subscription" &&
            message.params?.subscription === logsResponse.result &&
            message.params?.result?.topics?.[0] === LOG_TOPIC
        )
      );
      await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_unsubscribe",
        params: [pendingHashesResponse.result],
        id: 57,
      });
      await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_unsubscribe",
        params: [pendingObjectsResponse.result],
        id: 58,
      });
      await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_unsubscribe",
        params: [logsResponse.result],
        id: 59,
      });

      // A SECOND connection cannot remove the first client's subscription
      // (ids are sequential and guessable) and never receives its events.
      const ws2 = new WebSocketClient(`ws://127.0.0.1:${port}`);
      const ws2Messages: any[] = [];
      ws2.on("message", (raw: any) => ws2Messages.push(JSON.parse(`${raw}`)));
      await new Promise<void>((resolve, reject) => {
        ws2.once("open", resolve);
        ws2.once("error", reject);
      });
      const foreignUnsubscribe = await new Promise<any>((resolve, reject) => {
        ws2.once("message", (raw: any) => resolve(JSON.parse(`${raw}`)));
        ws2.once("error", reject);
        ws2.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "qrl_unsubscribe",
            params: [subscriptionId],
            id: 60,
          })
        );
      });
      assert.isFalse(foreignUnsubscribe.result);

      // The subscription survived the foreign unsubscribe attempt. ws2
      // stays CONNECTED through this mine, so the isolation assertion below
      // covers live notification routing, not just a closed socket.
      const beforeSurvivalCount = wsMessages.filter(
        (message) => message.method === "qrl_subscription"
      ).length;
      await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_mine",
        params: [],
        id: 61,
      });
      await waitFor(
        () =>
          wsMessages.filter((message) => message.method === "qrl_subscription")
            .length > beforeSurvivalCount
      );

      // The second, still-open client received NONE of the first client's
      // notifications. Frames on distinct sockets have no ordering
      // guarantee, so give a misrouted delivery a real window to arrive
      // (and fail fast the moment one does) before asserting the absence.
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, 300)),
        new Promise((_resolve, reject) =>
          ws2.on("message", (raw: any) => {
            if (JSON.parse(`${raw}`).method === "qrl_subscription") {
              reject(
                new Error("ws2 received a foreign qrl_subscription frame")
              );
            }
          })
        ),
      ]);
      assert.lengthOf(
        ws2Messages.filter((message) => message.method === "qrl_subscription"),
        0
      );
      ws2.close();

      const unsubscribeResponse = await wsRequest({
        jsonrpc: "2.0",
        method: "qrl_unsubscribe",
        params: [subscriptionId],
        id: 42,
      });
      assert.isTrue(unsubscribeResponse.result);

      // After unsubscribing, further blocks produce no notifications.
      const notificationCount = wsMessages.filter(
        (message) => message.method === "qrl_subscription"
      ).length;
      await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_mine",
        params: [],
        id: 43,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(
        wsMessages.filter((message) => message.method === "qrl_subscription")
          .length,
        notificationCount
      );

      // Subscriptions require a push transport: over HTTP the method is
      // rejected (as in go-qrl).
      const httpSubscribe = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_subscribe",
        params: ["newHeads"],
        id: 44,
      });
      assert.isDefined(httpSubscribe.error);
      // -32601, aligned with go-qrl's no-notification-transport error.
      assert.equal(httpSubscribe.error.code, -32601);

      ws.close();

      // Contract console.log printed in the NODE process, not the client.
      assert.include(node.output(), "store 42");
      assert.notInclude(scriptResult.stdout.toString(), "store 42");

      // Reverting transaction over raw HTTP: error carries data and the
      // mined tx hash; the receipt is fetchable through it.
      const probeAddress = (
        await rpcRequest(port, {
          jsonrpc: "2.0",
          method: "qrl_getBlockByNumber",
          params: ["0x2", true],
          id: 4,
        })
      ).result.transactions[0].hash;
      const receiptOfDeploy = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_getTransactionReceipt",
        params: [probeAddress],
        id: 5,
      });
      const contractAddress = receiptOfDeploy.result.contractAddress;

      const boomSelector = keccak_256("boom()").slice(0, 8);
      const boom = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_sendTransaction",
        params: [
          {
            from: SENDER,
            to: contractAddress,
            data: `0x${boomSelector}`,
            gas: "0x30d40",
          },
        ],
        id: 6,
      });
      assert.equal(boom.error.code, -32000);
      assert.match(boom.error.transactionHash, /^0x[0-9a-f]{64}$/);
      // Error("boom") revert payload survives the HTTP layer.
      assert.include(boom.error.data, "08c379a0");
      const boomReceipt = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_getTransactionReceipt",
        params: [boom.error.transactionHash],
        id: 7,
      });
      assert.equal(boomReceipt.result.status, "0x0");

      // debug namespace through the endpoint (feature 08 deferred check).
      const trace = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "debug_traceTransaction",
        params: [boom.error.transactionHash, { disableStack: true }],
        id: 8,
      });
      assert.isTrue(trace.result.failed);
      assert.equal(
        trace.result.structLogs[trace.result.structLogs.length - 1].op,
        "REVERT"
      );
      // Graceful shutdown on SIGINT: clean exit code and a released port.
      const exitCode = await new Promise((resolve) => {
        node.child.once("exit", (code) => resolve(code));
        node.child.kill("SIGINT");
      });
      assert.strictEqual(exitCode, 0);
      await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_chainId",
        params: [],
        id: 99,
      }).then(
        () => assert.fail("port should be released after shutdown"),
        () => undefined
      );
    } finally {
      if (node.child.exitCode === null) {
        node.child.kill("SIGKILL");
      }
    }
  });
});
