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

const SENDER = `Q${"01".repeat(64)}`;

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
    `const localAccountAddress = \`Q\${"01".repeat(64)}\`;

module.exports = {
  defaultNetwork: "qrlLocal",
  hyperion: {
    compilerPath: process.env.HYPERION_HYPC_PATH,
  },
  networks: {
    qrlLocal: {
      type: "qrl-local",
      chainId: 1337,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
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
    };

    // Compile ahead of time so the node serves ready artifacts.
    await execFileAsync(
      process.execPath,
      ["node_modules/@theqrl/hardhat/internal/cli/cli.js", "compile"],
      { cwd: this.tmpDir, env, maxBuffer: 1024 * 1024 * 20 }
    );

    // The node refuses to serve non-qrl-local networks.
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
      assert.notMatch(node.output(), /seed|private/i);

      // Raw HTTP: single request and an independent batch.
      const chainId = await rpcRequest(port, {
        jsonrpc: "2.0",
        method: "qrl_chainId",
        params: [],
        id: 1,
      });
      assert.equal(chainId.result, "0x539");

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

      // Contract console.log printed in the NODE process, not the client.
      assert.include(node.output(), "store 42");
      assert.notInclude(scriptResult.stdout.toString(), "store 42");

      // Reverting transaction over raw HTTP: error carries data and the
      // mined tx hash; the receipt is fetchable through it.
      const probeAddress = (
        await rpcRequest(port, {
          jsonrpc: "2.0",
          method: "qrl_getBlockByNumber",
          params: ["0x1", true],
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
