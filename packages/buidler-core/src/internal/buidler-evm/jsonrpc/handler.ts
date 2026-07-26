import debug from "debug";
import { IncomingMessage, ServerResponse } from "http";
import getRawBody from "raw-body";
import WebSocket from "ws";

import { IQrlProvider } from "../../../types";
import {
  isValidJsonRequest,
  isValidJsonResponse,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../util/jsonrpc";
import {
  InternalError,
  InvalidJsonInputError,
  InvalidRequestError,
  MethodNotFoundError,
} from "../provider/errors";

// tslint:disable only-hardhat-error

const log = debug("buidler:core:qrl:jsonrpc");

export default class JsonRpcHandler {
  constructor(
    private readonly _provider: IQrlProvider,
    private readonly _loggingEnabled: boolean = true
  ) {}

  public handleHttp = async (req: IncomingMessage, res: ServerResponse) => {
    this._setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      this._sendEmptyResponse(res);
      return;
    }

    let jsonHttpRequest: any;
    try {
      jsonHttpRequest = await _readJsonHttpRequest(req);
    } catch (error) {
      this._sendResponse(res, _handleError(error));
      return;
    }

    if (Array.isArray(jsonHttpRequest)) {
      // Batch semantics: every entry is handled independently; a failing
      // entry never aborts the batch, and ids map 1:1.
      const responses = await Promise.all(
        jsonHttpRequest.map((singleReq: any) =>
          this._handleSingleHttpRequest(singleReq)
        )
      );

      this._sendResponse(res, responses);
      return;
    }

    const rpcResp = await this._handleSingleHttpRequest(jsonHttpRequest);

    this._sendResponse(res, rpcResp);
  };

  public handleWs = async (ws: WebSocket) => {
    const subscriptions = new Set<string>();
    let isClosed = false;

    const listener = (payload: { subscription: string; result: any }) => {
      // Only forward notifications for subscriptions created through this
      // websocket connection, and never after it closed.
      if (isClosed || !subscriptions.has(payload.subscription)) {
        return;
      }

      try {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "qrl_subscription",
            params: payload,
          })
        );
      } catch (error) {
        _handleError(error);
      }
    };

    // Dormant until the local provider implements qrl_subscribe.
    this._provider.addListener("notification", listener);

    ws.on("message", async (msg) => {
      let rpcReq: JsonRpcRequest | undefined;
      let rpcResp: JsonRpcResponse | undefined;

      try {
        rpcReq = _readWsRequest(msg as string);

        if (!isValidJsonRequest(rpcReq)) {
          throw new InvalidRequestError("Invalid request");
        }

        // Subscriptions belong to the connection that created them: an
        // unsubscribe for a foreign (or unknown) id answers false WITHOUT
        // reaching the provider, so one client can never remove another
        // client's subscription — ids are sequential and guessable. The
        // shortcut applies ONLY to well-formed requests (exactly one string
        // parameter); malformed ones fall through to standard validation.
        if (
          rpcReq.method === "qrl_unsubscribe" &&
          Array.isArray(rpcReq.params) &&
          rpcReq.params.length === 1 &&
          typeof rpcReq.params[0] === "string" &&
          !subscriptions.has(rpcReq.params[0])
        ) {
          rpcResp = {
            jsonrpc: "2.0",
            id: rpcReq.id,
            result: false,
          };
        } else {
          rpcResp = await this._handleRequest(rpcReq);
        }

        // Track successful qrl_subscribe calls so notifications can be
        // routed and cleaned up per connection. When the provider finishes
        // AFTER the socket closed, the close handler has already run — the
        // subscription must be released immediately instead of leaking.
        if (
          rpcReq.method === "qrl_subscribe" &&
          isValidJsonResponse(rpcResp) &&
          "result" in rpcResp
        ) {
          if (isClosed) {
            try {
              await this._provider.send("qrl_unsubscribe", [
                (rpcResp as any).result,
              ]);
            } catch {
              // Nothing to clean up if the provider dropped it already.
            }
          } else {
            subscriptions.add((rpcResp as any).result);
          }
        }

        // A successful own unsubscribe releases the id.
        if (
          rpcReq.method === "qrl_unsubscribe" &&
          Array.isArray(rpcReq.params) &&
          isValidJsonResponse(rpcResp) &&
          (rpcResp as any).result === true
        ) {
          subscriptions.delete(rpcReq.params[0]);
        }
      } catch (error) {
        rpcResp = _handleError(error);
      }

      if (!isValidJsonResponse(rpcResp)) {
        rpcResp = _handleError(new InternalError("Internal error"));
      }

      if (rpcReq !== undefined) {
        rpcResp.id = rpcReq.id;
      }

      ws.send(JSON.stringify(rpcResp));
    });

    ws.on("close", () => {
      this._provider.removeListener("notification", listener);

      isClosed = true;
      subscriptions.forEach(async (subscriptionId) => {
        try {
          await this._provider.send("qrl_unsubscribe", [subscriptionId]);
        } catch {
          // The provider may not support subscriptions yet.
        }
      });
    });
  };

  // Subscriptions need a push channel; over plain HTTP they are rejected
  // with a stable error (same behavior as go-qrl). Only WELL-FORMED
  // requests take this shortcut — malformed ones go through the standard
  // validation path and report invalid-request errors.
  private _handleSingleHttpRequest = async (rpcReq: any) => {
    if (
      isValidJsonRequest(rpcReq) &&
      (rpcReq.method === "qrl_subscribe" || rpcReq.method === "qrl_unsubscribe")
    ) {
      const rpcResp = _handleError(
        new MethodNotFoundError(
          `${rpcReq.method} is only supported over WebSocket connections`
        )
      );
      rpcResp.id = rpcReq.id;
      return rpcResp;
    }

    return this._handleSingleRequest(rpcReq);
  };

  private _sendEmptyResponse(res: ServerResponse) {
    res.writeHead(200);
    res.end();
  }

  private _setCorsHeaders(res: ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Request-Method", "*");
    res.setHeader("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
    res.setHeader("Access-Control-Allow-Headers", "*");
  }

  private _sendResponse(
    res: ServerResponse,
    rpcResp: JsonRpcResponse | JsonRpcResponse[]
  ) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(rpcResp));
  }

  private async _handleSingleRequest(req: any): Promise<JsonRpcResponse> {
    if (!isValidJsonRequest(req)) {
      return _handleError(new InvalidRequestError("Invalid request"));
    }

    const rpcReq: JsonRpcRequest = req;
    let rpcResp: JsonRpcResponse | undefined;

    try {
      rpcResp = await this._handleRequest(rpcReq);
    } catch (error) {
      rpcResp = _handleError(error);
    }

    if (!isValidJsonResponse(rpcResp)) {
      // Malformed response coming from the provider; report as internal.
      rpcResp = _handleError(new InternalError("Internal error"));
    }

    if (rpcReq !== undefined) {
      rpcResp.id = rpcReq.id !== undefined ? rpcReq.id : (null as any);
    }

    return rpcResp;
  }

  private _handleRequest = async (
    req: JsonRpcRequest
  ): Promise<JsonRpcResponse> => {
    if (this._loggingEnabled) {
      // tslint:disable-next-line: no-console
      console.log(req.method);
    }

    const result = await this._provider.send(req.method, req.params);

    return {
      jsonrpc: "2.0",
      id: req.id,
      result,
    };
  };
}

const _readJsonHttpRequest = async (req: IncomingMessage): Promise<any> => {
  let json;

  try {
    const buf = await getRawBody(req);
    const text = buf.toString();

    json = JSON.parse(text);
  } catch (error) {
    throw new InvalidJsonInputError(`Parse error: ${error.message}`);
  }

  return json;
};

const _readWsRequest = (msg: string): JsonRpcRequest => {
  let json: any;
  try {
    json = JSON.parse(msg);
  } catch (error) {
    throw new InvalidJsonInputError(`Parse error: ${error.message}`);
  }

  return json;
};

const _handleError = (error: any): JsonRpcResponse => {
  log(`${error.message ?? error}`);

  // Provider errors carry their own numeric codes; anything else is
  // internal. Unlike the upstream handler, `data` (revert payloads) and
  // `transactionHash` (failed mined transactions) are forwarded so clients
  // behind the HTTP layer keep the full error information.
  if (typeof error?.code !== "number") {
    error = new InternalError(
      typeof error?.message === "string" ? error.message : "Internal error"
    );
  }

  const jsonError: any = {
    code: error.code,
    message: error.message,
  };
  if (error.data !== undefined) {
    jsonError.data = error.data;
  }
  if (typeof error.transactionHash === "string") {
    jsonError.transactionHash = error.transactionHash;
  }

  return {
    jsonrpc: "2.0",
    id: null,
    error: jsonError,
  };
};
