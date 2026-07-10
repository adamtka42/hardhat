import { loadQrlDebugInfo, QrlDebugInfo } from "./debug-info";
import { QrlStackTraceDecoder, QrlStackTraceEntry } from "./decoder";

export { loadQrlDebugInfo, QrlStackTraceDecoder };
export { QrlDebugInfo, QrlStackTraceEntry };

/**
 * Builds the `  at Contract.function (source:line)` lines for a failed
 * execution from the call tree returned by the local provider's frame
 * tracer. Follows the failing spine (innermost frame first) and silently
 * skips frames that cannot be decoded.
 */
export async function buildQrlStackTraceLines(
  rootFrame: any,
  decoder: QrlStackTraceDecoder,
  getCode: (address: string) => Promise<string>
): Promise<string[]> {
  if (rootFrame === undefined || rootFrame.errorMessage === undefined) {
    return [];
  }

  // Failing spine: from the root, keep descending into the last child whose
  // failure PROPAGATED — i.e. whose revert payload equals the parent's
  // (Hyperion bubbles nested failures by re-reverting with the child's
  // returndata). A handled nested failure has a different parent payload
  // and must not be blamed for the parent's own revert.
  const spine: any[] = [];
  let current: any = rootFrame;
  while (current !== undefined) {
    spine.push(current);
    const failingChildren = (current.children ?? []).filter(
      (child: any) =>
        child.errorMessage !== undefined &&
        bytesEqual(child.returnValue, current.returnValue)
    );
    current = failingChildren[failingChildren.length - 1];
  }

  const lines: string[] = [];
  // Innermost frame first, like a conventional stack trace.
  for (const frame of spine.reverse()) {
    const isCreate = frame.kind === "create" || frame.kind === "create2";
    if (typeof frame.lastPc !== "number") {
      continue;
    }

    let code: string;
    if (isCreate) {
      code = bytesToHex(frame.input);
    } else {
      if (frame.target === undefined) {
        continue;
      }
      code = await getCode(frame.target.toString());
    }

    const entry = decoder.decodeFrame(code, frame.lastPc, isCreate);
    if (entry === undefined) {
      continue;
    }

    lines.push(
      `  at ${entry.contractName}.${entry.functionName} (${entry.sourceName}:${entry.line})`
    );
  }

  return lines;
}

function bytesToHex(bytes: Uint8Array | undefined): string {
  if (bytes === undefined) {
    return "";
  }
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function bytesEqual(
  a: Uint8Array | undefined,
  b: Uint8Array | undefined
): boolean {
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
