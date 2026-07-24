import { QrlProvider } from "@theqrl/hardhat/types";
import { EventEmitter } from "events";
import util from "util";

export interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class Web3HTTPProviderAdapter extends EventEmitter {
  private readonly _provider: QrlProvider;
  private readonly _supportsSubscriptions: boolean;
  private readonly _notificationListener: (notification: {
    subscription: string;
    result: any;
  }) => void;

  constructor(provider: QrlProvider, supportsSubscriptions = false) {
    super();
    this._provider = provider;
    this._supportsSubscriptions = supportsSubscriptions;
    this._notificationListener = (notification) => {
      this.emit("data", {
        jsonrpc: "2.0",
        method: "qrl_subscription",
        params: notification,
      });
    };

    if (this._supportsSubscriptions) {
      this._provider.on("notification", this._notificationListener);
    }

    // We bind everything here because some test suits break otherwise
    this.send = this.send.bind(this) as any;
    this.isConnected = this.isConnected.bind(this) as any;
    this.supportsSubscriptions = this.supportsSubscriptions.bind(this) as any;
    this.disconnect = this.disconnect.bind(this) as any;
    this._sendJsonRpcRequest = this._sendJsonRpcRequest.bind(this) as any;
  }

  public send(
    payload: JsonRpcRequest,
    callback: (error: Error | null, response?: JsonRpcResponse) => void
  ): void;
  public send(
    payload: JsonRpcRequest[],
    callback: (error: Error | null, response?: JsonRpcResponse[]) => void
  ): void;
  public send(
    payload: JsonRpcRequest | JsonRpcRequest[],
    callback: (error: Error | null, response?: any) => void
  ): void {
    if (!Array.isArray(payload)) {
      util.callbackify(() => this._sendJsonRpcRequest(payload))(callback);
      return;
    }

    util.callbackify(async () => {
      const responses: JsonRpcResponse[] = [];

      for (const request of payload) {
        const response = await this._sendJsonRpcRequest(request);
        responses.push(response);
      }

      return responses;
    })(callback);
  }

  public isConnected(): boolean {
    return true;
  }

  public supportsSubscriptions(): boolean {
    return this._supportsSubscriptions;
  }

  public disconnect(): boolean {
    if (this._supportsSubscriptions) {
      this._provider.removeListener("notification", this._notificationListener);
    }

    this.removeAllListeners();
    return true;
  }

  private async _sendJsonRpcRequest(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    const response: JsonRpcResponse = {
      id: request.id,
      jsonrpc: "2.0",
    };

    try {
      const result = await this._provider.send(request.method, request.params);
      response.result = result;
    } catch (error) {
      if (error.code === undefined) {
        throw error;
      }

      const code =
        typeof error.code === "number" ? error.code : Number(error.code);
      if (!Number.isFinite(code)) {
        throw error;
      }

      response.error = {
        code,
        message: error.message,
      };

      if (error.data !== undefined) {
        response.error.data = error.data;
      }
    }

    return response;
  }
}
