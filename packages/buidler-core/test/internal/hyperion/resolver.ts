import { assert } from "chai";
import * as fsExtra from "fs-extra";
import path from "path";

import { ERRORS } from "../../../src/internal/core/errors-list";
import { getImports } from "../../../src/internal/hyperion/imports";
import {
  ResolvedFile,
  Resolver,
} from "../../../src/internal/hyperion/resolver";
import { expectHardhatErrorAsync } from "../../helpers/errors";
import {
  getFixtureProjectPath,
  useFixtureProject,
} from "../../helpers/project";

function assertResolvedFile(
  actual: ResolvedFile,
  expected: Partial<ResolvedFile>
) {
  for (const key of Object.keys(expected)) {
    const typedKey = key as keyof ResolvedFile;
    assert.deepEqual(actual[typedKey], expected[typedKey]);
  }
}

describe("Resolved file", function () {
  const globalName = "globalName.hyp";
  const absolutePath = "/path/to/file/globalName.hyp";
  const content = "the file content";
  const lastModificationDate = new Date();
  const libraryName = "lib";
  const libraryVersion = "0.1.0";

  let resolvedFileWithoutLibrary: ResolvedFile;
  let resolvedFileWithLibrary: ResolvedFile;

  before("init files", function () {
    resolvedFileWithoutLibrary = new ResolvedFile(
      globalName,
      absolutePath,
      content,
      lastModificationDate
    );

    resolvedFileWithLibrary = new ResolvedFile(
      globalName,
      absolutePath,
      content,
      lastModificationDate,
      libraryName,
      libraryVersion
    );
  });

  it("should be constructed correctly without a library", function () {
    assertResolvedFile(resolvedFileWithoutLibrary, {
      globalName,
      absolutePath,
      content,
      lastModificationDate,
      library: undefined,
    });
  });

  it("Should be constructed correctly with a library", function () {
    assertResolvedFile(resolvedFileWithLibrary, {
      globalName,
      absolutePath,
      content,
      lastModificationDate,
      library: {
        name: libraryName,
        version: libraryVersion,
      },
    });
  });

  describe("getVersionedName", function () {
    it("Should give the global name if the file isn't from a library", function () {
      assert.equal(resolvedFileWithoutLibrary.getVersionedName(), globalName);
    });

    it("Should add the version if the file is from a library", function () {
      assert.equal(
        resolvedFileWithLibrary.getVersionedName(),
        `${globalName}@v${libraryVersion}`
      );
    });
  });
});

describe("Resolver", function () {
  describe("Project's files resolution", function () {
    const projectName = "top-level-node-project";
    useFixtureProject(projectName);

    let resolver: Resolver;
    before("Get project root", async function () {
      resolver = new Resolver(await getFixtureProjectPath(projectName));
    });

    it("should resolve from absolute paths", async function () {
      const absolutePath = await fsExtra.realpath("contracts/A.hyp");
      const { ctime } = await fsExtra.stat(absolutePath);
      const resolved = await resolver.resolveProjectSourceFile(absolutePath);

      assertResolvedFile(resolved, {
        globalName: "contracts/A.hyp",
        absolutePath,
        content: "A",
        lastModificationDate: ctime,
        library: undefined,
      });

      const absolutePath2 = await fsExtra.realpath("contracts/subdir/C.hyp");
      const { ctime: ctime2 } = await fsExtra.stat(absolutePath2);
      const resolved2 = await resolver.resolveProjectSourceFile(absolutePath2);

      assertResolvedFile(resolved2, {
        globalName: "contracts/subdir/C.hyp",
        absolutePath: absolutePath2,
        content: "C",
        lastModificationDate: ctime2,
        library: undefined,
      });
    });

    it("should resolve from the global name", async function () {
      const absolutePath = await fsExtra.realpath("contracts/B.hyp");
      const { ctime } = await fsExtra.stat(absolutePath);
      const resolved = await resolver.resolveProjectSourceFile(
        "contracts/B.hyp"
      );

      assertResolvedFile(resolved, {
        globalName: "contracts/B.hyp",
        absolutePath,
        content: "B",
        lastModificationDate: ctime,
        library: undefined,
      });
    });

    it("should resolve from a path relative to the project root", async function () {
      const absolutePath = await fsExtra.realpath("contracts/B.hyp");
      const { ctime } = await fsExtra.stat(absolutePath);
      const resolved = await resolver.resolveProjectSourceFile(
        "./contracts/subdir/../B.hyp"
      );

      assertResolvedFile(resolved, {
        globalName: "contracts/B.hyp",
        absolutePath,
        content: "B",
        lastModificationDate: ctime,
        library: undefined,
      });
    });

    it("should throw if a library file is resolved as a source file", async function () {
      const absolutePath = await fsExtra.realpath(
        "./node_modules/lib/contracts/L.hyp"
      );

      await expectHardhatErrorAsync(
        () =>
          resolver.resolveProjectSourceFile(
            "./node_modules/lib/contracts/L.hyp"
          ),
        ERRORS.RESOLVER.LIBRARY_FILE_NOT_LOCAL
      );

      await expectHardhatErrorAsync(
        () => resolver.resolveProjectSourceFile(absolutePath),
        ERRORS.RESOLVER.LIBRARY_FILE_NOT_LOCAL
      );
    });

    it("should throw if the file doesn't exist", async function () {
      await expectHardhatErrorAsync(
        () => resolver.resolveProjectSourceFile("./contracts/NOT-FOUND.hyp"),
        ERRORS.RESOLVER.FILE_NOT_FOUND
      );

      await expectHardhatErrorAsync(
        () =>
          resolver.resolveProjectSourceFile(
            "./node_modules/lib/contracts/NOT-FOUND.hyp"
          ),
        ERRORS.RESOLVER.FILE_NOT_FOUND
      );
    });

    it("should throw if the file is outside of the project root", async function () {
      const outsideProjectFile = path.join(
        await getFixtureProjectPath("contracts-project"),
        "contracts",
        "A.hyp"
      );

      await expectHardhatErrorAsync(
        () => resolver.resolveProjectSourceFile(outsideProjectFile),
        ERRORS.RESOLVER.FILE_OUTSIDE_PROJECT
      );
    });
  });

  describe("Library files resolution", function () {
    describe("With node_modules in the project root", function () {
      const projectName = "top-level-node-project";
      useFixtureProject(projectName);

      let resolver: Resolver;
      before("Get project root", async function () {
        resolver = new Resolver(await getFixtureProjectPath(projectName));
      });

      it("Should throw if the library isn't installed", async function () {
        await expectHardhatErrorAsync(
          () => resolver.resolveLibrarySourceFile("uninstalled/A.hyp"),
          ERRORS.RESOLVER.LIBRARY_NOT_INSTALLED
        );
      });

      it("Should throw if the library is installed but the file is not found", async function () {
        await expectHardhatErrorAsync(
          () => resolver.resolveLibrarySourceFile("lib/NOT-FOUND.hyp"),
          ERRORS.RESOLVER.LIBRARY_FILE_NOT_FOUND
        );

        await expectHardhatErrorAsync(
          () => resolver.resolveLibrarySourceFile("lib/../../contracts/A.hyp"),
          ERRORS.RESOLVER.FILE_OUTSIDE_LIB
        );
      });

      it("Should resolve existing files", async function () {
        const absolutePath = await fsExtra.realpath(
          "node_modules/lib/contracts/L.hyp"
        );
        const { ctime } = await fsExtra.stat(absolutePath);
        const resolved = await resolver.resolveLibrarySourceFile(
          "lib/contracts/L.hyp"
        );

        assertResolvedFile(resolved, {
          globalName: "lib/contracts/L.hyp",
          absolutePath,
          content: "L",
          lastModificationDate: ctime,
          library: {
            name: "lib",
            version: "1.2.3",
          },
        });

        const absolutePath2 = await fsExtra.realpath(
          "node_modules/lib/contracts/subdir/L3.hyp"
        );
        const { ctime: ctime2 } = await fsExtra.stat(absolutePath2);
        const resolved2 = await resolver.resolveLibrarySourceFile(
          "lib/contracts/subdir/L3.hyp"
        );

        assertResolvedFile(resolved2, {
          globalName: "lib/contracts/subdir/L3.hyp",
          absolutePath: absolutePath2,
          content: "L3",
          lastModificationDate: ctime2,
          library: {
            name: "lib",
            version: "1.2.3",
          },
        });
      });
    });

    describe("Project nested inside another node project", function () {
      const projectName = "nested-node-project/project";
      useFixtureProject(projectName);

      let resolver: Resolver;
      before("Get project root", async function () {
        resolver = new Resolver(await getFixtureProjectPath(projectName));
      });

      it("should resolve a file of a library from the inner node_modules", async function () {
        const absolutePath = await fsExtra.realpath(
          "node_modules/inner/contracts/L.hyp"
        );
        const { ctime } = await fsExtra.stat(absolutePath);
        const resolved = await resolver.resolveLibrarySourceFile(
          "inner/contracts/L.hyp"
        );

        assertResolvedFile(resolved, {
          globalName: "inner/contracts/L.hyp",
          absolutePath,
          content: "L",
          lastModificationDate: ctime,
          library: {
            name: "inner",
            version: "0.1.0",
          },
        });
      });

      it("should resolve a file of a library from the outer node_modules", async function () {
        const absolutePath = await fsExtra.realpath(
          "../node_modules/outer/contracts/L.hyp"
        );
        const { ctime } = await fsExtra.stat(absolutePath);
        const resolved = await resolver.resolveLibrarySourceFile(
          "outer/contracts/L.hyp"
        );

        assertResolvedFile(resolved, {
          globalName: "outer/contracts/L.hyp",
          absolutePath,
          content: "L",
          lastModificationDate: ctime,
          library: {
            name: "outer",
            version: "0.0.1",
          },
        });
      });

      describe("when a library is in more than one node_modules", async function () {
        it("should resolve a file that is only in the nearest node_modules", async function () {
          const absolutePath = await fsExtra.realpath(
            "node_modules/clashed/contracts/I.hyp"
          );
          const { ctime } = await fsExtra.stat(absolutePath);
          const resolved = await resolver.resolveLibrarySourceFile(
            "clashed/contracts/I.hyp"
          );

          assertResolvedFile(resolved, {
            globalName: "clashed/contracts/I.hyp",
            absolutePath,
            content: "I",
            lastModificationDate: ctime,
            library: {
              name: "clashed",
              version: "2.0.0",
            },
          });
        });

        it("shouldn't resolve a file that is only in the outer node_modules", async function () {
          await expectHardhatErrorAsync(
            () => resolver.resolveLibrarySourceFile("clashed/contracts/O.hyp"),
            ERRORS.RESOLVER.LIBRARY_FILE_NOT_FOUND
          );
        });

        it("should resolve to the closest version in case of a file being included in both node_modules", async function () {
          const absolutePath = await fsExtra.realpath(
            "node_modules/clashed/contracts/L.hyp"
          );
          const { ctime } = await fsExtra.stat(absolutePath);
          const resolved = await resolver.resolveLibrarySourceFile(
            "clashed/contracts/L.hyp"
          );

          assertResolvedFile(resolved, {
            globalName: "clashed/contracts/L.hyp",
            absolutePath,
            content: "INNER",
            lastModificationDate: ctime,
            library: {
              name: "clashed",
              version: "2.0.0",
            },
          });
        });
      });
    });
  });

  describe("Imports resolution", function () {
    const projectName = "top-level-node-project";
    useFixtureProject(projectName);

    let resolver: Resolver;
    let resolvedLocalFile: ResolvedFile;
    let resolvedLibFile: ResolvedFile;
    before("Get project root", async function () {
      resolver = new Resolver(await getFixtureProjectPath(projectName));
      resolvedLocalFile = await resolver.resolveProjectSourceFile(
        "contracts/A.hyp"
      );
      resolvedLibFile = await resolver.resolveLibrarySourceFile(
        "lib/contracts/L.hyp"
      );
    });

    it("Should resolve absolute imports as libraries", async function () {
      const absolutePath = await fsExtra.realpath(
        "node_modules/lib/contracts/L2.hyp"
      );
      const { ctime } = await fsExtra.stat(absolutePath);
      const resolvedFromLocalFile = await resolver.resolveImport(
        resolvedLocalFile,
        "lib/contracts/L2.hyp"
      );

      const resolvedFromLibFile = await resolver.resolveImport(
        resolvedLibFile,
        "lib/contracts/L2.hyp"
      );

      const expected = {
        globalName: "lib/contracts/L2.hyp",
        absolutePath,
        content: "L2",
        lastModificationDate: ctime,
        library: {
          name: "lib",
          version: "1.2.3",
        },
      };

      assertResolvedFile(resolvedFromLocalFile, expected);
      assertResolvedFile(resolvedFromLibFile, expected);
    });

    it("Should resolve relative imports from local files", async function () {
      const absolutePath = await fsExtra.realpath("contracts/B.hyp");
      const { ctime } = await fsExtra.stat(absolutePath);
      const resolved = await resolver.resolveImport(
        resolvedLocalFile,
        "./subdir/../B.hyp"
      );

      assertResolvedFile(resolved, {
        globalName: "contracts/B.hyp",
        absolutePath,
        content: "B",
        lastModificationDate: ctime,
        library: undefined,
      });
    });

    it("Should resolve relative imports from library files", async function () {
      const absolutePath = await fsExtra.realpath(
        "node_modules/lib/contracts/subdir/L3.hyp"
      );
      const { ctime } = await fsExtra.stat(absolutePath);
      const resolved = await resolver.resolveImport(
        resolvedLibFile,
        "./subdir/L3.hyp"
      );

      assertResolvedFile(resolved, {
        globalName: "lib/contracts/subdir/L3.hyp",
        absolutePath,
        content: "L3",
        lastModificationDate: ctime,
        library: {
          name: "lib",
          version: "1.2.3",
        },
      });
    });

    it("Shouldn't allow relative imports from library files to escape the lib", async function () {
      await expectHardhatErrorAsync(
        () =>
          resolver.resolveImport(
            resolvedLibFile,
            "../../../../../sample-project/contracts/Sample.hyp"
          ),
        ERRORS.RESOLVER.ILLEGAL_IMPORT
      );
    });

    it("Shouldn't allow relative imports from local files to escape the project", async function () {
      const outsideProjectFile = path.join(
        await getFixtureProjectPath("contracts-project"),
        "contracts",
        "A.hyp"
      );
      const importPath = path.relative(
        path.dirname(resolvedLocalFile.absolutePath),
        outsideProjectFile
      );

      await expectHardhatErrorAsync(
        () => resolver.resolveImport(resolvedLocalFile, importPath),
        ERRORS.RESOLVER.FILE_OUTSIDE_PROJECT
      );
    });

    it("Should throw if imported file doesn't exist", async function () {
      await expectHardhatErrorAsync(
        () => resolver.resolveImport(resolvedLocalFile, "./asd.hyp"),
        ERRORS.RESOLVER.IMPORTED_FILE_NOT_FOUND
      );

      await expectHardhatErrorAsync(
        () => resolver.resolveImport(resolvedLocalFile, "lib/asd.hyp"),
        ERRORS.RESOLVER.IMPORTED_FILE_NOT_FOUND
      );

      await expectHardhatErrorAsync(
        () => resolver.resolveImport(resolvedLibFile, "./asd.hyp"),
        ERRORS.RESOLVER.IMPORTED_FILE_NOT_FOUND
      );
    });
  });
});

describe("Scoped dependencies project", () => {
  const projectName = "scoped-dependency-project";
  useFixtureProject(projectName);

  before("Get project root", async function () {
    this.resolver = new Resolver(await getFixtureProjectPath(projectName));
    this.resolvedLocalFile = await this.resolver.resolveProjectSourceFile(
      "contracts/A.hyp"
    );
  });

  it("should resolve scoped libraries properly", async function () {
    const imports = getImports(this.resolvedLocalFile.content);
    assert.isAbove(imports.length, 0);
    assert.equal(imports[0], "@scope/package/contracts/File.hyp");
    const resolvedLibrary: ResolvedFile = await this.resolver.resolveImport(
      this.resolvedLocalFile,
      imports[0]
    );
    assert.isDefined(resolvedLibrary);
    assert.equal(resolvedLibrary.globalName, imports[0]);
    assert.equal(resolvedLibrary.library!.name, "@scope/package");
  });

  it("should retrieve the library name properly", function () {
    assert.equal(
      this.resolver._getLibraryName("@scoped/library/contracts/Contract.hyp"),
      "@scoped/library"
    );
    assert.equal(
      this.resolver._getLibraryName("library/contracts/Contract.hyp"),
      "library"
    );
  });

  it("should retrieve relative dependency inside library", async function () {
    const resolvedImporter = await this.resolver.resolveLibrarySourceFile(
      "@scope/package/contracts/nested/dir/Importer.hyp"
    );
    const imports = getImports(resolvedImporter.content);
    assert.equal(imports[0], "../A.hyp");

    const resolvedImported = await this.resolver.resolveImport(
      resolvedImporter,
      imports[0]
    );
    assert.equal(
      resolvedImported.globalName,
      "@scope/package/contracts/nested/A.hyp"
    );
  });
});
