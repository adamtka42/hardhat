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

  it("keeps sources only for the 120 executable QRL fixtures", function () {
    const fixtureRoot = path.join(__dirname, "test-files");
    const executable = fixtures.filter(
      (fixture) =>
        fixture.classification === "qrl-applicable" ||
        fixture.classification === "qrl-specific-replacement"
    );
    assert.lengthOf(executable, 120);
    for (const fixture of executable) {
      const directory = path.join(fixtureRoot, fixture.id);
      assert.isTrue(fsExtra.pathExistsSync(directory), fixture.id);
      assert.isTrue(
        fsExtra.pathExistsSync(path.join(directory, "test.json")),
        fixture.id
      );
      assert.isAbove(
        fsExtra.readdirSync(directory).filter((name) => name.endsWith(".hyp"))
          .length,
        0,
        fixture.id
      );
      assert.deepEqual(fixture.coverage, [
        `test/internal/qrl/stack-traces/fixtures.ts :: ${fixture.id}`,
      ]);
    }

    const excluded = fixtures.filter(
      (fixture) => !executable.includes(fixture)
    );
    assert.lengthOf(excluded, 22);
    for (const fixture of excluded) {
      assert.isFalse(
        fsExtra.pathExistsSync(path.join(fixtureRoot, fixture.id)),
        fixture.id
      );
    }
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
