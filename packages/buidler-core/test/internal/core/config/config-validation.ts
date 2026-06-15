import { assert } from "chai";

import { LEGACY_IN_MEMORY_NETWORK_NAME } from "../../../../src/internal/constants";
import {
  getValidationErrors,
  validateConfig,
} from "../../../../src/internal/core/config/config-validation";
import { ERRORS } from "../../../../src/internal/core/errors-list";
import { expectHardhatError } from "../../../helpers/errors";

describe("Config validation", function () {
  describe("default network config", function () {
    it("Should fail if the wrong type is used", function () {
      expectHardhatError(
        () => validateConfig({ defaultNetwork: 123 }),
        ERRORS.GENERAL.INVALID_CONFIG
      );
    });
  });

  describe("Hyperion config", function () {
    const invalidHyperionType = {
      hyperion: 123,
    };

    const invalidVersionType = {
      hyperion: {
        version: 123,
      },
    };

    const invalidOptimizerType = {
      hyperion: {
        optimizer: 123,
      },
    };

    const invalidOptimizerEnabledType = {
      hyperion: {
        optimizer: {
          enabled: 123,
        },
      },
    };

    const invalidOptimizerRunsType = {
      hyperion: {
        optimizer: {
          runs: "",
        },
      },
    };

    it("Should fail with invalid types", function () {
      expectHardhatError(
        () => validateConfig(invalidHyperionType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidVersionType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidOptimizerType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidOptimizerEnabledType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidOptimizerRunsType),
        ERRORS.GENERAL.INVALID_CONFIG
      );
    });

    it("Shouldn't fail with an empty hyperion config", function () {
      const errors = getValidationErrors({
        hyperion: {},
      });

      assert.isEmpty(errors);
    });

    it("Shouldn't fail without a hyperion config", function () {
      const errors = getValidationErrors({});

      assert.isEmpty(errors);
    });

    it("Shouldn't fail with valid configs", function () {
      const errors = getValidationErrors({
        hyperion: {
          version: "123",
          optimizer: {
            enabled: true,
            runs: 123,
          },
        },
      });

      assert.isEmpty(errors);
    });

    it("Shouldn't fail with unrecognized params", function () {
      const errors = getValidationErrors({
        hyperion: {
          unrecognized: 123,
        },
      });

      assert.isEmpty(errors);
    });
  });

  describe("paths config", function () {
    const invalidPathsType = {
      paths: 123,
    };

    const invalidCacheType = {
      paths: {
        cache: 123,
      },
    };

    const invalidArtifactsType = {
      paths: {
        artifacts: 123,
      },
    };

    const invalidSourcesType = {
      paths: {
        sources: 123,
      },
    };

    const invalidTestsType = {
      paths: {
        tests: 123,
      },
    };

    const invalidRootType = {
      paths: {
        root: 123,
      },
    };

    it("Should fail with invalid types", function () {
      expectHardhatError(
        () => validateConfig(invalidPathsType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidCacheType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidArtifactsType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidRootType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidSourcesType),
        ERRORS.GENERAL.INVALID_CONFIG
      );

      expectHardhatError(
        () => validateConfig(invalidTestsType),
        ERRORS.GENERAL.INVALID_CONFIG
      );
    });

    it("Shouldn't fail with an empty paths config", function () {
      const errors = getValidationErrors({
        paths: {},
      });

      assert.isEmpty(errors);
    });

    it("Shouldn't fail without a paths config", function () {
      const errors = getValidationErrors({});

      assert.isEmpty(errors);
    });

    it("Shouldn't fail with valid paths configs", function () {
      const errors = getValidationErrors({
        paths: {
          root: "root",
          cache: "cache",
          artifacts: "artifacts",
          sources: "sources",
          tests: "tests",
        },
      });

      assert.isEmpty(errors);
    });

    it("Shouldn't fail with unrecognized params", function () {
      const errors = getValidationErrors({
        paths: {
          unrecognized: 123,
        },
      });

      assert.isEmpty(errors);
    });
  });

  describe("networks config", function () {
    describe("Invalid types", function () {
      describe("Networks object", function () {
        it("Should fail with invalid types", function () {
          expectHardhatError(
            () => validateConfig({ networks: 123 }),
            ERRORS.GENERAL.INVALID_CONFIG
          );

          expectHardhatError(
            () =>
              validateConfig({
                networks: {
                  asd: 123,
                },
              }),
            ERRORS.GENERAL.INVALID_CONFIG
          );
        });
      });

      describe("Legacy in-memory network config", function () {
        it("Should fail if the legacy in-memory network is configured", function () {
          expectHardhatError(
            () =>
              validateConfig({
                networks: {
                  [LEGACY_IN_MEMORY_NETWORK_NAME]: {},
                },
              }),
            ERRORS.GENERAL.INVALID_CONFIG,
            "Configure a live go-qrl HTTP network instead."
          );
        });
      });

      describe("HTTP network config", function () {
        describe("Url field", function () {
          it("Should fail if no url is set for custom networks", function () {
            expectHardhatError(
              () => validateConfig({ networks: { custom: {} } }),
              ERRORS.GENERAL.INVALID_CONFIG
            );
          });

          it("Should fail if no url is set for localhost network", function () {
            expectHardhatError(
              () => validateConfig({ networks: { localhost: {} } }),
              ERRORS.GENERAL.INVALID_CONFIG
            );
          });
        });

        describe("HttpHeaders", function () {
          it("Should be optional", function () {
            const errors = getValidationErrors({
              networks: {
                custom: {
                  url: "http://localhost",
                },
              },
            });
            assert.isEmpty(errors);
          });

          it("Should accept a mapping of strings to strings", function () {
            const errors = getValidationErrors({
              networks: {
                custom: {
                  url: "http://localhost",
                  httpHeaders: {
                    a: "asd",
                    b: "a",
                  },
                },
              },
            });
            assert.isEmpty(errors);
          });

          it("Should reject other types", function () {
            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    custom: {
                      url: "http://localhost",
                      httpHeaders: 123,
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    custom: {
                      url: "http://localhost",
                      httpHeaders: "123",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );
          });

          it("Should reject non-string values", function () {
            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    custom: {
                      url: "http://localhost",
                      httpHeaders: {
                        a: "a",
                        b: 123,
                      },
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    custom: {
                      url: "http://localhost",
                      httpHeaders: {
                        a: "a",
                        b: false,
                      },
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );
          });
        });

        describe("Accounts field", function () {
          it("Shouldn't work with invalid types", function () {
            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      accounts: 123,
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      accounts: {},
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      accounts: { asd: 123 },
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );
          });

          describe("Legacy HD account config", function () {
            it("Should reject legacy mnemonic account config", function () {
              expectHardhatError(
                () =>
                  validateConfig({
                    networks: {
                      asd: {
                        accounts: {
                          mnemonic: "asd asd asd",
                          initialIndex: 0,
                          count: 123,
                          path: "m/123",
                        },
                        url: "",
                      },
                    },
                  }),
                ERRORS.GENERAL.INVALID_CONFIG
              );
            });
          });

          describe("OtherAccountsConfig", function () {
            it("Should fail with invalid types", function () {
              expectHardhatError(
                () =>
                  validateConfig({
                    networks: {
                      asd: {
                        accounts: {
                          type: 123,
                        },
                        url: "",
                      },
                    },
                  }),
                ERRORS.GENERAL.INVALID_CONFIG
              );
            });
          });

          describe("List of QRL extended seeds", function () {
            it("Shouldn't work with invalid types", function () {
              expectHardhatError(
                () =>
                  validateConfig({
                    networks: {
                      asd: {
                        accounts: [123],
                        url: "",
                      },
                    },
                  }),
                ERRORS.GENERAL.INVALID_CONFIG
              );
            });

            it("Shouldn't work with invalid QRL extended seed strings", function () {
              for (const seed of [
                "0x010000",
                "0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401",
                "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be40z",
              ]) {
                expectHardhatError(
                  () =>
                    validateConfig({
                      networks: {
                        asd: {
                          accounts: [seed],
                          url: "",
                        },
                      },
                    }),
                  ERRORS.GENERAL.INVALID_CONFIG,
                  "51-byte QRL extended seed hex string"
                );
              }
            });
          });

          describe("Remote accounts", function () {
            it("Should work with accounts: remote", function () {
              assert.isEmpty(
                getValidationErrors({
                  networks: {
                    asd: {
                      accounts: "remote",
                      url: "",
                    },
                  },
                })
              );
            });

            it("Shouldn't work with other strings", function () {
              expectHardhatError(
                () =>
                  validateConfig({
                    networks: {
                      asd: {
                        accounts: "asd",
                        url: "",
                      },
                    },
                  }),
                ERRORS.GENERAL.INVALID_CONFIG
              );
            });
          });

          describe("QRL Ledger accounts", function () {
            it("Should work with valid QRL Ledger accounts", function () {
              assert.isEmpty(
                getValidationErrors({
                  networks: {
                    asd: {
                      accounts: {
                        type: "ledger",
                        accounts: [`Q${"a".repeat(128)}`],
                      },
                      url: "",
                    },
                  },
                })
              );
            });

            it("Shouldn't work without an accounts array", function () {
              expectHardhatError(
                () =>
                  validateConfig({
                    networks: {
                      asd: {
                        accounts: {
                          type: "ledger",
                        },
                        url: "",
                      },
                    },
                  }),
                ERRORS.GENERAL.INVALID_CONFIG,
                "64-byte QRL address array"
              );
            });

            it("Shouldn't work with invalid QRL Ledger addresses", function () {
              expectHardhatError(
                () =>
                  validateConfig({
                    networks: {
                      asd: {
                        accounts: {
                          type: "ledger",
                          accounts: ["0x1234"],
                        },
                        url: "",
                      },
                    },
                  }),
                ERRORS.GENERAL.INVALID_CONFIG,
                "64-byte QRL address"
              );
            });
          });
        });

        describe("Other fields", function () {
          it("Shouldn't accept invalid types", function () {
            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      chainId: "",
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      from: 123,
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      gas: "asdsad",
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      gasPrice: "asdsad",
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      gasMultiplier: "asdsad",
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );

            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      url: false,
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG
            );
          });

          it("Shouldn't accept invalid QRL sender addresses", function () {
            expectHardhatError(
              () =>
                validateConfig({
                  networks: {
                    asd: {
                      from: "0x0001",
                      url: "",
                    },
                  },
                }),
              ERRORS.GENERAL.INVALID_CONFIG,
              "64-byte QRL address"
            );
          });
        });
      });
    });

    it("Shouldn't fail with an empty networks config", function () {
      const errors = getValidationErrors({
        networks: {},
      });

      assert.isEmpty(errors);
    });

    it("Shouldn't fail without a networks config", function () {
      const errors = getValidationErrors({});

      assert.isEmpty(errors);
    });

    it("Shouldn't fail with valid networks configs", function () {
      const errors = getValidationErrors({
        networks: {
          commonThings: {
            chainId: 1,
            from: `Q${"1".repeat(128)}`,
            gas: "auto",
            gasPrice: "auto",
            gasMultiplier: 123,
            url: "",
          },
          localhost: {
            gas: 678,
            gasPrice: 123,
            url: "",
          },
          withRemoteAccounts: {
            accounts: "remote",
            url: "",
          },
          withQrlExtendedSeeds: {
            accounts: [
              "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401",
              "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be402",
            ],
            url: "",
          },
          withLedgerAccounts: {
            accounts: {
              type: "ledger",
              accounts: [`Q${"a".repeat(128)}`],
            },
            url: "",
          },
        },
      });

      assert.deepEqual(errors, []);

      assert.deepEqual(
        getValidationErrors({
          networks: {
            custom: {
              url: "http://localhost:8545",
            },
            localhost: {
              url: "http://localhost:8545",
              accounts: [
                "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401",
              ],
            },
          },
          unknown: {
            asd: 123,
            url: "",
          },
        }),
        []
      );
    });

    it("Shouldn't fail with unrecognized params", function () {
      const errors = getValidationErrors({
        networks: {
          localhost: {
            url: "",
            asd: 1232,
          },
        },
      });

      assert.isEmpty(errors);
    });
  });
});
