/**
 * Decoder for the compiler's instruction source maps (the solc-inherited
 * `s:l:f:j` format) and the pc → instruction-index mapping.
 */

export interface QrlSourceLocation {
  offset: number;
  length: number;
  sourceIndex: number;
}

/**
 * Decodes a source map string into one location per instruction. Entries are
 * `;`-separated; empty fields inherit the previous entry's value.
 */
export function decodeQrlSourceMap(sourceMap: string): QrlSourceLocation[] {
  const locations: QrlSourceLocation[] = [];
  let offset = 0;
  let length = 0;
  let sourceIndex = -1;

  for (const entry of sourceMap.split(";")) {
    const fields = entry.split(":");
    if (fields[0] !== undefined && fields[0] !== "") {
      offset = parseInt(fields[0], 10);
    }
    if (fields[1] !== undefined && fields[1] !== "") {
      length = parseInt(fields[1], 10);
    }
    if (fields[2] !== undefined && fields[2] !== "") {
      sourceIndex = parseInt(fields[2], 10);
    }
    locations.push({ offset, length, sourceIndex });
  }

  return locations;
}

/**
 * Maps every byte offset (pc) of the bytecode to its instruction index.
 *
 * QRL note: PUSH spans `0x60`-`0x9f` (PUSH1-64 for 512-bit words and 64-byte
 * addresses) — an Ethereum-style decoder that stops at 0x7f would
 * desynchronize on every address push.
 */
export function buildQrlPcToInstruction(bytecode: Uint8Array): number[] {
  const map = new Array<number>(bytecode.length).fill(-1);
  let instruction = 0;

  for (let pc = 0; pc < bytecode.length; ) {
    map[pc] = instruction;
    const opcode = bytecode[pc];
    pc += 1;
    if (opcode >= 0x60 && opcode <= 0x9f) {
      pc += opcode - 0x5f;
    }
    instruction += 1;
  }

  return map;
}

/** Converts a character offset in the source text to a 1-based line number. */
export function offsetToLine(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, source.length);
  for (let index = 0; index < end; index++) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}
