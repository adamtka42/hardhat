export type Block = any;

type Callback<ResultT = void> = (error: Error | null, result?: ResultT) => void;

export class Blockchain {
  private readonly _blocks: Block[] = [];
  private readonly _blockNumberByHash: Map<string, number> = new Map();

  public getLatestBlock(callback: Callback<Block>): void {
    if (this._blocks.length === 0) {
      callback(new Error("No block available"));
      return;
    }

    callback(null, this._blocks[this._blocks.length - 1]);
  }

  public putBlock(block: Block, callback: Callback<Block>): void {
    const blockNumber = blockNumberToIndex(block.header.number);

    if (this._blocks.length !== blockNumber) {
      callback(new Error("Invalid block number"));
      return;
    }

    this._blocks.push(block);
    this._blockNumberByHash.set(blockHashKey(block.hash()), blockNumber);

    callback(null, block);
  }

  public delBlock(blockHash: Uint8Array, callback: Callback): void {
    const blockNumber = this._blockNumberByHash.get(blockHashKey(blockHash));

    if (blockNumber === undefined) {
      callback(new Error("Block not found"));
      return;
    }

    this._deleteFrom(blockNumber);
    callback(null);
  }

  public getBlock(
    hashOrBlockNumber: Uint8Array | bigint,
    callback: Callback<Block>
  ): void {
    let blockNumber: number;

    if (typeof hashOrBlockNumber === "bigint") {
      blockNumber = blockNumberToIndex(hashOrBlockNumber);
    } else {
      const hash = blockHashKey(hashOrBlockNumber);
      const indexedBlockNumber = this._blockNumberByHash.get(hash);

      if (indexedBlockNumber === undefined) {
        callback(new Error("Block not found"));
        return;
      }

      blockNumber = indexedBlockNumber;
    }

    callback(null, this._blocks[blockNumber]);
  }

  public iterator(
    _name: string,
    onBlock: (
      block: Block,
      reorg: boolean,
      callback: (error?: Error | null) => void
    ) => void,
    callback: Callback
  ): void {
    let blockNumber = 0;

    const iterate = (error?: Error | null) => {
      if (error !== null && error !== undefined) {
        callback(error);
        return;
      }

      if (blockNumber >= this._blocks.length) {
        callback(null);
        return;
      }

      onBlock(
        this._blocks[blockNumber],
        false,
        (onBlockError?: Error | null) => {
          blockNumber += 1;
          iterate(onBlockError);
        }
      );
    };

    iterate(null);
  }

  public getDetails(_name: string, callback: Callback): void {
    callback(null);
  }

  public deleteAllFollowingBlocks(block: Block): void {
    const blockNumber = blockNumberToIndex(block.header.number);
    const actualBlock = this._blocks[blockNumber];

    if (
      actualBlock === undefined ||
      !bytesEqual(block.hash(), actualBlock.hash())
    ) {
      // tslint:disable-next-line only-hardhat-error
      throw new Error("Invalid block");
    }

    this._deleteFrom(blockNumber + 1);
  }

  private _deleteFrom(blockNumber: number): void {
    for (let index = blockNumber; index < this._blocks.length; index++) {
      this._blockNumberByHash.delete(blockHashKey(this._blocks[index].hash()));
    }
    this._blocks.splice(blockNumber);
  }
}

function blockNumberToIndex(blockNumber: bigint): number {
  const index = Number(blockNumber);
  if (!Number.isSafeInteger(index) || index < 0) {
    // tslint:disable-next-line only-hardhat-error
    throw new Error(`Invalid block number ${blockNumber.toString()}`);
  }
  return index;
}

function blockHashKey(hash: Uint8Array): string {
  return Buffer.from(hash).toString("hex").toLowerCase();
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
