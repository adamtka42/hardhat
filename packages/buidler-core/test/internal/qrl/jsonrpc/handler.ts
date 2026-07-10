import { assert } from "chai";
import { EventEmitter } from "events";
import http from "http";

import { JsonRpcServer } from "../../../../src/internal/qrl/jsonrpc/server";

class MockProvider extends EventEmitter {
  public async send(method: string, params: any[] = []): Promise<any> {
    if (method === "qrl_chainId") {
      return "0x539";
    }
    if (method === "qrl_echo") {
      return params[0];
    }
    if (method === "qrl_revert") {
      const error: any = new Error("QRL execution reverted");
      error.code = -32000;
      error.data = "0x08c379a0aabb";
      error.transactionHash = `0x${"ab".repeat(32)}`;
      throw error;
    }
    if (method === "qrl_boom") {
      throw new Error("plain failure without a code");
    }
    const unknown: any = new Error(`Unknown QRL provider method: ${method}`);
    unknown.code = -32601;
    throw unknown;
  }
}

function postRaw(port: number, body: string): Promise<any> {
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
    req.end(body);
  });
}

function rpc(method: string, params: any[] = [], id: number = 1) {
  return { jsonrpc: "2.0", method, params, id };
}

describe("QRL JSON-RPC server", function () {
  let server: JsonRpcServer;
  let port: number;

  before(async function () {
    server = new JsonRpcServer({
      hostname: "127.0.0.1",
      port: 0,
      provider: new MockProvider() as any,
      loggingEnabled: false,
    });
    const address = await server.listen();
    port = address.port;
  });

  after(async function () {
    await server.close();
  });

  it("answers a single request", async function () {
    const response = await postRaw(port, JSON.stringify(rpc("qrl_chainId")));

    assert.deepEqual(response, { jsonrpc: "2.0", id: 1, result: "0x539" });
  });

  it("returns -32700 for malformed JSON", async function () {
    const response = await postRaw(port, "{ not json");

    assert.equal(response.error.code, -32700);
  });

  it("returns -32600 for an invalid request shape", async function () {
    const response = await postRaw(port, JSON.stringify({ hello: "world" }));

    assert.equal(response.error.code, -32600);
  });

  it("passes provider error codes through", async function () {
    const response = await postRaw(
      port,
      JSON.stringify(rpc("qrl_definitelyMissing"))
    );

    assert.equal(response.error.code, -32601);
  });

  it("maps errors without a code to -32603 internal", async function () {
    const response = await postRaw(port, JSON.stringify(rpc("qrl_boom")));

    assert.equal(response.error.code, -32603);
    assert.include(response.error.message, "plain failure");
  });

  it("forwards revert data and transactionHash through the HTTP layer", async function () {
    const response = await postRaw(port, JSON.stringify(rpc("qrl_revert")));

    assert.equal(response.error.code, -32000);
    assert.equal(response.error.data, "0x08c379a0aabb");
    assert.equal(response.error.transactionHash, `0x${"ab".repeat(32)}`);
  });

  it("handles batches independently with 1:1 id mapping", async function () {
    const response = await postRaw(
      port,
      JSON.stringify([
        rpc("qrl_echo", ["first"], 7),
        rpc("qrl_definitelyMissing", [], 8),
        rpc("qrl_echo", ["third"], 9),
      ])
    );

    assert.isArray(response);
    assert.lengthOf(response, 3);
    assert.deepEqual(response[0], { jsonrpc: "2.0", id: 7, result: "first" });
    assert.equal(response[1].id, 8);
    assert.equal(response[1].error.code, -32601);
    assert.deepEqual(response[2], { jsonrpc: "2.0", id: 9, result: "third" });
  });
});
