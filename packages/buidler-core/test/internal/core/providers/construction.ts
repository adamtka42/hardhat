import { assert } from "chai";

import { ERRORS } from "../../../../src/internal/core/errors-list";
import {
  createProvider,
  wrapQrlProvider,
} from "../../../../src/internal/core/providers/construction";
import { DEFAULT_GAS_MULTIPLIER } from "../../../../src/internal/core/providers/gas-providers";
import { HttpProvider } from "../../../../src/internal/core/providers/http";
import { numberToRpcQuantity } from "../../../../src/internal/core/providers/provider-utils";
import {
  qrlAddressFromSeed,
  toQrlChecksumAddress,
} from "../../../../src/internal/qrl/address";
import {
  expectHardhatError,
  expectHardhatErrorAsync,
} from "../../../helpers/errors";

import { MockedProvider } from "./mocks";

const QRL_SEEDS = [
  "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401",
  "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be402",
  "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be403",
];
const LEDGER_ADDRESS = `Q${"a".repeat(128)}`;

describe("Base provider creation", () => {
  it("Should create a valid HTTP provider and wrap it", () => {
    const provider = createProvider("net", { url: "http://localhost:8545" });

    assert.instanceOf(provider, HttpProvider);
  });
});

describe("Base providers wrapping", () => {
  let mockedProvider: MockedProvider;

  beforeEach(() => {
    mockedProvider = new MockedProvider();
    mockedProvider.setReturnValue("qrl_chainId", numberToRpcQuantity(1337));
    mockedProvider.setReturnValue("qrl_getBlockByNumber", {
      gasLimit: numberToRpcQuantity(8000000),
    });
    mockedProvider.setReturnValue("qrl_accounts", [
      qrlAddressFromSeed(QRL_SEEDS[0]),
    ]);
  });

  describe("Accounts wrapping", () => {
    it("Should wrap with a list of QRL extended seeds as accounts", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        accounts: QRL_SEEDS,
        url: "",
      });

      const accounts = await provider.send("qrl_accounts");

      assert.deepEqual(accounts, QRL_SEEDS.map(qrlAddressFromSeed));
      accounts.forEach((account: string) =>
        assert.match(account, /^Q[0-9a-fA-F]{128}$/)
      );
    });

    it("Should compose sender, gas and local signing wrappers", async () => {
      const txHash = `0x${"1".repeat(64)}`;
      mockedProvider.setReturnValue("qrl_getTransactionCount", "0x0");
      mockedProvider.setReturnValue("qrl_gasPrice", numberToRpcQuantity(123));
      mockedProvider.setReturnValue(
        "qrl_estimateGas",
        numberToRpcQuantity(21000)
      );
      mockedProvider.setReturnValue("qrl_sendRawTransaction", txHash);

      const provider = wrapQrlProvider(mockedProvider, {
        accounts: QRL_SEEDS,
        url: "",
      });

      const result = await provider.send("qrl_sendTransaction", [
        {
          to: qrlAddressFromSeed(QRL_SEEDS[1]),
          value: 1,
        },
      ]);

      assert.equal(result, txHash);

      const [rawTransaction] = mockedProvider.getLatestParams(
        "qrl_sendRawTransaction"
      );
      assert.isString(rawTransaction);
      assert.match(rawTransaction, /^0x[0-9a-f]+$/i);
      assert.isAbove(rawTransaction.length, 1000);
    });

    it("Shouldn't wrap with an accounts-managing provider if not necessary", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      await provider.send("qrl_accounts", ["param1", "param2"]);
      const params = mockedProvider.getLatestParams("qrl_accounts");
      assert.deepEqual(params, ["param1", "param2"]);
    });

    it("Should wrap with QRL Ledger accounts", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        accounts: {
          type: "ledger",
          accounts: [LEDGER_ADDRESS],
        },
        url: "",
      });

      const accounts = await provider.send("qrl_accounts");

      assert.deepEqual(accounts, [
        qrlAddressFromSeed(QRL_SEEDS[0]),
        toQrlChecksumAddress(LEDGER_ADDRESS),
      ]);
    });
  });

  describe("Sender wrapping", () => {
    beforeEach(() => {
      mockedProvider.setReturnValue(
        "qrl_estimateGas",
        numberToRpcQuantity(123)
      );
    });

    it("Should wrap with a fixed sender param", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        from: qrlAddressFromSeed(QRL_SEEDS[1]),
      });

      await provider.send("qrl_sendTransaction", [{}]);

      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(tx.from, qrlAddressFromSeed(QRL_SEEDS[1]));
    });

    it("Should wrap without a fixed sender param, using the default one", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      await provider.send("qrl_sendTransaction", [{}]);
      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(tx.from, qrlAddressFromSeed(QRL_SEEDS[0]));
    });
  });

  describe("Transaction quantity normalization", () => {
    beforeEach(() => {
      mockedProvider.setReturnValue(
        "qrl_estimateGas",
        numberToRpcQuantity(123)
      );
      mockedProvider.setReturnValue("qrl_gasPrice", numberToRpcQuantity(123));
    });

    it("Should normalize numeric qrl_call transaction quantities", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      await provider.send("qrl_call", [
        {
          from: qrlAddressFromSeed(QRL_SEEDS[0]),
          to: qrlAddressFromSeed(QRL_SEEDS[1]),
          gas: 30000000,
          value: 42,
          nonce: 7,
          maxFeePerGas: "20",
          maxPriorityFeePerGas: "5",
        },
        "latest",
      ]);

      const [tx, blockTag] = mockedProvider.getLatestParams("qrl_call");
      assert.equal(tx.gas, numberToRpcQuantity(30000000));
      assert.equal(tx.value, numberToRpcQuantity(42));
      assert.equal(tx.nonce, numberToRpcQuantity(7));
      assert.equal(tx.maxFeePerGas, numberToRpcQuantity(20));
      assert.equal(tx.maxPriorityFeePerGas, numberToRpcQuantity(5));
      assert.equal(blockTag, "latest");
    });

    it("Should normalize numeric qrl_estimateGas transaction quantities", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      await provider.send("qrl_estimateGas", [
        {
          from: qrlAddressFromSeed(QRL_SEEDS[0]),
          to: qrlAddressFromSeed(QRL_SEEDS[1]),
          gasLimit: 12345,
          gasPrice: 9,
          chainId: 1337,
        },
      ]);

      const [tx] = mockedProvider.getLatestParams("qrl_estimateGas");
      assert.equal(tx.gasLimit, numberToRpcQuantity(12345));
      assert.equal(tx.gasPrice, numberToRpcQuantity(9));
      assert.equal(tx.chainId, numberToRpcQuantity(1337));
    });

    it("Should normalize explicit numeric qrl_sendTransaction quantities", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      await provider.send("qrl_sendTransaction", [
        {
          from: qrlAddressFromSeed(QRL_SEEDS[0]),
          to: qrlAddressFromSeed(QRL_SEEDS[1]),
          gas: 21000,
          gasPrice: 3,
          value: 1,
        },
      ]);

      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(tx.gas, numberToRpcQuantity(21000));
      assert.equal(tx.gasPrice, numberToRpcQuantity(3));
      assert.equal(tx.value, numberToRpcQuantity(1));
    });
  });

  describe("Gas wrapping", () => {
    const OTHER_GAS_MULTIPLIER = 1.337;

    beforeEach(() => {
      mockedProvider.setReturnValue(
        "qrl_estimateGas",
        numberToRpcQuantity(123)
      );

      mockedProvider.setReturnValue("qrl_gasPrice", numberToRpcQuantity(123));
    });

    it("Should wrap with an auto gas provider if 'auto' is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        gas: "auto",
      });

      await provider.send("qrl_sendTransaction", [
        { from: qrlAddressFromSeed(QRL_SEEDS[0]) },
      ]);
      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(tx.gas, numberToRpcQuantity(123));
    });

    it("Should wrap with an auto gas provider if undefined is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      await provider.send("qrl_sendTransaction", [
        { from: qrlAddressFromSeed(QRL_SEEDS[0]) },
      ]);
      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(
        tx.gas,
        numberToRpcQuantity(Math.floor(123 * DEFAULT_GAS_MULTIPLIER))
      );
    });

    it("Should use the gasMultiplier", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        gasMultiplier: OTHER_GAS_MULTIPLIER,
      });

      await provider.send("qrl_sendTransaction", [
        { from: qrlAddressFromSeed(QRL_SEEDS[0]) },
      ]);
      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(
        tx.gas,
        numberToRpcQuantity(Math.floor(123 * OTHER_GAS_MULTIPLIER))
      );
    });

    it("Should wrap with a fixed gas provider if a number is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        gas: 678,
      });

      await provider.send("qrl_sendTransaction", [
        { from: qrlAddressFromSeed(QRL_SEEDS[0]) },
      ]);
      const [tx] = mockedProvider.getLatestParams("qrl_sendTransaction");
      assert.equal(tx.gas, numberToRpcQuantity(678));
    });
  });

  describe("Gas price wrapping", () => {
    beforeEach(() => {
      mockedProvider.setReturnValue("qrl_gasPrice", numberToRpcQuantity(123));
    });

    it("Should wrap with an auto gas price provider if 'auto' is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        gasPrice: "auto",
      });

      const gasPrice = await provider.send("qrl_gasPrice");
      assert.equal(gasPrice, numberToRpcQuantity(123));
    });

    it("Should wrap with an auto gas price provider if undefined is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
      });

      const gasPrice = await provider.send("qrl_gasPrice");
      assert.equal(gasPrice, numberToRpcQuantity(123));
    });

    it("Should wrap with a fixed gas price provider if a number is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        gasPrice: 789,
      });

      await provider.send("qrl_sendTransaction", [{}]);
      const [{ gasPrice }] = mockedProvider.getLatestParams(
        "qrl_sendTransaction"
      );

      assert.equal(gasPrice, numberToRpcQuantity(789));
    });
  });

  describe("Chain ID wrapping", () => {
    it("Should wrap with a chain id validation provider if a chainId is used", async () => {
      const provider = wrapQrlProvider(mockedProvider, {
        url: "",
        chainId: 2,
      });

      await expectHardhatErrorAsync(
        () => provider.send("qrl_getAccounts", []),
        ERRORS.NETWORK.INVALID_GLOBAL_CHAIN_ID
      );
    });
  });
});
