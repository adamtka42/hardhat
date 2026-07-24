import { QrlProvider } from "@theqrl/hardhat/types";
import { assert } from "chai";
import { EventEmitter } from "events";

import {
  JsonRpcRequest,
  JsonRpcResponse,
  Web3HTTPProviderAdapter,
} from "../src/web3-provider-adapter";

import { useEnvironment } from "./helpers";

let nextId = 1;

function createJsonRpcRequest(
  method: string,
  params: any[] = []
): JsonRpcRequest {
  return {
    id: nextId++,
    jsonrpc: "2.0",
    method,
    params,
  };
}

function sendSingle(
  provider: Web3HTTPProviderAdapter,
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    provider.send(request, (error, response) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(response!);
    });
  });
}

function sendBatch(
  provider: Web3HTTPProviderAdapter,
  requests: JsonRpcRequest[]
): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    provider.send(requests, (error, responses) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(responses!);
    });
  });
}

class FakeQrlProvider extends EventEmitter implements QrlProvider {
  constructor(
    private readonly _handler: (method: string, params: any[]) => Promise<any>
  ) {
    super();
  }

  public async send(method: string, params: any[] = []): Promise<any> {
    return this._handler(method, params);
  }
}

describe("Web3 provider adapter", function () {
  let adaptedProvider: Web3HTTPProviderAdapter;

  useEnvironment(__dirname);

  beforeEach(function () {
    adaptedProvider = new Web3HTTPProviderAdapter(this.env.network.provider);
  });

  it("Should always return true when isConnected is called", function () {
    assert.isTrue(adaptedProvider.isConnected());
  });

  it("delegates a single QRL request and returns a JSON-RPC envelope", async function () {
    const request = createJsonRpcRequest("qrl_accounts");
    const expected = await this.env.network.provider.send(request.method, []);
    const response = await sendSingle(adaptedProvider, request);

    assert.strictEqual(response.id, request.id);
    assert.strictEqual(response.jsonrpc, "2.0");
    assert.deepEqual(response.result, expected);
  });

  it("returns successful batch responses in request order", async function () {
    const requests = [
      createJsonRpcRequest("qrl_accounts"),
      createJsonRpcRequest("qrl_chainId"),
      createJsonRpcRequest("qrl_blockNumber"),
    ];
    const expected = await Promise.all(
      requests.map((request) =>
        this.env.network.provider.send(request.method, request.params)
      )
    );

    const responses = await sendBatch(adaptedProvider, requests);

    assert.lengthOf(responses, requests.length);
    responses.forEach((response, index) => {
      assert.strictEqual(response.id, requests[index].id);
      assert.strictEqual(response.jsonrpc, "2.0");
      assert.deepEqual(response.result, expected[index]);
    });
  });

  it("returns the provider's JSON-RPC error", async function () {
    const response = await sendSingle(
      adaptedProvider,
      createJsonRpcRequest("qrl_methodThatDoesNotExist")
    );

    assert.isDefined(response.error);
    assert.isNumber(response.error!.code);
    assert.isString(response.error!.message);
  });

  it("completes every batch request when one request fails", async function () {
    const requests = [
      createJsonRpcRequest("qrl_accounts"),
      createJsonRpcRequest("qrl_methodThatDoesNotExist"),
      createJsonRpcRequest("qrl_blockNumber"),
    ];

    const responses = await sendBatch(adaptedProvider, requests);

    assert.lengthOf(responses, requests.length);
    assert.deepEqual(
      responses.map((response) => response.id),
      requests.map((request) => request.id)
    );
    assert.isDefined(responses[0].result);
    assert.isDefined(responses[1].error);
    assert.isNumber(responses[1].error!.code);
    assert.isDefined(responses[2].result);
  });

  it("preserves error.data and converts a numeric string code", async function () {
    const provider = new FakeQrlProvider(async () => {
      throw {
        code: "-32000",
        data: "0x08c379a0",
        message: "execution reverted",
      };
    });
    const adapter = new Web3HTTPProviderAdapter(provider);

    const response = await sendSingle(
      adapter,
      createJsonRpcRequest("qrl_call")
    );

    assert.deepEqual(response.error, {
      code: -32000,
      data: "0x08c379a0",
      message: "execution reverted",
    });
  });

  it("passes an ordinary JavaScript error to the callback", function (done) {
    const transportError = new Error("transport failed");
    const provider = new FakeQrlProvider(async () => {
      throw transportError;
    });
    const adapter = new Web3HTTPProviderAdapter(provider);

    adapter.send(createJsonRpcRequest("qrl_accounts"), (error, response) => {
      assert.strictEqual(error, transportError);
      assert.isUndefined(response);
      done();
    });
  });

  it("translates hardhatqrlvm notifications into Web3 data events", function (done) {
    const provider = new FakeQrlProvider(async () => undefined);
    const adapter = new Web3HTTPProviderAdapter(provider, true);
    const notification = {
      result: { number: "0x1" },
      subscription: "0x123",
    };

    adapter.once("data", (data) => {
      assert.deepEqual(data, {
        jsonrpc: "2.0",
        method: "qrl_subscription",
        params: notification,
      });
      adapter.disconnect();
      assert.strictEqual(provider.listenerCount("notification"), 0);
      done();
    });

    assert.isTrue(adapter.supportsSubscriptions());
    provider.emit("notification", notification);
  });

  it("does not advertise subscriptions for HTTP providers", function () {
    const provider = new FakeQrlProvider(async () => undefined);
    const adapter = new Web3HTTPProviderAdapter(provider);

    assert.isFalse(adapter.supportsSubscriptions());
    assert.strictEqual(provider.listenerCount("notification"), 0);
  });
});
