import { InvalidArgumentsError, MethodNotFoundError } from "../errors";
import { rpcAddress, validateParams } from "../input";
import { HardhatNode, MineBlockOptions } from "../node";
import { bufferToRpcData, numberToRpcQuantity } from "../output";

export interface EvmModuleConfig {
  addressFromBytes: (value: Uint8Array) => any;
}

// tslint:disable only-hardhat-error

export class EvmModule {
  constructor(
    private readonly _node: HardhatNode,
    private readonly _config: EvmModuleConfig
  ) {}

  public async processRequest(
    method: string,
    params: any[] = []
  ): Promise<any> {
    switch (method) {
      case "qrl_increaseTime":
        return this._increaseTimeAction(...this._increaseTimeParams(params));

      case "qrl_setNextBlockTimestamp":
        return this._setNextBlockTimestampAction(
          ...this._setNextBlockTimestampParams(params)
        );

      case "qrl_mine":
        return this._mineAction(...this._mineParams(params));

      case "qrl_revert":
        return this._revertAction(...this._revertParams(params));

      case "qrl_snapshot":
        return this._snapshotAction(...this._snapshotParams(params));
    }

    throw new MethodNotFoundError(`Method ${method} not found`);
  }

  // qrl_setNextBlockTimestamp

  private _setNextBlockTimestampParams(params: any[]): [bigint] {
    return [parseSingleQuantity(params, "timestamp")];
  }

  private async _setNextBlockTimestampAction(
    timestamp: bigint
  ): Promise<string> {
    try {
      await this._node.setNextBlockTimestamp(timestamp);
    } catch (error) {
      throw new InvalidArgumentsError((error as Error).message);
    }
    return timestamp.toString();
  }

  // qrl_increaseTime

  private _increaseTimeParams(params: any[]): [bigint] {
    return [parseSingleQuantity(params, "seconds")];
  }

  private async _increaseTimeAction(increment: bigint): Promise<string> {
    try {
      return (await this._node.increaseTime(increment)).toString();
    } catch (error) {
      throw new InvalidArgumentsError((error as Error).message);
    }
  }

  // qrl_mine

  private _mineParams(params: any[]): [MineBlockOptions] {
    if (params.length > 1) {
      throw new InvalidArgumentsError(
        "qrl_mine expects at most one options object"
      );
    }
    if (params.length === 0 || params[0] === undefined) {
      return [{}];
    }
    const options = params[0];
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options)
    ) {
      throw new InvalidArgumentsError("qrl_mine options must be an object");
    }

    return [
      {
        timestamp: parseOptionalQuantity(options.timestamp, "timestamp"),
        gasLimit: parseOptionalQuantity(options.gasLimit, "gasLimit"),
        baseFee: parseOptionalQuantity(options.baseFee, "baseFee"),
        coinbase:
          options.coinbase === undefined
            ? undefined
            : this._config.addressFromBytes(
                validateParams([options.coinbase], rpcAddress)[0]
              ),
      },
    ];
  }

  private async _mineAction(options: MineBlockOptions): Promise<string> {
    const block = await this._node.mineBlock(options);
    return bufferToRpcData(block.hash());
  }

  // qrl_revert

  private _revertParams(params: any[]): [bigint] {
    return [parseSingleQuantity(params, "snapshot id")];
  }

  private async _revertAction(snapshotId: bigint): Promise<boolean> {
    return this._node.revertToSnapshot(snapshotId);
  }

  // qrl_snapshot

  private _snapshotParams(params: any[]): [] {
    return validateParams(params);
  }

  private async _snapshotAction(): Promise<string> {
    return numberToRpcQuantity(await this._node.takeSnapshot());
  }
}

function parseSingleQuantity(params: any[], name: string): bigint {
  if (params.length !== 1) {
    throw new InvalidArgumentsError(`Expected one ${name} argument`);
  }
  return parseQrlControlQuantity(params[0], name);
}

function parseOptionalQuantity(
  value: unknown,
  name: string
): bigint | undefined {
  return value === undefined ? undefined : parseQrlControlQuantity(value, name);
}

function parseQrlControlQuantity(value: unknown, name: string): bigint {
  if (typeof value === "bigint") {
    // tslint:disable-next-line:strict-comparisons
    if (value >= (global as any).BigInt(0)) {
      return value;
    }
  } else if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) {
      return (global as any).BigInt(value);
    }
  } else if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(value) || /^[0-9]+$/.test(value)) {
      return (global as any).BigInt(value);
    }
  }

  throw new InvalidArgumentsError(
    `QRL ${name} must be a non-negative integer or quantity`
  );
}
