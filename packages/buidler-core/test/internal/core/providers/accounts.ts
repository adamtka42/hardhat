import { assert } from "chai";

import { ERRORS } from "../../../../src/internal/core/errors-list";
import {
  createLocalAccountsProvider,
  createSenderProvider,
  JsonRpcTransactionData,
} from "../../../../src/internal/core/providers/accounts";
import { numberToRpcQuantity } from "../../../../src/internal/core/providers/provider-utils";
import { wrapSend } from "../../../../src/internal/core/providers/wrapper";
import { IQrlProvider } from "../../../../src/types";
import {
  expectHardhatError,
  expectHardhatErrorAsync,
} from "../../../helpers/errors";

import { MockedProvider } from "./mocks";

const QRL_SEEDS = [
  "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be401",
  "0x0100002fa45cae7e96414b644715d0e29de4ca12864fe7d52f3260545ad7c280bd7ceee79627d99d3bf9a1bbb2bcd73d5be402",
];

function seedToAddress(seed: string): string {
  const { seedToAccount } = require("@theqrl/web3-qrl-accounts");
  return seedToAccount(seed).address;
}

function expectQrlAddress(address: string) {
  assert.match(address, /^Q[0-9a-fA-F]{128}$/);
}

function nonLocalAddress(): string {
  return `Q${"f".repeat(128)}`;
}

describe("Local accounts provider", () => {
  let mock: MockedProvider;
  let wrapper: IQrlProvider;
  let qrlAddresses: string[];

  beforeEach(() => {
    mock = new MockedProvider();
    mock.setReturnValue("net_version", numberToRpcQuantity(123));
    mock.setReturnValue("qrl_getTransactionCount", numberToRpcQuantity(0x8));
    mock.setReturnValue("qrl_accounts", []);

    qrlAddresses = QRL_SEEDS.map(seedToAddress);
    wrapper = createLocalAccountsProvider(mock, QRL_SEEDS);
  });

  it("Should return QRL account addresses in qrl_accounts", async () => {
    const response = await wrapper.send("qrl_accounts");

    assert.deepEqual(response, qrlAddresses);
    response.forEach(expectQrlAddress);
  });

  it("Should return QRL account addresses in qrl_requestAccounts", async () => {
    const response = await wrapper.send("qrl_requestAccounts");

    assert.deepEqual(response, qrlAddresses);
    response.forEach(expectQrlAddress);
  });

  it("Should throw when calling sendTransaction without gas", async () => {
    const params = [
      {
        from: qrlAddresses[0],
        to: qrlAddresses[1],
        gasPrice: 0x3b9aca00,
        nonce: 0x8,
        chainId: 123,
      },
    ];

    await expectHardhatErrorAsync(
      () => wrapper.send("qrl_sendTransaction", params),
      ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
      "gas"
    );
  });

  it("Should throw when calling sendTransaction without fee fields", async () => {
    const params = [
      {
        from: qrlAddresses[0],
        to: qrlAddresses[1],
        nonce: 0x8,
        chainId: 123,
        gas: 123,
      },
    ];

    await expectHardhatErrorAsync(
      () => wrapper.send("qrl_sendTransaction", params),
      ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
      "maxFeePerGas"
    );
  });

  it("Should sign and forward a QRL dynamic fee transaction", async () => {
    await wrapper.send("qrl_sendTransaction", [
      {
        from: qrlAddresses[0],
        to: qrlAddresses[1],
        gas: 21000,
        maxFeePerGas: 2250000007,
        maxPriorityFeePerGas: 2250000000,
        nonce: 0,
        chainId: 123,
        value: 1,
      },
    ]);

    const rawTransaction = mock.getLatestParams("qrl_sendRawTransaction")[0];

    assert.isString(rawTransaction);
    assert.match(rawTransaction, /^0x[0-9a-f]+$/i);
    assert.isAbove(rawTransaction.length, 1000);
  });

  it("Should throw if trying to send from an account that isnt local", async () => {
    await expectHardhatErrorAsync(
      () =>
        wrapper.send("qrl_sendTransaction", [
          {
            from: nonLocalAddress(),
            to: qrlAddresses[1],
            gas: 21000,
            gasPrice: 678912,
            nonce: 0,
            chainId: 123,
            value: 1,
          },
        ]),
      ERRORS.NETWORK.NOT_LOCAL_ACCOUNT,
      nonLocalAddress()
    );
  });

  it("Should forward other methods", async () => {
    const input = [1, 2];
    await wrapper.send("qrl_sarasa", input);

    assert.deepEqual(mock.getLatestParams("qrl_sarasa"), input);
  });

  it("Should get the nonce if not provided", async () => {
    await wrapper.send("qrl_sendTransaction", [
      {
        from: qrlAddresses[0],
        to: qrlAddresses[1],
        gas: 21000,
        gasPrice: 678912,
        chainId: 123,
        value: 1,
      },
    ]);

    assert.equal(mock.getNumberOfCalls("qrl_getTransactionCount"), 1);
  });

  describe("qrl_sign", () => {
    it("Should sign message data with the local QRL account", async () => {
      const result = await wrapper.send("qrl_sign", [
        qrlAddresses[0],
        "0x41206d657373616765",
      ]);

      assert.isString(result);
      assert.match(result, /^0x[0-9a-f]+$/i);
      assert.isAbove(result.length, 1000);
    });

    it("Should throw if no data is given", async () => {
      await expectHardhatErrorAsync(
        () => wrapper.send("qrl_sign", [qrlAddresses[0]]),
        ERRORS.NETWORK.QRLSIGN_MISSING_DATA_PARAM
      );
    });

    it("Should throw if the address isnt one of the local ones", async () => {
      await expectHardhatErrorAsync(
        () => wrapper.send("qrl_sign", [nonLocalAddress(), "0x00"]),
        ERRORS.NETWORK.NOT_LOCAL_ACCOUNT
      );
    });

    it("Should just forward if no address is given", async () => {
      await wrapper.send("qrl_sign");
      assert.deepEqual(mock.getLatestParams("qrl_sign"), []);
    });
  });
});

describe("Account provider", () => {
  let mock: MockedProvider;
  let provider: IQrlProvider;
  let wrapper: IQrlProvider;
  let tx: JsonRpcTransactionData;
  let qrlAddresses: string[];

  beforeEach(() => {
    qrlAddresses = QRL_SEEDS.map(seedToAddress);
    tx = {
      to: qrlAddresses[1],
      gas: 21000,
      gasPrice: 678912,
      nonce: 0,
      value: 1,
    };

    mock = new MockedProvider();

    provider = wrapSend(mock, async (method, params) => {
      if (method === "qrl_accounts") {
        return [qrlAddresses[0]];
      }
      return mock.send(method, params);
    });

    wrapper = createSenderProvider(provider, qrlAddresses[0]);
  });

  it("Should set the from value into the transaction", async () => {
    await wrapper.send("qrl_sendTransaction", [tx]);

    const params = mock.getLatestParams("qrl_sendTransaction");

    assert.equal(params[0].from, qrlAddresses[0]);
  });

  it("Should not replace transaction from", async () => {
    tx.from = nonLocalAddress();
    await wrapper.send("qrl_sendTransaction", [tx]);

    const params = mock.getLatestParams("qrl_sendTransaction");

    assert.equal(params[0].from, nonLocalAddress());
  });

  it("Should reject invalid transaction from addresses", async () => {
    tx.from = "0x0001";

    await expectHardhatErrorAsync(
      () => wrapper.send("qrl_sendTransaction", [tx]),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS,
      "0x0001"
    );
  });

  it("Should reject invalid transaction to addresses", async () => {
    tx.to = "0x0001";

    await expectHardhatErrorAsync(
      () => wrapper.send("qrl_call", [tx]),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS,
      "0x0001"
    );
  });

  it("Should use the first account if from is missing", async () => {
    wrapper = createSenderProvider(provider);

    await wrapper.send("qrl_sendTransaction", [tx]);

    const params = mock.getLatestParams("qrl_sendTransaction");
    assert.equal(params[0].from, qrlAddresses[0]);
  });

  it("Should not fail if provider doesnt have any accounts", async () => {
    mock.setReturnValue("qrl_accounts", []);
    wrapper = createSenderProvider(mock);

    tx.value = "asd";
    await wrapper.send("qrl_call", [tx]);

    const params = mock.getLatestParams("qrl_call");
    assert.equal(params[0].value, "asd");
  });
});
