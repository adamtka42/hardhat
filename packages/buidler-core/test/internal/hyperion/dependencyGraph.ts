import { assert } from "chai";
import * as fs from "fs";
import path from "path";

import { DependencyGraph } from "../../../src/internal/hyperion/dependencyGraph";
import {
  ResolvedFile,
  Resolver,
} from "../../../src/internal/hyperion/resolver";
import {
  getFixtureProjectPath,
  useFixtureProject,
} from "../../helpers/project";

function assertDeps(
  graph: DependencyGraph,
  file: ResolvedFile,
  ...deps: ResolvedFile[]
) {
  assert.isTrue(graph.dependenciesPerFile.has(file));
  const resolvedDeps = graph.dependenciesPerFile.get(file);

  if (resolvedDeps === undefined) {
    throw Error("This should never happen. Just making TS happy.");
  }

  assert.equal(resolvedDeps.size, deps.length);
  assert.includeMembers(Array.from(resolvedDeps), deps);
}

function assertResolvedFiles(graph: DependencyGraph, ...files: ResolvedFile[]) {
  const resolvedFiles = graph.getResolvedFiles();

  assert.equal(resolvedFiles.length, files.length);
  assert.includeMembers(resolvedFiles, files);
}

describe("Dependency Graph", function () {
  let resolver: Resolver;
  let projectRoot: string;
  let fileWithoutDependencies: ResolvedFile;
  let fileWithoutDependencies2: ResolvedFile;
  let fileWithoutDependencies3: ResolvedFile;
  let dependsOnWDAndW2: ResolvedFile;
  let dependsOnWD: ResolvedFile;
  let loop1: ResolvedFile;
  let loop2: ResolvedFile;
  let dependsOnLoop2: ResolvedFile;

  before("Mock some resolved files", function () {
    projectRoot = fs.realpathSync(".");

    fileWithoutDependencies = new ResolvedFile(
      "contracts/WD.hyp",
      path.join(projectRoot, "contracts", "WD.hyp"),
      "no dependecy",
      new Date()
    );

    fileWithoutDependencies2 = new ResolvedFile(
      "contracts/WD2.hyp",
      path.join(projectRoot, "contracts", "WD2.hyp"),
      "no dependecy",
      new Date()
    );

    fileWithoutDependencies3 = new ResolvedFile(
      "contracts/WD3.hyp",
      path.join(projectRoot, "contracts", "WD3.hyp"),
      "no dependecy",
      new Date()
    );

    dependsOnWDAndW2 = new ResolvedFile(
      "contracts/dependsOnWDAndW2.hyp",
      path.join(projectRoot, "contracts", "dependsOnWDAndW2.hyp"),
      'import "./WD.hyp"; import "./WD2.hyp";',
      new Date()
    );

    dependsOnWD = new ResolvedFile(
      "contracts/dependsOnWD.hyp",
      path.join(projectRoot, "contracts", "dependsOnWD.hyp"),
      'import "./WD.hyp";',
      new Date()
    );

    loop1 = new ResolvedFile(
      "contracts/loop1.hyp",
      path.join(projectRoot, "contracts", "loop1.hyp"),
      'import "./loop2.hyp";',
      new Date()
    );

    loop2 = new ResolvedFile(
      "contracts/loop2.hyp",
      path.join(projectRoot, "contracts", "loop2.hyp"),
      'import "./loop1.hyp";',
      new Date()
    );

    dependsOnLoop2 = new ResolvedFile(
      "contracts/dependsOnLoop2.hyp",
      path.join(projectRoot, "contracts", "dependsOnLoop2.hyp"),
      'import "./loop2.hyp";',
      new Date()
    );

    resolver = new Resolver(projectRoot);
    resolver.resolveImport = async (from: ResolvedFile, imported: string) => {
      switch (imported) {
        case "./WD.hyp":
          return fileWithoutDependencies;
        case "./WD2.hyp":
          return fileWithoutDependencies2;
        case "./loop1.hyp":
          return loop1;
        case "./loop2.hyp":
          return loop2;

        default:
          throw new Error(`${imported} is not mocked`);
      }
    };
  });

  it("should give an empty graph if there's no entry point", async function () {
    const graph = await DependencyGraph.createFromResolvedFiles(resolver, []);
    assert.isEmpty(graph.dependenciesPerFile);
  });

  it("should give a graph with a single node if the only entry point has no deps", async function () {
    const graph = await DependencyGraph.createFromResolvedFiles(resolver, [
      fileWithoutDependencies,
    ]);

    assertResolvedFiles(graph, fileWithoutDependencies);
    assertDeps(graph, fileWithoutDependencies);
  });

  it("should work with multiple entry points without deps", async function () {
    const graph = await DependencyGraph.createFromResolvedFiles(resolver, [
      fileWithoutDependencies,
      fileWithoutDependencies2,
    ]);
    assertResolvedFiles(
      graph,
      fileWithoutDependencies,
      fileWithoutDependencies2
    );
    assertDeps(graph, fileWithoutDependencies);
    assertDeps(graph, fileWithoutDependencies2);
  });

  it("should work with an entry point with deps", async function () {
    const graph = await DependencyGraph.createFromResolvedFiles(resolver, [
      dependsOnWDAndW2,
    ]);
    assertResolvedFiles(
      graph,
      fileWithoutDependencies,
      fileWithoutDependencies2,
      dependsOnWDAndW2
    );
    assertDeps(graph, fileWithoutDependencies);
    assertDeps(graph, fileWithoutDependencies2);
    assertDeps(
      graph,
      dependsOnWDAndW2,
      fileWithoutDependencies,
      fileWithoutDependencies2
    );
  });

  it("should work with the same file being reachable from multiple entry pints", async function () {
    const graph = await DependencyGraph.createFromResolvedFiles(resolver, [
      dependsOnWDAndW2,
      fileWithoutDependencies,
    ]);

    assertResolvedFiles(
      graph,
      fileWithoutDependencies,
      fileWithoutDependencies2,
      dependsOnWDAndW2
    );
    assertDeps(graph, fileWithoutDependencies);
    assertDeps(graph, fileWithoutDependencies2);
    assertDeps(
      graph,
      dependsOnWDAndW2,
      fileWithoutDependencies,
      fileWithoutDependencies2
    );

    const graph2 = await DependencyGraph.createFromResolvedFiles(resolver, [
      dependsOnWDAndW2,
      dependsOnWD,
    ]);

    assertResolvedFiles(
      graph2,
      fileWithoutDependencies,
      fileWithoutDependencies2,
      dependsOnWDAndW2,
      dependsOnWD
    );
    assertDeps(graph2, fileWithoutDependencies);
    assertDeps(graph2, fileWithoutDependencies2);
    assertDeps(
      graph2,
      dependsOnWDAndW2,
      fileWithoutDependencies,
      fileWithoutDependencies2
    );
    assertDeps(graph2, dependsOnWD, fileWithoutDependencies);
  });

  it("should work with an isolated file", async function () {
    const graph = await DependencyGraph.createFromResolvedFiles(resolver, [
      dependsOnWDAndW2,
      fileWithoutDependencies3,
    ]);

    assertResolvedFiles(
      graph,
      fileWithoutDependencies,
      fileWithoutDependencies2,
      dependsOnWDAndW2,
      fileWithoutDependencies3
    );
    assertDeps(graph, fileWithoutDependencies);
    assertDeps(graph, fileWithoutDependencies2);
    assertDeps(graph, fileWithoutDependencies3);
    assertDeps(
      graph,
      dependsOnWDAndW2,
      fileWithoutDependencies,
      fileWithoutDependencies2
    );
  });

  describe("Cyclic dependencies", function () {
    const PROJECT = "cyclic-dependencies-project";
    useFixtureProject(PROJECT);

    let localResolver: Resolver;
    before("Get project root", async function () {
      localResolver = new Resolver(await getFixtureProjectPath(PROJECT));
    });

    it("should work with cyclic dependencies", async () => {
      const fileA = await localResolver.resolveProjectSourceFile(
        "contracts/A.hyp"
      );
      const fileB = await localResolver.resolveProjectSourceFile(
        "contracts/B.hyp"
      );

      const graph = await DependencyGraph.createFromResolvedFiles(
        localResolver,
        [fileA]
      );

      const graphFiles = Array.from(graph.dependenciesPerFile.keys());
      graphFiles.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));

      assert.equal(graphFiles.length, 2);

      const [graphsA, graphsB] = graphFiles;
      assert.deepEqual(graphsA, fileA);
      assert.deepEqual(graphsB, fileB);

      assert.equal(graph.dependenciesPerFile.get(graphsA)!.size, 1);

      const graphsADep = Array.from(
        graph.dependenciesPerFile.get(graphsA)!.values()
      )[0];
      assert.deepEqual(graphsADep, fileB);

      assert.equal(graph.dependenciesPerFile.get(graphsB)!.size, 1);

      const graphsBDep = Array.from(
        graph.dependenciesPerFile.get(graphsB)!.values()
      )[0];
      assert.deepEqual(graphsBDep, fileA);
    });
  });
});
