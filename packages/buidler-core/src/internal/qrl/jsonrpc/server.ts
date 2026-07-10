import debug from "debug";
import http, { Server } from "http";
import { Server as WSServer } from "ws";

import { IQrlProvider } from "../../../types";
import { HttpProvider } from "../../core/providers/http";

import JsonRpcHandler from "./handler";

const log = debug("buidler:core:qrl:jsonrpc");

export interface JsonRpcServerConfig {
  hostname: string;
  port: number;

  provider: IQrlProvider;
  loggingEnabled?: boolean;
}

export class JsonRpcServer {
  private _config: JsonRpcServerConfig;
  private _httpServer: Server;
  private _wsServer: WSServer;

  constructor(config: JsonRpcServerConfig) {
    this._config = config;

    const handler = new JsonRpcHandler(
      config.provider,
      config.loggingEnabled ?? true
    );

    this._httpServer = http.createServer();
    this._wsServer = new WSServer({
      server: this._httpServer,
    });

    this._httpServer.on("request", handler.handleHttp);
    this._wsServer.on("connection", handler.handleWs);
  }

  public getProvider = (name = "json-rpc"): IQrlProvider => {
    const { address, port } = this._httpServer.address() as {
      address: string;
      port: number;
    };

    return new HttpProvider(`http://${formatHost(address)}:${port}/`, name);
  };

  public listen = (): Promise<{ address: string; port: number }> => {
    return new Promise((resolve, reject) => {
      log(`Starting JSON-RPC server on port ${this._config.port}`);
      // Bind failures (e.g. EADDRINUSE) are emitted as server errors and
      // must reject instead of leaving the promise pending forever.
      this._httpServer.once("error", reject);
      this._httpServer.listen(this._config.port, this._config.hostname, () => {
        this._httpServer.removeListener("error", reject);
        // The actual address and port come from the server itself to
        // support random port allocation with port `0`.
        const { address, port } = this._httpServer.address() as {
          address: string;
          port: number;
        };
        resolve({ address: formatHost(address), port });
      });
    });
  };

  public waitUntilClosed = async () => {
    const httpServerClosed = new Promise((resolve) => {
      this._httpServer.once("close", resolve);
    });

    const wsServerClosed = new Promise((resolve) => {
      this._wsServer.once("close", resolve);
    });

    return Promise.all([httpServerClosed, wsServerClosed]);
  };

  public close = async () => {
    return Promise.all([
      new Promise((resolve, reject) => {
        log("Closing JSON-RPC server");
        this._httpServer.close((err) => {
          if (err !== null && err !== undefined) {
            log("Failed to close JSON-RPC server");
            reject(err);
            return;
          }

          log("JSON-RPC server closed");
          resolve(undefined);
        });
      }),
      new Promise((resolve, reject) => {
        log("Closing websocket server");
        this._wsServer.close((err) => {
          if (err !== null && err !== undefined) {
            log("Failed to close websocket server");
            reject(err);
            return;
          }

          log("Websocket server closed");
          resolve(undefined);
        });
      }),
    ]);
  };
}

/** Brackets IPv6 addresses so they are valid inside URLs. */
export function formatHost(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}
