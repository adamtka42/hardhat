import { assert } from "chai";

import { TASK_FLATTEN_GET_FLATTENED_SOURCE } from "../../src/builtin-tasks/task-names";
import { useEnvironment } from "../helpers/environment";
import { useFixtureProject } from "../helpers/project";

function getContractsOrder(flattenedFiles: string) {
  const CONTRACT_REGEX = /\s*contract(\s+)(\w)/gm;
  const matches = flattenedFiles.match(CONTRACT_REGEX);

  return matches!.map((m: string) => m.replace("contract", "").trim());
}

describe("Flatten task", () => {
  useEnvironment();

  describe("When there no contracts", function () {
    useFixtureProject("default-config-project");

    it("should return empty string", async function () {
      const flattenedFiles = await this.env.run(
        TASK_FLATTEN_GET_FLATTENED_SOURCE
      );

      assert.equal(flattenedFiles.length, 0);
    });
  });

  describe("When has contracts", function () {
    useFixtureProject("contracts-project");

    it("should flatten files sorted correctly", async function () {
      const flattenedFiles = await this.env.run(
        TASK_FLATTEN_GET_FLATTENED_SOURCE
      );
      assert.deepEqual(getContractsOrder(flattenedFiles), ["C", "B", "A"]);
    });
  });

  describe("When has contracts with name clash", function () {
    useFixtureProject("contracts-nameclash-project");

    it("should flatten files sorted correctly with repetition", async function () {
      const flattenedFiles = await this.env.run(
        TASK_FLATTEN_GET_FLATTENED_SOURCE
      );
      assert.deepEqual(getContractsOrder(flattenedFiles), ["C", "B", "A", "C"]);
    });
  });

  describe("When imports appear inside comments and strings", function () {
    useFixtureProject("tricky-imports-project");
    useEnvironment();

    it("flattens only the real dependency graph", async function () {
      // Phantom imports inside comments/strings previously broke
      // flattening outright (the resolver threw on the nonexistent file).
      // The flattened output legitimately still CONTAINS the comment text;
      // what matters is that flattening succeeds and pulls in exactly the
      // real dependency graph.
      const flattened = await this.env.run(TASK_FLATTEN_GET_FLATTENED_SOURCE);

      assert.equal(countOccurrences(flattened, "library TrickyLib"), 1);
      assert.equal(countOccurrences(flattened, "contract Tricky "), 1);

      // The MULTILINE import directive is removed completely (no dangling
      // `} from "./Lib.hyp";` fragment), while code sharing a line with an
      // import survives.
      assert.notInclude(flattened, 'from "./Lib.hyp"');
      assert.notInclude(flattened, 'import "./Lib.hyp"');
      assert.equal(countOccurrences(flattened, "library SameLine"), 1);
    });
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
