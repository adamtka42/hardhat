import { MethodNotFoundError } from "../errors";
import { validateParams } from "../input";
import { HardhatNode } from "../node";

// tslint:disable only-hardhat-error

export class BuidlerModule {
  constructor(private readonly _node: HardhatNode) {}

  public async processRequest(
    method: string,
    params: any[] = []
  ): Promise<any> {
    switch (method) {
      case "qrl_getStackTraceFailuresCount":
        return this._getStackTraceFailuresCountAction(
          ...this._getStackTraceFailuresCountParams(params)
        );
    }

    throw new MethodNotFoundError(`Method ${method} not found`);
  }

  // qrl_getStackTraceFailuresCount

  private _getStackTraceFailuresCountParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _getStackTraceFailuresCountAction(): Promise<number> {
    return this._node.getStackTraceFailuresCount();
  }
}
