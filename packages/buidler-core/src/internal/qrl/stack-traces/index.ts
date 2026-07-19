import { loadQrlDebugInfo, QrlDebugInfo } from "./debug-info";
import { QrlStackTraceDecoder, QrlStackTraceEntry } from "./decoder";
import { inferQrlStackTrace } from "./error-inferrer";
import { QrlStackTraceDiagnostic, QrlStackTraceEntryType } from "./types";

export { inferQrlStackTrace, loadQrlDebugInfo, QrlStackTraceDecoder };
export {
  QrlDebugInfo,
  QrlStackTraceDiagnostic,
  QrlStackTraceEntry,
  QrlStackTraceEntryType,
};

/** Builds source-level Hyperion stack-trace lines for a failed frame tree. */
export async function buildQrlStackTraceLines(
  rootFrame: any,
  decoder: QrlStackTraceDecoder
): Promise<string[]> {
  const diagnostics = inferQrlStackTrace(rootFrame, decoder);
  const lines = diagnostics
    .map(formatDiagnostic)
    .filter((line): line is string => line !== undefined);
  const cause = formatInferredCause(diagnostics[0]);
  return cause === undefined
    ? lines
    : [["  Error: ", cause].join(""), ...lines];
}

function formatInferredCause(
  diagnostic: QrlStackTraceDiagnostic | undefined
): string | undefined {
  if (diagnostic === undefined) {
    return undefined;
  }
  switch (diagnostic.type) {
    case QrlStackTraceEntryType.PRECOMPILE_ERROR:
      return [
        "call to precompile ",
        diagnostic.precompile ?? "unknown",
        " failed",
      ].join("");
    case QrlStackTraceEntryType.FUNCTION_NOT_PAYABLE_ERROR:
      return [
        "non-payable function was called with value ",
        String(diagnostic.value),
      ].join("");
    case QrlStackTraceEntryType.INVALID_PARAMS_ERROR:
      return "function was called with incorrect parameters";
    case QrlStackTraceEntryType.FALLBACK_NOT_PAYABLE_ERROR:
      return [
        "fallback function is not payable and was called with value ",
        String(diagnostic.value),
      ].join("");
    case QrlStackTraceEntryType.UNRECOGNIZED_FUNCTION_WITHOUT_FALLBACK_ERROR:
      return "function selector was not recognized and there is no fallback function";
    case QrlStackTraceEntryType.RETURNDATA_SIZE_ERROR:
      return "function returned an unexpected amount of data";
    case QrlStackTraceEntryType.NONCONTRACT_ACCOUNT_CALLED_ERROR:
      return "function call targeted a non-contract account";
    case QrlStackTraceEntryType.CALL_FAILED_ERROR:
      return "function call failed to execute";
    case QrlStackTraceEntryType.DIRECT_LIBRARY_CALL_ERROR:
      return "library was called directly";
    case QrlStackTraceEntryType.OTHER_EXECUTION_ERROR:
      return "execution failed for an unrecognized reason";
    default:
      return undefined;
  }
}

function formatDiagnostic(
  diagnostic: QrlStackTraceDiagnostic
): string | undefined {
  const source = diagnostic.sourceReference;
  if (source !== undefined) {
    return `  at ${source.contractName}.${source.functionName} (${source.sourceName}:${source.line})`;
  }

  switch (diagnostic.type) {
    case QrlStackTraceEntryType.PRECOMPILE_ERROR:
      return `  at <precompile> (${diagnostic.precompile ?? "unknown"})`;
    case QrlStackTraceEntryType.UNRECOGNIZED_CREATE_ERROR:
    case QrlStackTraceEntryType.UNRECOGNIZED_CREATE_CALLSTACK_ENTRY:
      return "  at <UnrecognizedContract>.constructor";
    case QrlStackTraceEntryType.UNRECOGNIZED_CONTRACT_ERROR:
    case QrlStackTraceEntryType.UNRECOGNIZED_CONTRACT_CALLSTACK_ENTRY:
      return `  at <UnrecognizedContract> (${diagnostic.address ?? "unknown"})`;
    default:
      return undefined;
  }
}
