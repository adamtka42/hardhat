import { assert } from "chai";
import { EventEmitter } from "events";
import http from "http";

import { JsonRpcServer } from "../../../../src/internal/buidler-evm/jsonrpc/server";

class MockProvider extends EventEmitter {
  public subscribeDelayMs = 0;
  public unsubscribedIds: string[] = [];
  private _nextSubscriptionId = 1;

  public async send(method: string, params: any[] = []): Promise<any> {
    if (method === "qrl_chainId") {
      return "0x539";
    }
    if (method === "qrl_subscribe") {
      if (this.subscribeDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.subscribeDelayMs)
        );
      }
      return `0x${(this._nextSubscriptionId++).toString(16)}`;
    }
    if (method === "qrl_unsubscribe") {
      // Mirrors the real provider's validation: exactly one string id.
      if (params.length !== 1 || typeof params[0] !== "string") {
        const invalid: any = new Error("qrl_unsubscribe expects 1 parameter");
        invalid.code = -32602;
        throw invalid;
      }
      this.unsubscribedIds.push(params[0]);
      return true;
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

  it("rejects qrl_subscribe over HTTP with -32601, but validates malformed requests first", async function () {
    const response = await postRaw(
      port,
      JSON.stringify(rpc("qrl_subscribe", ["newHeads"], 20))
    );
    assert.equal(response.error.code, -32601);
    assert.include(response.error.message, "WebSocket");

    // A malformed request (bad jsonrpc member) reports invalid request, not
    // the transport error.
    const malformed = await postRaw(
      port,
      JSON.stringify({ jsonrpc: "1.0", method: "qrl_subscribe", id: 21 })
    );
    assert.equal(malformed.error.code, -32600);
  });

  it("keeps unsubscribe validation for malformed WebSocket requests", async function () {
    const ws = await openWs(port);
    try {
      // No params: must surface the provider/validation error, not the
      // ownership shortcut's silent false.
      const noParams = await wsCall(ws, {
        jsonrpc: "2.0",
        method: "qrl_unsubscribe",
        params: [],
        id: 30,
      });
      assert.isUndefined(noParams.result);
      assert.isDefined(noParams.error);

      // A well-formed foreign id answers false without reaching the
      // provider.
      const foreign = await wsCall(ws, {
        jsonrpc: "2.0",
        method: "qrl_unsubscribe",
        params: ["0x999"],
        id: 31,
      });
      assert.isFalse(foreign.result);
    } finally {
      ws.close();
    }
  });

  it("releases a subscription completed after the socket closed", async function () {
    const provider = new MockProvider();
    provider.subscribeDelayMs = 100;
    const delayedServer = new JsonRpcServer({
      hostname: "127.0.0.1",
      port: 0,
      provider: provider as any,
    });
    const address = await delayedServer.listen();

    try {
      const ws = await openWs(address.port);
      // Fire the subscribe and close the socket before the provider
      // finishes; the handler must unsubscribe the late result instead of
      // leaking it.
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "qrl_subscribe",
          params: ["newHeads"],
          id: 40,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      ws.close();

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.deepEqual(provider.unsubscribedIds, ["0x1"]);
    } finally {
      await delayedServer.close();
    }
  });
});

function openWs(port: number): Promise<any> {
  // tslint:disable-next-line: no-implicit-dependencies no-var-requires
  const WebSocketClient = require("ws");
  const ws = new WebSocketClient(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function wsCall(ws: any, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
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
}
