import { assert } from "chai";

import { getImports } from "../../../src/internal/hyperion/imports";

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
});
