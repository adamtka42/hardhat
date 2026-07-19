import { assert } from "chai";
import fsExtra from "fs-extra";
import path from "path";

interface FixtureEntry {
  id: string;
  baselinePath: string;
  classification: string;
  reason: string;
  expectedTypes: string[];
  coverage: string[];
}

describe("QRL stack trace fixture manifest", function () {
  const manifest = fsExtra.readJsonSync(
    path.join(__dirname, "fixtures-manifest.json")
  );
  const fixtures: FixtureEntry[] = manifest.fixtures;

  it("classifies the complete 142-scenario baseline inventory", function () {
    assert.equal(manifest.baseline.total, 142);
    assert.deepEqual(manifest.baseline.categoryCounts, {
      "call-message": 65,
      "console-logs": 26,
      "create-message": 50,
      "special-cases": 1,
    });
    assert.lengthOf(fixtures, 142);
    assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, 142);
    assert.equal(
      new Set(fixtures.map((fixture) => fixture.baselinePath)).size,
      142
    );
  });

  it("records a reason and concrete regression reference for every fixture", function () {
    for (const fixture of fixtures) {
      assert.include(
        manifest.classifications,
        fixture.classification,
        fixture.id
      );
      assert.isAbove(fixture.reason.trim().length, 0, fixture.id);
      assert.isAbove(fixture.coverage.length, 0, fixture.id);
      for (const reference of fixture.coverage) {
        assert.match(reference, /test\//, fixture.id);
      }
      if (fixture.classification === "eth-only") {
        assert.match(fixture.reason, /ETH|Ethereum|solc/i, fixture.id);
      }
    }
  });

  it("maps version-split and console fixtures to explicit QRL replacements", function () {
    const versionSplit = fixtures.filter((fixture) =>
      fixture.id.includes("/solc-")
    );
    assert.lengthOf(versionSplit, 6);
    assert.isTrue(
      versionSplit.every(
        (fixture) => fixture.classification === "qrl-specific-replacement"
      )
    );

    const consoleFixtures = fixtures.filter((fixture) =>
      fixture.id.startsWith("console-logs/")
    );
    assert.lengthOf(consoleFixtures, 26);
    assert.isTrue(
      consoleFixtures.every(
        (fixture) =>
          fixture.classification === "qrl-applicable" ||
          fixture.classification === "replaced-with-reference"
      )
    );
  });
});
