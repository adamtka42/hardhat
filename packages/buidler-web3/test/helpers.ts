import { resetHardhatContext } from "@theqrl/hardhat/plugins-testing";
import { HardhatRuntimeEnvironment } from "@theqrl/hardhat/types";
import path from "path";

declare module "mocha" {
  interface Context {
    env: HardhatRuntimeEnvironment;
  }
}

export function useEnvironment(
  projectPath: string,
  networkName = "hardhatqrlvm"
) {
  let previousConfig: string | undefined;
  let previousCwd: string;
  let previousNetwork: string | undefined;

  beforeEach("Loading Hardhat environment", function () {
    previousConfig = process.env.HARDHAT_CONFIG;
    previousCwd = process.cwd();
    previousNetwork = process.env.HARDHAT_NETWORK;
    process.chdir(projectPath);
    process.env.HARDHAT_CONFIG = path.join(projectPath, "buidler.config.js");
    process.env.HARDHAT_NETWORK = networkName;

    this.env = require("@theqrl/hardhat");
  });

  afterEach("Resetting Hardhat", function () {
    try {
      if (this.env !== undefined) {
        const currentProvider = this.env.web3.currentProvider;
        if (
          currentProvider !== undefined &&
          typeof currentProvider.disconnect === "function"
        ) {
          currentProvider.disconnect();
        }
      }
    } finally {
      resetHardhatContext();
      process.chdir(previousCwd);
      if (previousConfig === undefined) {
        delete process.env.HARDHAT_CONFIG;
      } else {
        process.env.HARDHAT_CONFIG = previousConfig;
      }
      if (previousNetwork === undefined) {
        delete process.env.HARDHAT_NETWORK;
      } else {
        process.env.HARDHAT_NETWORK = previousNetwork;
      }
    }
  });
}
