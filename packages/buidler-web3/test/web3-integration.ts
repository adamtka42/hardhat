import { resetHardhatContext } from "@theqrl/hardhat/plugins-testing";
import { assert } from "chai";
import path from "path";

import { Web3HTTPProviderAdapter } from "../src/web3-provider-adapter";

import { useEnvironment } from "./helpers";

function waitForSubscriptionData(subscription: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for newHeads")),
      5000
    );

    subscription.once("data", (data: any) => {
      clearTimeout(timeout);
      resolve(data);
    });
    subscription.once("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe("Hardhat Web3 lazy loading", function () {
  const projectPath = __dirname;
  let previousConfig: string | undefined;
  let previousCwd: string;
  let previousNetwork: string | undefined;

  beforeEach(function () {
    previousConfig = process.env.HARDHAT_CONFIG;
    previousCwd = process.cwd();
    previousNetwork = process.env.HARDHAT_NETWORK;
    resetHardhatContext();
    process.chdir(projectPath);
    process.env.HARDHAT_CONFIG = path.join(projectPath, "buidler.config.js");
    process.env.HARDHAT_NETWORK = "hardhatqrlvm";
    delete require.cache[require.resolve("@theqrl/web3")];
  });

  afterEach(function () {
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
  });

  it("does not load @theqrl/web3 while loading the configuration", function () {
    require("@theqrl/hardhat");

    assert.isUndefined(require.cache[require.resolve("@theqrl/web3")]);
  });
});

describe("Hardhat Web3 integration", function () {
  useEnvironment(__dirname);

  it("exposes the Web3 constructor and a singleton instance", function () {
    const Web3 = require("@theqrl/web3").Web3;

    assert.strictEqual(this.env.Web3.version, Web3.version);
    assert.instanceOf(new this.env.Web3(this.env.web3.currentProvider), Web3);
    assert.strictEqual(this.env.web3, this.env.web3);
    assert.instanceOf(this.env.web3.currentProvider, Web3HTTPProviderAdapter);
    assert.isTrue(this.env.web3.currentProvider.supportsSubscriptions());
  });

  it("uses the selected Hardhat provider for QRL calls", async function () {
    assert.deepEqual(
      await this.env.web3.qrl.getAccounts(),
      await this.env.network.provider.send("qrl_accounts")
    );

    const directBlockNumber = await this.env.network.provider.send(
      "qrl_blockNumber"
    );
    const web3BlockNumber = await this.env.web3.qrl.getBlockNumber();
    assert.strictEqual(
      web3BlockNumber.toString(),
      parseInt(directBlockNumber, 16).toString()
    );
  });

  it("rejects subscriptions when the adapter represents an HTTP network", async function () {
    const Web3 = require("@theqrl/web3").Web3;
    const adapter = new Web3HTTPProviderAdapter(
      this.env.network.provider,
      false
    );
    const web3 = new Web3(adapter);

    try {
      await web3.qrl.subscribe("newHeads");
      assert.fail("The HTTP subscription should have been rejected");
    } catch (error) {
      assert.include(
        error.message,
        "current provider does not support subscriptions"
      );
    } finally {
      adapter.disconnect();
    }
  });

  it("forwards newHeads subscriptions from hardhatqrlvm", async function () {
    this.timeout(10000);
    const subscription = await this.env.web3.qrl.subscribe("newHeads");

    try {
      const nextHeader = waitForSubscriptionData(subscription);
      await this.env.network.provider.send("qrl_mine");
      const header = await nextHeader;
      assert.strictEqual(header.number.toString(), "1");

      await subscription.unsubscribe();
      let receivedAfterUnsubscribe = false;
      subscription.on("data", () => {
        receivedAfterUnsubscribe = true;
      });
      await this.env.network.provider.send("qrl_mine");
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.isFalse(receivedAfterUnsubscribe);
    } finally {
      if (subscription.id !== undefined) {
        await subscription.unsubscribe();
      }
    }
  });
});

describe("Hardhat Web3 HTTP integration", function () {
  useEnvironment(__dirname, "httpWithStaleLocalType");

  it("does not advertise subscriptions from a stale network type", function () {
    assert.isFalse(this.env.web3.currentProvider.supportsSubscriptions());
  });
});
