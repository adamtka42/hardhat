import { assert } from "chai";

import { saveArtifact } from "../../../src/internal/artifacts";
import { ERRORS } from "../../../src/internal/core/errors-list";
import { toQrlChecksumAddress } from "../../../src/internal/qrl/address";
import { createQrlRuntimeHelpers } from "../../../src/internal/qrl/helpers";
import { Artifact, HardhatRuntimeEnvironment } from "../../../src/types";
import {
  expectHardhatError,
  expectHardhatErrorAsync,
} from "../../helpers/errors";
import { useTmpDir } from "../../helpers/fs";
import { MockedProvider } from "../core/providers/mocks";

describe("QRL runtime helpers", () => {
  const contractAddress = `Q${"a".repeat(128)}`;
  const checksummedContractAddress = toQrlChecksumAddress(contractAddress);
  const txHash = `0x${"1".repeat(64)}`;
  let provider: MockedProvider;
  let artifact: Artifact;
  let helpers: ReturnType<typeof createQrlRuntimeHelpers>;

  useTmpDir("qrl-runtime-helpers");

  beforeEach(async function () {
    provider = new MockedProvider();
    artifact = {
      abi: [
        {
          inputs: [
            { name: "initialValue", type: "uint256" },
            { name: "initialOwner", type: "address" },
          ],
          stateMutability: "nonpayable",
          type: "constructor",
        },
        {
          inputs: [{ name: "newValue", type: "uint256" }],
          name: "store",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [],
          name: "retrieve",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "owner",
          outputs: [{ name: "", type: "address" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [{ name: "owner", type: "address" }],
          name: "setOwner",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [{ name: "key", type: "bytes32" }],
          name: "setKey",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [{ name: "newMessage", type: "string" }],
          name: "setMessage",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [{ name: "data", type: "bytes" }],
          name: "setBlob",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [{ name: "values", type: "uint256[]" }],
          name: "setAmounts",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [],
          name: "message",
          outputs: [{ name: "", type: "string" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "blob",
          outputs: [{ name: "", type: "bytes" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [],
          name: "amounts",
          outputs: [{ name: "", type: "uint256[]" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [
            { name: "node", type: "bytes32" },
            { name: "addr", type: "address" },
          ],
          name: "setAddr",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [
            { name: "node", type: "bytes32" },
            { name: "coinType", type: "uint" },
            { name: "data", type: "bytes" },
          ],
          name: "setAddr",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [{ name: "node", type: "bytes32" }],
          name: "addr",
          outputs: [{ name: "", type: "address" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [
            { name: "node", type: "bytes32" },
            { name: "coinType", type: "uint" },
          ],
          name: "addr",
          outputs: [{ name: "", type: "bytes" }],
          stateMutability: "view",
          type: "function",
        },
        {
          anonymous: false,
          inputs: [
            { indexed: true, name: "from", type: "address" },
            { indexed: true, name: "to", type: "address" },
            { indexed: false, name: "value", type: "uint256" },
          ],
          name: "Transfer",
          type: "event",
        },
        {
          anonymous: false,
          inputs: [{ indexed: false, name: "value", type: "string" }],
          name: "MessageChanged",
          type: "event",
        },
      ],
      bytecode: "0x1234",
      contractName: "Sample",
      deployedBytecode: "0xabcd",
      deployedLinkReferences: {},
      linkReferences: {},
    };

    await saveArtifact(this.tmpDir, artifact);

    helpers = createQrlRuntimeHelpers(({
      config: {
        paths: {
          artifacts: this.tmpDir,
        },
      },
      network: {
        provider,
      },
    } as any) as HardhatRuntimeEnvironment);
  });

  it("deploys a contract and returns the mined receipt address", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      transactionHash: txHash.toUpperCase(),
      status: "0x1",
    });

    const result = await helpers.deployContract(
      "Sample",
      { from: contractAddress },
      "0xbeef"
    );

    assert.equal(result.hash, txHash);
    assert.equal(result.address, checksummedContractAddress);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: "0x1234beef",
        from: contractAddress,
      },
    ]);
  });

  it("deploys a contract with ABI-encoded constructor arguments", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      status: "0x1",
    });

    const factory = await helpers.getContractFactory("Sample");
    const result = await factory.deploy({ from: contractAddress }, [
      42,
      contractAddress,
    ]);

    assert.equal(result.hash, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: `0x1234${"0".repeat(126)}2a${contractAddress.slice(1)}`,
        from: contractAddress,
      },
    ]);
  });

  it("deploys a contract with custom wait options", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      status: "0x1",
    });

    const factory = await helpers.getContractFactory("Sample");
    await factory.deploy({ from: contractAddress }, [42, contractAddress], {
      pollIntervalMs: 1,
      timeoutMs: 1,
    });

    assert.deepEqual(provider.getLatestParams("qrl_getTransactionReceipt"), [
      txHash,
    ]);
  });

  it("rejects invalid constructor data", async () => {
    await expectHardhatErrorAsync(
      () => helpers.deployContract("Sample", {}, "0xz"),
      ERRORS.NETWORK.INVALID_HEX_DATA,
      "0xz"
    );
  });

  it("rejects invalid artifact bytecode", async function () {
    artifact.bytecode = "0x123";
    await saveArtifact(this.tmpDir, artifact);

    await expectHardhatErrorAsync(
      () => helpers.deployContract("Sample"),
      ERRORS.NETWORK.INVALID_HEX_DATA,
      "0x123"
    );
  });

  it("rejects a failed deployment receipt", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      status: "0x0",
    });

    await expectHardhatErrorAsync(
      () => helpers.deployContract("Sample"),
      ERRORS.NETWORK.DEPLOYMENT_FAILED,
      txHash
    );
  });

  it("rejects a deployment receipt without a contract address", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      status: "0x1",
    });

    await expectHardhatErrorAsync(
      () => helpers.deployContract("Sample"),
      ERRORS.NETWORK.MISSING_CONTRACT_ADDRESS,
      txHash
    );
  });

  it("rejects a deployment receipt with an invalid contract address", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress: `Q${"a".repeat(96)}`,
      status: "0x1",
    });

    await expectHardhatErrorAsync(
      () => helpers.deployContract("Sample"),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS
    );
  });

  it("times out while waiting for a missing transaction receipt", async () => {
    provider.setReturnValue("qrl_getTransactionReceipt", null);

    await expectHardhatErrorAsync(
      () => helpers.waitForTransaction(txHash, 1, 1),
      ERRORS.NETWORK.NETWORK_TIMEOUT
    );
  });

  it("rejects a transaction receipt for a different hash", async () => {
    provider.setReturnValue("qrl_getTransactionReceipt", {
      status: "0x1",
      transactionHash: `0x${"2".repeat(64)}`,
    });

    await expectHardhatErrorAsync(
      () => helpers.waitForTransaction(txHash, 1, 1),
      ERRORS.NETWORK.TRANSACTION_RECEIPT_MISMATCH,
      txHash
    );
  });

  it("attaches contracts and forwards call/send requests", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    assert.equal(contract.address, checksummedContractAddress);

    await contract.call("0x1122", { from: contractAddress }, "latest");
    await contract.sendTransaction("0x3344", { from: contractAddress });

    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: "0x1122",
        from: contractAddress,
        to: checksummedContractAddress,
      },
      "latest",
    ]);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: "0x3344",
        from: contractAddress,
        to: checksummedContractAddress,
      },
    ]);
  });

  it("encodes QRL function calldata using 64-byte words", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    assert.equal(
      contract.encodeFunctionData("store", [42]),
      `0x6057361d${"0".repeat(126)}2a`
    );
    assert.equal(
      contract.encodeFunctionData("setOwner", [contractAddress]),
      `0x13af4035${contractAddress.slice(1)}`
    );
    assert.equal(
      contract.encodeFunctionData("setKey", [`0x${"11".repeat(32)}`]),
      `0xc3d2c355${"11".repeat(32)}${"0".repeat(64)}`
    );
  });

  it("rejects invalid QIP-55 checksum addresses in ABI calldata", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const invalidMixedCaseAddress =
      "Qa73C065F7018CC0cFFf98028D8Ef1Ff746f5Cb425bC8840A4CDC2A6Eb717faa121A2e959A6A0Dac2D7C38252d70E4541397b0967880f00b9bD0c4C5d0FC46b2D";

    expectHardhatError(
      () => contract.encodeFunctionData("setOwner", [invalidMixedCaseAddress]),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Invalid QRL address"
    );
  });

  it("encodes dynamic QRL function calldata using 64-byte offsets", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const offset = `${"0".repeat(126)}40`;
    const hello = "68656c6c6f";

    assert.equal(
      contract.encodeFunctionData("setMessage", ["hello"]),
      `0x368b8772${offset}${"0".repeat(127)}5${hello}${"0".repeat(118)}`
    );
    assert.equal(
      contract.encodeFunctionData("setBlob", ["0x123456"]),
      `0xdd7d5edb${offset}${"0".repeat(127)}3${"123456"}${"0".repeat(122)}`
    );
    assert.equal(
      contract.encodeFunctionData("setAmounts", [[1, 2]]),
      `0x4331153c${offset}${"0".repeat(127)}2${"0".repeat(127)}1${"0".repeat(
        127
      )}2`
    );
  });

  it("sends ABI-encoded contract functions", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.sendFunction("store", [42], {
      from: contractAddress,
    });

    assert.equal(result, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: `0x6057361d${"0".repeat(126)}2a`,
        from: contractAddress,
        to: checksummedContractAddress,
      },
    ]);
  });

  it("sends contract functions through ergonomic wrappers", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.functions.store(42, {
      from: contractAddress,
    });

    assert.equal(result, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: `0x6057361d${"0".repeat(126)}2a`,
        from: contractAddress,
        to: checksummedContractAddress,
      },
    ]);
  });

  it("calls and decodes ABI-encoded contract functions", async () => {
    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.callFunction(
      "retrieve",
      [],
      { from: contractAddress },
      "latest"
    );

    assert.equal(result[0].toString(10), "42");
    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: "0x2e64cec1",
        from: contractAddress,
        to: checksummedContractAddress,
      },
      "latest",
    ]);
  });

  it("calls contract functions through ergonomic wrappers", async () => {
    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.functions.retrieve(
      { from: contractAddress },
      "latest"
    );

    assert.equal(result[0].toString(10), "42");
    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: "0x2e64cec1",
        from: contractAddress,
        to: checksummedContractAddress,
      },
      "latest",
    ]);
  });

  it("decodes QRL address return values as checksummed addresses", async () => {
    const owner = `Q${"b".repeat(128)}`;
    provider.setReturnValue("qrl_call", `0x${owner.slice(1)}`);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.callFunction("owner");

    assert.equal(result[0], toQrlChecksumAddress(owner));
    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: "0x8da5cb5b",
        to: checksummedContractAddress,
      },
      "latest",
    ]);
  });

  it("supports explicit callStatic and send wrappers", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
    const result = await contract.callStatic.retrieve();
    assert.equal(result[0].toString(10), "42");

    provider.setReturnValue("qrl_sendTransaction", txHash);
    const hash = await contract.send.store(42, { from: contractAddress });
    assert.equal(hash, txHash);
  });

  it("calls and decodes dynamic ABI-encoded contract functions", async () => {
    const offset = `${"0".repeat(126)}40`;
    const hello = "68656c6c6f";
    provider.setReturnValue(
      "qrl_call",
      `0x${offset}${"0".repeat(127)}5${hello}${"0".repeat(118)}`
    );

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.callFunction("message");

    assert.equal(result[0], "hello");
    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: "0xe21f37ce",
        to: checksummedContractAddress,
      },
      "latest",
    ]);
  });

  it("decodes dynamic QRL bytes and array results", async () => {
    const offset = `${"0".repeat(126)}40`;
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue(
      "qrl_call",
      `0x${offset}${"0".repeat(127)}3${"123456"}${"0".repeat(122)}`
    );
    assert.equal((await contract.callFunction("blob"))[0], "0x123456");

    provider.setReturnValue(
      "qrl_call",
      `0x${offset}${"0".repeat(127)}2${"0".repeat(127)}1${"0".repeat(127)}2`
    );

    const amounts = (await contract.callFunction("amounts"))[0];
    assert.equal(amounts[0].toString(10), "1");
    assert.equal(amounts[1].toString(10), "2");
  });

  it("calls overloaded view functions through full signatures", async () => {
    const node = `0x${"11".repeat(32)}`;
    const recipient = `Q${"b".repeat(128)}`;
    provider.setReturnValue("qrl_call", `0x${recipient.slice(1)}`);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.callStatic["addr(bytes32)"](
      node,
      { from: contractAddress },
      "latest"
    );

    assert.equal(result[0], toQrlChecksumAddress(recipient));
    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: contract.encodeFunctionData("addr(bytes32)", [node]),
        from: contractAddress,
        to: checksummedContractAddress,
      },
      "latest",
    ]);
  });

  it("calls overloaded read functions through the functions map", async () => {
    const node = `0x${"11".repeat(32)}`;
    const recipient = `Q${"b".repeat(128)}`;
    provider.setReturnValue("qrl_call", `0x${recipient.slice(1)}`);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.functions["addr(bytes32)"](node);

    assert.equal(result[0], toQrlChecksumAddress(recipient));
    assert.deepEqual(provider.getLatestParams("qrl_call"), [
      {
        data: contract.encodeFunctionData("addr(bytes32)", [node]),
        to: checksummedContractAddress,
      },
      "latest",
    ]);
  });

  it("sends overloaded functions through the functions map", async () => {
    const node = `0x${"11".repeat(32)}`;
    const recipient = `Q${"b".repeat(128)}`;
    provider.setReturnValue("qrl_sendTransaction", txHash);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.functions["setAddr(bytes32,address)"](
      node,
      recipient,
      { from: contractAddress }
    );

    assert.equal(result, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: contract.encodeFunctionData("setAddr(bytes32,address)", [
          node,
          recipient,
        ]),
        from: contractAddress,
        to: checksummedContractAddress,
      },
    ]);
  });

  it("sends overloaded functions through the explicit send map", async () => {
    const node = `0x${"11".repeat(32)}`;
    provider.setReturnValue("qrl_sendTransaction", txHash);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const result = await contract.send["setAddr(bytes32,uint256,bytes)"](
      node,
      60,
      "0x1234",
      { from: contractAddress }
    );

    assert.equal(result, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: contract.encodeFunctionData("setAddr(bytes32,uint,bytes)", [
          node,
          60,
          "0x1234",
        ]),
        from: contractAddress,
        to: checksummedContractAddress,
      },
    ]);
  });

  it("encodes and decodes overloaded functions by full signature", async () => {
    const node = `0x${"11".repeat(32)}`;
    const recipient = `Q${"b".repeat(128)}`;

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const encoded = contract.encodeFunctionData("setAddr(bytes32,address)", [
      node,
      recipient,
    ]);
    const decoded = contract.decodeFunctionResult(
      "addr(bytes32)",
      `0x${recipient.slice(1)}`
    );

    assert.equal(encoded.length, 266);
    assert.equal(decoded[0], toQrlChecksumAddress(recipient));
  });

  it("rejects overloaded function lookup by bare name", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    assert.equal(contract.functions.setAddr, undefined);
    assert.equal(contract.callStatic.addr, undefined);
    expectHardhatError(
      () => contract.encodeFunctionData("setAddr", []),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Function setAddr is overloaded. Use a full signature like setAddr(bytes32,address)."
    );
    expectHardhatError(
      () => contract.decodeFunctionResult("addr", "0x"),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Function addr is overloaded. Use a full signature like addr(bytes32)."
    );
    await expectHardhatErrorAsync(
      () => contract.callFunction("addr"),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Function addr is overloaded. Use a full signature like addr(bytes32)."
    );
    expectHardhatError(
      () => contract.sendFunction("setAddr"),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Function setAddr is overloaded. Use a full signature like setAddr(bytes32,address)."
    );
  });


  it("decodes QRL event logs using 64-byte topics and data words", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const recipient = `Q${"b".repeat(128)}`;
    const log = {
      address: contractAddress,
      data: `0x${"0".repeat(126)}2a`,
      topics: [
        `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef${"0".repeat(
          64
        )}`,
        `0x${contractAddress.slice(1)}`,
        `0x${recipient.slice(1)}`,
      ],
    };

    const decoded = contract.decodeEventLog("Transfer", log);

    assert.equal(decoded.eventName, "Transfer");
    assert.equal(decoded.args.from, toQrlChecksumAddress(contractAddress));
    assert.equal(decoded.args.to, toQrlChecksumAddress(recipient));
    assert.equal(decoded.args.value.toString(10), "42");
  });

  it("decodes QRL event logs with dynamic data", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const offset = `${"0".repeat(126)}40`;
    const hello = "68656c6c6f";
    const log = {
      address: contractAddress,
      data: `0x${offset}${"0".repeat(127)}5${hello}${"0".repeat(118)}`,
      topics: [
        `0xbb4847942d98bb5bb249692c72ce235605e41502e705831e609875320ef2cac7${"0".repeat(
          64
        )}`,
      ],
    };

    const decoded = contract.decodeEventLog("MessageChanged", log);

    assert.equal(decoded.eventName, "MessageChanged");
    assert.equal(decoded.args.value, "hello");
  });

  it("decodes matching QRL receipt logs", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const recipient = `Q${"b".repeat(128)}`;
    const transferLog = {
      address: contractAddress,
      data: `0x${"0".repeat(126)}2a`,
      topics: [
        `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef${"0".repeat(
          64
        )}`,
        `0x${contractAddress.slice(1)}`,
        `0x${recipient.slice(1)}`,
      ],
    };
    const receipt = {
      logs: [
        {
          address: `Q${"c".repeat(128)}`,
          data: "0x",
          topics: [],
        },
        transferLog,
      ],
    };

    const decoded = contract.decodeReceiptLogs(receipt);

    assert.lengthOf(decoded, 1);
    assert.equal(decoded[0].eventName, "Transfer");
    assert.equal(decoded[0].args.value.toString(10), "42");
  });

  it("matches receipt logs with differently cased QRL addresses", async () => {
    const contract = await helpers.getContractAt(
      "Sample",
      toQrlChecksumAddress(contractAddress)
    );
    const recipient = `Q${"b".repeat(128)}`;
    const receipt = {
      logs: [
        {
          address: contractAddress.toLowerCase().replace(/^q/, "Q"),
          data: `0x${"0".repeat(126)}2a`,
          topics: [
            `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef${"0".repeat(
              64
            )}`,
            `0x${contractAddress.slice(1)}`,
            `0x${recipient.slice(1)}`,
          ],
        },
      ],
    };

    const decoded = contract.decodeReceiptLogs(receipt);

    assert.lengthOf(decoded, 1);
    assert.equal(decoded[0].eventName, "Transfer");
  });

  it("ignores unknown receipt logs from the same QRL contract", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const receipt = {
      logs: [
        {
          address: contractAddress,
          data: "0x",
          topics: [`0x${"1".repeat(128)}`],
        },
      ],
    };

    assert.deepEqual(contract.decodeReceiptLogs(receipt), []);
  });

  it("rejects invalid contract call data", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    await expectHardhatErrorAsync(
      () => contract.call("0xz"),
      ERRORS.NETWORK.INVALID_HEX_DATA,
      "0xz"
    );
  });

  it("rejects attaching a contract with an invalid QRL address", async () => {
    await expectHardhatErrorAsync(
      () => helpers.getContractAt("Sample", `Q${"a".repeat(96)}`),
      ERRORS.NETWORK.INVALID_QRL_ADDRESS
    );
  });
});
