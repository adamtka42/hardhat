import { assert } from "chai";

import {
  getImportDirectives,
  getImports,
} from "../../../src/internal/hyperion/imports";

describe("Imports extractor", () => {
  it("should work with global imports", () => {
    const imports = getImports(`
import "./asd.hyp";
pragma experimental v0.5.0;
import "lib/asd.hyp";
  `);

    assert.deepEqual(imports, ["./asd.hyp", "lib/asd.hyp"]);
  });

  it("should work with star imports", () => {
    const imports = getImports(`
import * as from "./asd.hyp";
pragma experimental v0.5.0;
import * as from "lib/asd.hyp";
  `);

    assert.deepEqual(imports, ["./asd.hyp", "lib/asd.hyp"]);
  });

  it("should work with selective imports", () => {
    const imports = getImports(`
import {symbol1} from "./asd.hyp";
pragma experimental v0.5.0;
import {symbol1, symbol2} as from "lib/asd.hyp";
  `);

    assert.deepEqual(imports, ["./asd.hyp", "lib/asd.hyp"]);
  });

  it("should work with aliased imports", () => {
    const imports = getImports(`
import {symbol1 as s1} as from "./asd.hyp";
pragma experimental v0.5.0;
import {symbol1 as s1, symbol2} as from "lib/asd.hyp";
  `);

    assert.deepEqual(imports, ["./asd.hyp", "lib/asd.hyp"]);
  });

  it("If the syntax is invalid but there's still some valid imports' they should be returned", () => {
    const imports = getImports(`
    asd
import "./asd.hyp";
fgh {;

(

import "./1.hyp";
            address a,
            uint256 b,
            bytes memory a
        ) = []
      
    `);

    assert.deepEqual(imports, ["./asd.hyp", "./1.hyp"]);
  });

  it("Should work when the parser doesn't detect some invalid syntax and the visitor breaks", () => {
    const imports = getImports(`
      import "a.hyp";

      contract C {
        fallback () function {

        }
      }
    `);

    assert.deepEqual(imports, ["a.hyp"]);
  });

  // Target-state cases for F10.1 (lexer-based extraction): text that only
  // LOOKS like an import — inside comments or string literals — must not
  // produce dependencies. The regex-only extractor fails all of these.
  it("ignores imports inside line comments", () => {
    assert.deepEqual(
      getImports(`
        // import "./Phantom.hyp";
        import "./Real.hyp";
      `),
      ["./Real.hyp"]
    );
  });

  it("ignores imports inside block comments", () => {
    assert.deepEqual(
      getImports(`
        /* import "./Phantom.hyp"; */
        import "./Real.hyp";
        /*
        import "./PhantomMultiline.hyp";
        */
      `),
      ["./Real.hyp"]
    );
  });

  it("ignores imports inside string literals", () => {
    assert.deepEqual(
      getImports(`
        import "./Real.hyp";
        contract C {
          string constant A = 'import "./Phantom.hyp";';
          string constant B = "import './Phantom2.hyp';";
        }
      `),
      ["./Real.hyp"]
    );
  });

  it("still extracts an import that follows a comment on the same line", () => {
    assert.deepEqual(
      getImports(`/* header */ import "./Real.hyp"; // trailing`),
      ["./Real.hyp"]
    );
  });

  it("ignores comment content between the path and the semicolon", () => {
    assert.deepEqual(
      getImports(`import "./Real.hyp" /* ; import "./Phantom.hyp"; */;`),
      ["./Real.hyp"]
    );
    assert.deepEqual(
      getImports(`import "./Real.hyp" // ; import "./Phantom.hyp"\n;`),
      ["./Real.hyp"]
    );
  });

  it("reports exact directive ranges, multi-line and same-line included", () => {
    const source = `import {\n  A\n} from "./A.hyp"; contract B {}`;
    const [directive] = getImportDirectives(source);

    assert.equal(
      source.slice(directive.start, directive.end),
      `import {\n  A\n} from "./A.hyp";`
    );
    assert.equal(source.slice(directive.end), " contract B {}");
  });

  it("decodes escape sequences in import paths like the Hyperion scanner", () => {
    // \x2e === "." — hypc decodes it, so the extractor must too, or the
    // resolver looks up a nonexistent file.
    assert.deepEqual(getImports(String.raw`import "./A\x2ehyp";`), ["./A.hyp"]);
    assert.deepEqual(getImports(String.raw`import "./A\u002ehyp";`), [
      "./A.hyp",
    ]);
    // Line continuation contributes nothing to the path — including a CRLF
    // terminator, which counts as ONE terminator (backslash + CR + LF).
    assert.deepEqual(getImports('import "./A\\\n.hyp";'), ["./A.hyp"]);
    const crlfSource = 'import "./A\\\r\n.hyp"; contract C {}';
    assert.deepEqual(getImports(crlfSource), ["./A.hyp"]);
    const [crlfDirective] = getImportDirectives(crlfSource);
    assert.equal(crlfSource.slice(crlfDirective.end), " contract C {}");
    // \xNN escapes are raw BYTES, not code points: consecutive escapes
    // form a UTF-8 sequence (Scanner::scanEscape parity).
    assert.deepEqual(getImports(String.raw`import "./\xC3\xA9.hyp";`), [
      "./\u00e9.hyp",
    ]);
    // \uNNNN is a code point contributing its UTF-8 bytes.
    assert.deepEqual(getImports(String.raw`import "./\u00e9.hyp";`), [
      "./\u00e9.hyp",
    ]);
    // Simple escapes.
    assert.deepEqual(getImports(String.raw`import "a\\b\'c.hyp";`), [
      "a\\b'c.hyp",
    ]);
  });

  it("recognizes every Hyperion line terminator", () => {
    // CR-terminated line comment (reviewer repro): the import after \r is
    // real code.
    assert.deepEqual(getImports('// comment\rimport "./A.hyp";'), ["./A.hyp"]);
    for (const terminator of [
      "\u000b",
      "\u000c",
      "\u0085",
      "\u2028",
      "\u2029",
    ]) {
      assert.deepEqual(
        getImports(`// comment${terminator}import "./A.hyp";`),
        ["./A.hyp"],
        `terminator ${terminator.charCodeAt(0)}`
      );
    }
  });
});
