import { assert } from "chai";

import { ERRORS } from "../../../../src/internal/core/errors-list";
import {
  createLocalAccountsProvider,
  createSenderProvider,
  JsonRpcTransactionData,
} from "../../../../src/internal/core/providers/accounts";
import {
  createLedgerAccountsProvider,
  LedgerTransport,
} from "../../../../src/internal/core/providers/ledger";
import { numberToRpcQuantity } from "../../../../src/internal/core/providers/provider-utils";
import { wrapSend } from "../../../../src/internal/core/providers/wrapper";
import { toQrlChecksumAddress } from "../../../../src/internal/qrl/address";
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

const LEDGER_ADDRESS = `Q${"a".repeat(128)}`;

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
    mock.setReturnValue("qrl_chainId", numberToRpcQuantity(123));
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

  it("Should throw when locally signing without from", async () => {
    await expectHardhatErrorAsync(
      () =>
        wrapper.send("qrl_sendTransaction", [
          {
            to: qrlAddresses[1],
            gas: 21000,
            maxFeePerGas: 1,
            maxPriorityFeePerGas: 1,
            nonce: 0,
            value: 1,
          },
        ]),
      ERRORS.NETWORK.MISSING_TX_PARAM_TO_SIGN_LOCALLY,
      "from"
    );
  });

  it("Should reject invalid local transaction data", async () => {
    await expectHardhatErrorAsync(
      () =>
        wrapper.send("qrl_sendTransaction", [
          {
            from: qrlAddresses[0],
            to: qrlAddresses[1],
            gas: 21000,
            maxFeePerGas: 1,
            maxPriorityFeePerGas: 1,
            nonce: 0,
            value: 1,
            data: "0x123",
          },
        ]),
      ERRORS.NETWORK.INVALID_HEX_DATA,
      "0x123"
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

  it("Should reject invalid mixed-case QRL recipient addresses", async () => {
    await expectHardhatErrorAsync(
      () =>
        wrapper.send("qrl_sendTransaction", [
          {
            from: qrlAddresses[0],
            to:
              "QA73C065F7018CC0cFFf98028D8Ef1Ff746f5Cb425bC8840A4CDC2A6Eb717faa121A2e959A6A0Dac2D7C38252d70E4541397b0967880f00b9bD0c4C5d0FC46b2d",
            gas: 21000,
            maxFeePerGas: 1,
            maxPriorityFeePerGas: 1,
          },
        ]),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS
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

    it("Should reject invalid qrl_sign data", async () => {
      await expectHardhatErrorAsync(
        () => wrapper.send("qrl_sign", [qrlAddresses[0], "0xz"]),
        ERRORS.NETWORK.INVALID_HEX_DATA,
        "0xz"
      );
    });

    it("Should reject odd-length qrl_sign data", async () => {
      await expectHardhatErrorAsync(
        () => wrapper.send("qrl_sign", [qrlAddresses[0], "0x1"]),
        ERRORS.NETWORK.INVALID_HEX_DATA,
        "0x1"
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

describe("Ledger accounts provider", () => {
  let mock: MockedProvider;
  let transport: MockLedgerTransport;
  let wrapper: IQrlProvider;

  beforeEach(() => {
    mock = new MockedProvider();
    mock.setReturnValue("qrl_chainId", numberToRpcQuantity(123));
    mock.setReturnValue("qrl_getTransactionCount", numberToRpcQuantity(0x8));
    mock.setReturnValue("qrl_accounts", [nonLocalAddress()]);
    mock.setReturnValue("qrl_sendRawTransaction", `0x${"1".repeat(64)}`);

    transport = new MockLedgerTransport(LEDGER_ADDRESS);
    wrapper = createLedgerAccountsProvider(
      mock,
      {
        type: "ledger",
        accounts: [LEDGER_ADDRESS],
      },
      {
        transportFactory: {
          create: async () => transport,
        },
      }
    );
  });

  it("Should include QRL Ledger addresses in qrl_accounts", async () => {
    const response = await wrapper.send("qrl_accounts");

    assert.deepEqual(response, [
      toQrlChecksumAddress(nonLocalAddress()),
      toQrlChecksumAddress(LEDGER_ADDRESS),
    ]);
  });

  it("Should sign and forward QRL Ledger dynamic fee transactions", async () => {
    const result = await wrapper.send("qrl_sendTransaction", [
      {
        from: LEDGER_ADDRESS,
        to: nonLocalAddress(),
        gas: 21000,
        maxFeePerGas: 2250000007,
        maxPriorityFeePerGas: 2250000000,
        nonce: 0,
        chainId: 123,
        value: 1,
      },
    ]);

    assert.equal(result, `0x${"1".repeat(64)}`);
    assert.equal(transport.signPath, "m/44'/238'/0'/0/0");
    assert.equal(transport.signedPayload[0], 0x02);

    const [rawTransaction] = mock.getLatestParams("qrl_sendRawTransaction");
    assert.isString(rawTransaction);
    assert.match(rawTransaction, /^0x02[0-9a-f]+$/i);
  });

  it("Should derive the nonce for QRL Ledger transactions", async () => {
    await wrapper.send("qrl_sendTransaction", [
      {
        from: LEDGER_ADDRESS,
        to: nonLocalAddress(),
        gas: 21000,
        gasPrice: 678912,
        chainId: 123,
        value: 1,
      },
    ]);

    assert.equal(mock.getNumberOfCalls("qrl_getTransactionCount"), 1);
  });

  it("Should reject invalid QRL Ledger transaction data", async () => {
    await expectHardhatErrorAsync(
      () =>
        wrapper.send("qrl_sendTransaction", [
          {
            from: LEDGER_ADDRESS,
            to: nonLocalAddress(),
            gas: 21000,
            gasPrice: 678912,
            nonce: 0,
            chainId: 123,
            value: 1,
            data: "0x123",
          },
        ]),
      ERRORS.NETWORK.INVALID_HEX_DATA,
      "0x123"
    );
  });

  it("Should forward transactions from non-ledger accounts", async () => {
    await wrapper.send("qrl_sendTransaction", [
      {
        from: nonLocalAddress(),
        to: LEDGER_ADDRESS,
        gas: 21000,
        gasPrice: 678912,
        nonce: 0,
        chainId: 123,
        value: 1,
      },
    ]);

    assert.isUndefined(mock.getLatestParams("qrl_sendRawTransaction"));
    assert.equal(mock.getNumberOfCalls("qrl_sendTransaction"), 1);
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

  it("Should normalize fixed sender addresses", async () => {
    const lowercaseSender = qrlAddresses[0].toLowerCase().replace(/^q/, "Q");
    wrapper = createSenderProvider(provider, lowercaseSender);

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

  it("Should normalize remote sender accounts", async () => {
    const lowercaseRemoteAccount = qrlAddresses[0]
      .toLowerCase()
      .replace(/^q/, "Q");
    provider = wrapSend(mock, async (method, requestParams) => {
      if (method === "qrl_accounts") {
        return [lowercaseRemoteAccount];
      }
      return mock.send(method, requestParams);
    });
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

class MockLedgerTransport implements LedgerTransport {
  public signPath?: string;
  public signedPayload: Buffer = Buffer.alloc(0);

  private readonly _addressResponse: Buffer;
  private readonly _publicKeyChunks: Buffer[];
  private readonly _signatureChunks: Buffer[];

  constructor(address: string) {
    this._addressResponse = Buffer.concat([
      Buffer.from("Q"),
      Buffer.from(address.slice(1), "hex"),
    ]);
    this._publicKeyChunks = splitFixed(Buffer.alloc(255 * 11, 0x11), 255);
    this._signatureChunks = splitFixed(Buffer.alloc(255 * 18, 0x22), 255);
  }

  public async send(
    _cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer
  ): Promise<Buffer> {
    if (ins === 0x03) {
      return Buffer.from([1, 0, 0]);
    }

    if (ins === 0x05) {
      if (p2 === 0) {
        return this._addressResponse;
      }

      return this._publicKeyChunks[p2 - 1];
    }

    if (ins === 0x06) {
      if (p1 === 0x00) {
        this.signPath = unpackPath(data!);
        return Buffer.alloc(0);
      }

      if (p1 === 0x01) {
        this.signedPayload = Buffer.concat([this.signedPayload, data!]);
        return Buffer.alloc(0);
      }

      if (p1 === 0x02) {
        if (p2 === 0) {
          this.signedPayload = Buffer.concat([this.signedPayload, data!]);
        }

        return this._signatureChunks[p2];
      }
    }

    throw new Error(`Unexpected APDU ins=${ins} p1=${p1} p2=${p2}`);
  }
}

function splitFixed(value: Buffer, size: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < value.length; offset += size) {
    chunks.push(value.slice(offset, offset + size));
  }
  return chunks;
}

function unpackPath(data: Buffer): string {
  const parts: string[] = [];
  for (let i = 0; i < data[0]; i++) {
    const value = data.readUInt32BE(1 + i * 4);
    const hardened = value >= 0x80000000;
    parts.push(
      `${hardened ? value - 0x80000000 : value}${hardened ? "'" : ""}`
    );
  }

  return `m/${parts.join("/")}`;
}
