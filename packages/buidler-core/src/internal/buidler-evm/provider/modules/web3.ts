import { keccak_256 } from "js-sha3";

import { MethodNotFoundError } from "../errors";
import { rpcData, validateParams } from "../input";
import { bufferToRpcData } from "../output";

const QRL_CLIENT_VERSION = "QRLLocalProvider/qrljs";

// tslint:disable only-hardhat-error

export class Web3Module {
  public async processRequest(
    method: string,
    params: any[] = []
  ): Promise<any> {
    switch (method) {
      case "web3_clientVersion":
        return this._clientVersionAction(...this._clientVersionParams(params));

      case "web3_sha3":
        return this._sha3Action(...this._sha3Params(params));
    }

    throw new MethodNotFoundError(`Method ${method} not found`);
  }

  // web3_clientVersion

  private _clientVersionParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _clientVersionAction(): Promise<string> {
    return QRL_CLIENT_VERSION;
  }

  // web3_sha3

  private _sha3Params(params: any[]): [Uint8Array] {
    return validateParams(params, rpcData);
  }

  private async _sha3Action(buffer: Uint8Array): Promise<string> {
    return bufferToRpcData(new Uint8Array(keccak_256.arrayBuffer(buffer)));
  }
}
