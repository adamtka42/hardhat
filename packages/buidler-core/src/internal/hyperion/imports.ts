import debug from "debug";

const log = debug("buidler:core:hyperion:imports");

/**
 * Extracts the import paths of a Hyperion source file.
 *
 * The primary implementation is a small lexer that understands just enough
 * of the language to skip line comments, block comments, and string
 * literals — so text that merely LOOKS like an import inside those never
 * becomes a dependency (a phantom dependency breaks cache checking and
 * flattening). There is no JavaScript parser for Hyperion; the compiler's
 * AST is only available AFTER a successful compilation, while imports are
 * needed to build the dependency graph BEFORE it. Hence a lexer, not a
 * parser — and per the plan, one shared implementation instead of several
 * ad-hoc regular expressions.
 *
 * The legacy regex extractor is kept strictly as a fallback for lexer
 * failures and logs when it is used.
 */
export function getImports(fileContent: string): string[] {
  try {
    return getImportDirectives(fileContent).map((directive) => directive.path);
  } catch (error) {
    log(
      `import lexer failed (${
        (error as Error).message
      }); falling back to regex extraction`
    );
    return findImportsWithRegexps(fileContent);
  }
}

export interface ImportDirective {
  path: string;
  /** Offset of the `import` keyword. */
  start: number;
  /** Offset just past the directive's terminating semicolon. */
  end: number;
}

/**
 * Full import directives with their exact source ranges, so consumers like
 * `hardhat flatten` can remove PRECISELY the directive — multi-line imports
 * included — without touching surrounding code on the same line.
 */
export function getImportDirectives(source: string): ImportDirective[] {
  const directives: ImportDirective[] = [];
  let position = 0;

  while (position < source.length) {
    const char = source[position];

    if (char === "/" && source[position + 1] === "/") {
      position = skipLineComment(source, position);
      continue;
    }

    if (char === "/" && source[position + 1] === "*") {
      position = skipBlockComment(source, position);
      continue;
    }

    if (char === '"' || char === "'") {
      position = skipStringLiteral(source, position);
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = position;
      while (position < source.length && isIdentifierPart(source[position])) {
        position++;
      }

      if (source.slice(start, position) === "import") {
        const directive = readImportDirective(source, position);
        position = directive.position;
        if (directive.path !== undefined) {
          directives.push({
            path: directive.path,
            start,
            end: directive.position,
          });
        }
      }
      continue;
    }

    position++;
  }

  return directives;
}

/**
 * Reads one import directive starting right after the `import` keyword.
 * Two forms are recognized, both tolerant of interleaved comments:
 *
 *   import "path";  /  import "path" as X;
 *   import <anything but a string or ';'> from "path";
 *
 * Anything else (e.g. `import` used in free text of invalid code) yields no
 * path; scanning resumes after the keyword so later valid imports are still
 * found — the extractor stays permissive on malformed sources, like the
 * regex it replaces.
 */
function readImportDirective(
  source: string,
  startPosition: number
): { path?: string; position: number } {
  let position = startPosition;

  while (position < source.length) {
    const char = source[position];

    if (char === "/" && source[position + 1] === "/") {
      position = skipLineComment(source, position);
      continue;
    }

    if (char === "/" && source[position + 1] === "*") {
      position = skipBlockComment(source, position);
      continue;
    }

    if (char === '"' || char === "'") {
      // The first string literal of the directive is the import path, both
      // in the global form and after `from`. hypc decodes escapes in the
      // path (e.g. `"./A\x2ehyp"` means `./A.hyp`), so the extractor must
      // decode them identically or the resolver looks up a wrong file.
      const end = skipStringLiteral(source, position);
      const path = decodeStringLiteral(source.slice(position + 1, end - 1));
      return { path, position: skipToSemicolon(source, end) };
    }

    if (char === ";") {
      // Directive ended without a path (malformed) — no import.
      return { position: position + 1 };
    }

    position++;
  }

  return { position };
}

// Line terminators recognized by the Hyperion scanner: LF, CR, VT, FF,
// NEL, LS, PS.
function isLineTerminator(char: string): boolean {
  return (
    char === "\n" ||
    char === "\r" ||
    char === "\u000b" ||
    char === "\u000c" ||
    char === "\u0085" ||
    char === "\u2028" ||
    char === "\u2029"
  );
}

function skipLineComment(source: string, position: number): number {
  while (position < source.length && !isLineTerminator(source[position])) {
    position++;
  }
  return position;
}

function skipBlockComment(source: string, position: number): number {
  position += 2;
  while (position < source.length) {
    if (source[position] === "*" && source[position + 1] === "/") {
      return position + 2;
    }
    position++;
  }
  // Unterminated block comment: nothing after it is code.
  return position;
}

/**
 * Length of the escape sequence starting at `position` (which must point at
 * the backslash), backslash included. SHARED by string skipping and path
 * decoding so the two can never disagree about where a string ends. A CRLF
 * line continuation is ONE terminator: backslash + CR + LF = 3 characters.
 */
function escapeSequenceLength(source: string, position: number): number {
  const next = source[position + 1];
  if (next === undefined) {
    return 1;
  }
  if (next === "x") {
    return 4;
  }
  if (next === "u") {
    return 6;
  }
  if (next === "\r" && source[position + 2] === "\n") {
    return 3;
  }
  return 2;
}

function skipStringLiteral(source: string, position: number): number {
  const quote = source[position];
  position++;
  while (position < source.length) {
    const char = source[position];
    if (char === "\\") {
      position += escapeSequenceLength(source, position);
      continue;
    }
    if (char === quote || isLineTerminator(char)) {
      // Hyperion string literals do not span lines; treat a line terminator
      // as the (malformed) end so the rest of the file is still scanned.
      return position + 1;
    }
    position++;
  }
  return position;
}

// The trailing `; ` of a directive must be found with the SAME lexical
// rules as everything else — a semicolon inside a comment or string after
// the path must not terminate the directive (or worse, leave the main scan
// positioned inside a comment).
function skipToSemicolon(source: string, position: number): number {
  while (position < source.length) {
    const char = source[position];

    if (char === "/" && source[position + 1] === "/") {
      position = skipLineComment(source, position);
      continue;
    }

    if (char === "/" && source[position + 1] === "*") {
      position = skipBlockComment(source, position);
      continue;
    }

    if (char === '"' || char === "'") {
      position = skipStringLiteral(source, position);
      continue;
    }

    if (char === ";") {
      return position + 1;
    }

    position++;
  }

  return position;
}

// Decodes the escape sequences the Hyperion scanner supports in string
// literals (Scanner::scanEscape): \\ \' \" \n \r \t, \xNN, \uNNNN, and an
// escaped line terminator (line continuation, contributing nothing — CRLF
// counts as ONE terminator). Unknown escapes keep the character verbatim,
// mirroring lenient scanning. Advancement uses the SAME helper as string
// skipping, so the two can never disagree.
//
// The decoder accumulates BYTES, exactly like the scanner: \xNN contributes
// one raw byte (so `"\xC3\xA9"` is the UTF-8 sequence for `é`), while
// plain characters and \uNNNN code points contribute their UTF-8 bytes.
function decodeStringLiteral(raw: string): string {
  const bytes: number[] = [];
  let position = 0;

  const pushUtf8 = (text: string) => {
    for (const byte of Buffer.from(text, "utf8")) {
      bytes.push(byte);
    }
  };

  while (position < raw.length) {
    const char = raw[position];
    if (char !== "\\") {
      pushUtf8(char);
      position++;
      continue;
    }

    const length = escapeSequenceLength(raw, position);
    const next = raw[position + 1];

    if (next === "x") {
      // A raw byte, NOT a code point: multi-byte characters arrive as
      // consecutive \xNN escapes forming a UTF-8 sequence.
      bytes.push(parseInt(raw.slice(position + 2, position + length), 16));
    } else if (next === "u") {
      pushUtf8(
        String.fromCharCode(
          parseInt(raw.slice(position + 2, position + length), 16)
        )
      );
    } else if (next !== undefined && !isLineTerminator(next)) {
      const simple: { [key: string]: string } = {
        '"': '"',
        "'": "'",
        "\\": "\\",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      pushUtf8(simple[next] ?? next);
    } else if (next === undefined) {
      pushUtf8(char);
    }
    // Line continuations (incl. CRLF) contribute nothing.

    position += length;
  }

  return Buffer.from(bytes).toString("utf8");
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

// Legacy extractor, kept only as the lexer's fallback.
function findImportsWithRegexps(fileContent: string): string[] {
  const importsRegexp: RegExp = /import\s+(?:(?:"([^;]*)"|'([^;]*)')(?:;|\s+as\s+[^;]*;)|.+from\s+(?:"(.*)"|'(.*)');)/g;

  let imports: string[] = [];
  let result: RegExpExecArray | null;

  while (true) {
    result = importsRegexp.exec(fileContent);
    if (result === null) {
      return imports;
    }

    imports = [
      ...imports,
      ...result.slice(1).filter((m: any) => m !== undefined),
    ];
  }
}
