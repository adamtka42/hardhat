import { assert } from "chai";

import { saveArtifact } from "../../../src/internal/artifacts";
import { ERRORS } from "../../../src/internal/core/errors-list";
import {
  findFunctionFragment,
  getFunctionSignature,
  getQrlEventTopic,
} from "../../../src/internal/qrl/abi";
import { toQrlChecksumAddress } from "../../../src/internal/qrl/address";
import {
  createQrlRuntimeHelpers,
  createTransactionResponse,
  sendTransactionWithResponse,
} from "../../../src/internal/qrl/helpers";
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
          inputs: [],
          name: "getPair",
          outputs: [
            { name: "amount", type: "uint256" },
            { name: "account", type: "address" },
          ],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [
            {
              components: [
                { name: "threshold", type: "uint256" },
                { name: "active", type: "bool" },
              ],
              name: "config",
              type: "tuple",
            },
          ],
          name: "setConfig",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [],
          name: "hash",
          outputs: [{ name: "", type: "uint256" }],
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
        {
          anonymous: false,
          inputs: [
            { indexed: true, name: "node", type: "bytes32" },
            { indexed: false, name: "value", type: "address" },
          ],
          name: "AddrChanged",
          type: "event",
        },
        {
          anonymous: false,
          inputs: [
            { indexed: true, name: "node", type: "bytes32" },
            { indexed: false, name: "coinType", type: "uint" },
            { indexed: false, name: "value", type: "bytes" },
          ],
          name: "AddrChanged",
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

  it("returns a usable contract wrapper from factory deploy", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      status: "0x1",
      transactionHash: txHash,
    });

    const factory = await helpers.getContractFactory("Sample");
    const contract = await factory.deploy({ from: contractAddress }, [
      42,
      contractAddress,
    ]);

    assert.equal(contract.address, checksummedContractAddress);
    assert.equal(contract.contractName, "Sample");
    assert.isFunction(contract.functions.store);
    assert.isFunction(contract.callStatic.retrieve);

    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
    const stored = await contract.retrieve();
    assert.equal(stored.toString(10), "42");
  });

  it("attaches deployment metadata and transitional aliases to deployed contracts", async () => {
    const deployReceipt = {
      contractAddress,
      status: "0x1",
      transactionHash: txHash,
    };
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", deployReceipt);

    const factory = await helpers.getContractFactory("Sample");
    const contract = await factory.deploy({ from: contractAddress }, [
      42,
      contractAddress,
    ]);

    assert.equal(contract.deployTransactionHash, txHash);
    assert.deepEqual(contract.deployReceipt, deployReceipt);
    assert.equal(contract.hash, txHash);
    assert.deepEqual(contract.receipt, deployReceipt);

    const { address, hash } = contract;
    assert.equal(address, checksummedContractAddress);
    assert.equal(hash, txHash);
  });

  it("resolves deployed() and waitForDeployment() with the same contract", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      status: "0x1",
    });

    const factory = await helpers.getContractFactory("Sample");
    const contract = await factory.deploy({ from: contractAddress }, [
      42,
      contractAddress,
    ]);

    assert.strictEqual(await contract.deployed!(), contract);
    assert.strictEqual(await contract.waitForDeployment!(), contract);
  });

  it("does not attach deployment metadata to attached contracts", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    assert.isUndefined(contract.deployTransactionHash);
    assert.isUndefined(contract.deployReceipt);
    assert.isUndefined(contract.hash);
    assert.isUndefined(contract.receipt);
    assert.isUndefined(contract.deployed);
    assert.isUndefined(contract.waitForDeployment);
  });

  it("prefers an explicit from over default sender sources", async function () {
    const configuredFrom = `Q${"b".repeat(128)}`;
    const localHelpers = createQrlRuntimeHelpers(({
      config: { paths: { artifacts: this.tmpDir } },
      network: { provider, config: { from: configuredFrom }, name: "qrl" },
    } as any) as HardhatRuntimeEnvironment);
    const contract = await localHelpers.getContractAt(
      "Sample",
      contractAddress
    );

    provider.setReturnValue("qrl_sendTransaction", txHash);
    await contract.store(42, { from: contractAddress });

    const params = provider.getLatestParams("qrl_sendTransaction");
    assert.equal(params[0].from, contractAddress);
    assert.equal(provider.getNumberOfCalls("qrl_accounts"), 0);
  });

  it("uses the network config from for direct alias transactions", async function () {
    const configuredFrom = `Q${"b".repeat(128)}`;
    const localHelpers = createQrlRuntimeHelpers(({
      config: { paths: { artifacts: this.tmpDir } },
      network: { provider, config: { from: configuredFrom }, name: "qrl" },
    } as any) as HardhatRuntimeEnvironment);
    const contract = await localHelpers.getContractAt(
      "Sample",
      contractAddress
    );

    provider.setReturnValue("qrl_sendTransaction", txHash);
    const response = await contract.store(42);

    assert.equal(response.hash, txHash);
    const params = provider.getLatestParams("qrl_sendTransaction");
    assert.equal(params[0].from, configuredFrom);
    assert.equal(provider.getNumberOfCalls("qrl_accounts"), 0);
  });

  it("falls back to the first qrl_accounts entry for the default sender", async () => {
    const accountsFrom = `Q${"c".repeat(128)}`;
    provider.setReturnValue("qrl_accounts", [accountsFrom, contractAddress]);
    provider.setReturnValue("qrl_sendTransaction", txHash);

    const contract = await helpers.getContractAt("Sample", contractAddress);
    const response = await contract.store(42);

    assert.equal(response.hash, txHash);
    const params = provider.getLatestParams("qrl_sendTransaction");
    assert.equal(params[0].from, accountsFrom);
  });

  it("throws a clear error when no default sender can be resolved", async () => {
    provider.setReturnValue("qrl_accounts", []);
    const contract = await helpers.getContractAt("Sample", contractAddress);

    await expectHardhatErrorAsync(
      () => contract.store(42),
      ERRORS.NETWORK.MISSING_QRL_SENDER
    );
  });

  it("does not resolve a default sender for view aliases", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
    await contract.retrieve();

    assert.equal(provider.getNumberOfCalls("qrl_accounts"), 0);
    const callParams = provider.getLatestParams("qrl_call");
    assert.isUndefined(callParams[0].from);
  });

  it("rejects ethers-style deploy argument order with a clear error", async () => {
    const factory = await helpers.getContractFactory("Sample");

    await expectHardhatErrorAsync(
      () => (factory.deploy as any)("Hello", { from: contractAddress }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "transaction overrides as its first argument"
    );

    await expectHardhatErrorAsync(
      () =>
        (factory.deploy as any)([42, contractAddress], {
          from: contractAddress,
        }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "transaction overrides as its first argument"
    );

    await expectHardhatErrorAsync(
      () => (factory.deploy as any)({ from: contractAddress }, { gas: 1 }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "constructor arguments as an array"
    );
  });

  it("resolves the default sender for factory deploy", async function () {
    const configuredFrom = `Q${"b".repeat(128)}`;
    const localHelpers = createQrlRuntimeHelpers(({
      config: { paths: { artifacts: this.tmpDir } },
      network: { provider, config: { from: configuredFrom }, name: "qrl" },
    } as any) as HardhatRuntimeEnvironment);

    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      contractAddress,
      status: "0x1",
    });

    const factory = await localHelpers.getContractFactory("Sample");
    const contract = await factory.deploy();

    assert.equal(contract.address, checksummedContractAddress);
    const params = provider.getLatestParams("qrl_sendTransaction");
    assert.equal(params[0].from, configuredFrom);
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

  it("creates a transaction response that resolves the mined receipt", async () => {
    provider.setReturnValue("qrl_getTransactionReceipt", {
      status: "0x1",
      transactionHash: txHash,
    });

    const response = createTransactionResponse(
      txHash,
      helpers.waitForTransaction
    );

    assert.equal(response.hash, txHash);

    const receipt = await response.wait();

    assert.equal(receipt.status, "0x1");
    assert.equal(receipt.transactionHash, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_getTransactionReceipt"), [
      txHash,
    ]);
  });

  it("polls for the transaction response receipt until it is available", async () => {
    let pollCount = 0;
    provider.setReturnValue("qrl_getTransactionReceipt", () => {
      pollCount += 1;
      return pollCount < 3 ? null : { status: "0x1" };
    });

    const response = createTransactionResponse(
      txHash,
      helpers.waitForTransaction
    );
    const receipt = await response.wait(1000, 1);

    assert.equal(receipt.status, "0x1");
    assert.equal(provider.getNumberOfCalls("qrl_getTransactionReceipt"), 3);
  });

  it("times out waiting for a transaction response receipt", async () => {
    provider.setReturnValue("qrl_getTransactionReceipt", null);

    const response = createTransactionResponse(
      txHash,
      helpers.waitForTransaction
    );

    await expectHardhatErrorAsync(
      () => response.wait(1, 1),
      ERRORS.NETWORK.NETWORK_TIMEOUT
    );
  });

  it("rejects a transaction response receipt with a mismatched hash", async () => {
    provider.setReturnValue("qrl_getTransactionReceipt", {
      status: "0x1",
      transactionHash: `0x${"2".repeat(64)}`,
    });

    const response = createTransactionResponse(
      txHash,
      helpers.waitForTransaction
    );

    await expectHardhatErrorAsync(
      () => response.wait(1, 1),
      ERRORS.NETWORK.TRANSACTION_RECEIPT_MISMATCH,
      txHash
    );
  });

  it("sends a transaction and returns a transaction response", async () => {
    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      status: "0x1",
      transactionHash: txHash,
    });

    const response = await sendTransactionWithResponse(
      helpers.sendTransaction,
      helpers.waitForTransaction,
      { from: contractAddress, to: contractAddress, value: 1 }
    );

    assert.equal(response.hash, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      { from: contractAddress, to: contractAddress, value: 1 },
    ]);

    const receipt = await response.wait(1000, 1);

    assert.equal(receipt.status, "0x1");
  });

  it("unwraps single-output view results through direct aliases", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
    const stored = await contract.retrieve();

    assert.equal(stored.toString(10), "42");
    const callParams = provider.getLatestParams("qrl_call");
    assert.equal(callParams[0].to, checksummedContractAddress);
  });

  it("returns decoded arrays from multi-output direct aliases", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue(
      "qrl_call",
      `0x${"0".repeat(126)}2a${contractAddress.slice(1)}`
    );
    const result = await contract.getPair();

    assert.isArray(result);
    assert.equal(result[0].toString(10), "42");
    assert.equal(result[1], checksummedContractAddress);
  });

  it("passes overrides from direct view aliases to qrl_call", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
    await contract.retrieve({ from: contractAddress });

    const callParams = provider.getLatestParams("qrl_call");
    assert.equal(callParams[0].from, contractAddress);
    assert.equal(callParams[0].to, checksummedContractAddress);
  });

  it("sends transactions through direct aliases and waits for receipts", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue("qrl_sendTransaction", txHash);
    provider.setReturnValue("qrl_getTransactionReceipt", {
      status: "0x1",
      transactionHash: txHash,
    });

    const response = await contract.store(42, { from: contractAddress });

    assert.equal(response.hash, txHash);
    assert.deepEqual(provider.getLatestParams("qrl_sendTransaction"), [
      {
        data: `0x6057361d${"0".repeat(126)}2a`,
        from: contractAddress,
        to: checksummedContractAddress,
      },
    ]);

    const receipt = await response.wait(1000, 1);
    assert.equal(receipt.status, "0x1");
  });

  it("accepts an empty overrides object in direct aliases", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    provider.setReturnValue("qrl_accounts", [contractAddress]);
    provider.setReturnValue("qrl_sendTransaction", txHash);
    const response = await contract.store(42, {});

    assert.equal(response.hash, txHash);
  });

  it("treats tuple ABI arguments as arguments, not overrides", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    provider.setReturnValue("qrl_accounts", [contractAddress]);

    // Tuple VALUE encoding is not implemented yet in the QRL ABI codec, so
    // both cases below fail during encoding. The assertions still pin the
    // arity-based routing: if the tuple object had been misparsed as
    // overrides, the errors would be an argument-count mismatch or an
    // unknown-override error instead. Upgrade to success-path tests once
    // tuple value encoding lands.
    await expectHardhatErrorAsync(
      () => contract.setConfig({ threshold: 5, active: true }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Unsupported QRL ABI type tuple"
    );

    await expectHardhatErrorAsync(
      () =>
        contract.setConfig(
          { threshold: 5, active: true },
          { from: contractAddress }
        ),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Unsupported QRL ABI type tuple"
    );
  });

  it("rejects unknown transaction override keys in direct aliases", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    await expectHardhatErrorAsync(
      () => contract.store(42, { form: contractAddress }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      'Unknown transaction override "form"'
    );
  });

  it("rejects direct alias calls with a wrong argument count", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    await expectHardhatErrorAsync(
      () => contract.store(),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "expects 1 ABI arguments"
    );

    await expectHardhatErrorAsync(
      () => contract.store(42, { from: contractAddress }, "extra"),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "got 3 arguments"
    );
  });

  it("does not create direct aliases for overloaded functions", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    assert.equal(contract.setAddr, undefined);
    assert.equal(contract.addr, undefined);
    assert.isFunction(contract.functions["setAddr(bytes32,address)"]);
    assert.isFunction(contract.callStatic["addr(bytes32)"]);
  });

  it("does not overwrite reserved wrapper fields with ABI functions", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    // The ABI defines an unambiguous view function named `hash`, which
    // collides with the reserved deployment-metadata alias and therefore
    // must not become a direct alias.
    assert.notTypeOf(contract.hash, "function");
    assert.equal(contract.address, checksummedContractAddress);

    provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
    const viaMap = await contract.functions.hash();
    assert.equal(viaMap[0].toString(10), "42");

    const viaStatic = await contract.callStatic.hash();
    assert.equal(viaStatic[0].toString(10), "42");
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

  it("normalizes tuple component types in full function signatures", () => {
    const tupleAbi = [
      {
        inputs: [
          {
            components: [
              { name: "amount", type: "uint" },
              { name: "recipient", type: "address" },
            ],
            name: "payment",
            type: "tuple",
          },
          { name: "salt", type: "bytes32" },
        ],
        name: "submit",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
    ];

    const fragment = findFunctionFragment(
      tupleAbi,
      "submit((uint256,address),bytes32)"
    );

    assert.equal(
      getFunctionSignature(fragment),
      "submit((uint256,address),bytes32)"
    );
  });

  it("normalizes nested tuple component types in full event signatures", () => {
    const tupleAbi = [
      {
        anonymous: false,
        inputs: [
          {
            components: [
              { name: "amount", type: "uint" },
              {
                components: [
                  { name: "recipient", type: "address" },
                  { name: "memo", type: "bytes32" },
                ],
                name: "details",
                type: "tuple",
              },
            ],
            indexed: false,
            name: "payment",
            type: "tuple",
          },
        ],
        name: "PaymentQueued",
        type: "event",
      },
    ];

    assert.match(
      getQrlEventTopic(tupleAbi, "PaymentQueued((uint256,(address,bytes32)))"),
      /^0x[0-9a-f]{128}$/i
    );
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

  it("decodes overloaded QRL event logs by full signature", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const recipient = `Q${"b".repeat(128)}`;
    const log = {
      address: contractAddress,
      data: `0x${recipient.slice(1)}`,
      topics: [
        `0x52d7d861f09ab3d26239d492e8968629f95e9e318cf0b73bfddc441522a15fd2${"0".repeat(
          64
        )}`,
        `0x${"0".repeat(64)}${"1".repeat(64)}`,
      ],
    };

    const decoded = contract.decodeEventLog(
      "AddrChanged(bytes32,address)",
      log
    );

    assert.equal(decoded.eventName, "AddrChanged");
    assert.equal(decoded.args.node, `0x${"0".repeat(64)}`);
    assert.equal(decoded.args.value, toQrlChecksumAddress(recipient));
  });

  it("decodes overloaded QRL event logs with canonical signature types", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);
    const dataOffset = `${"0".repeat(126)}80`;
    const coinType = `${"0".repeat(126)}3c`;
    const value = "1234";
    const data = `0x${coinType}${dataOffset}${"0".repeat(
      127
    )}2${value}${"0".repeat(124)}`;
    const log = {
      address: contractAddress,
      data,
      topics: [
        `0xfb6b36b568d5689ec98617abfd8ff0eccaade0ed49cef564581c257947852f32${"0".repeat(
          64
        )}`,
        `0x${"0".repeat(64)}${"2".repeat(64)}`,
      ],
    };

    const decoded = contract.decodeEventLog(
      "AddrChanged(bytes32,uint,bytes)",
      log
    );

    assert.equal(decoded.eventName, "AddrChanged");
    assert.equal(decoded.args.coinType.toString(10), "60");
    assert.equal(decoded.args.value, "0x1234");
  });

  it("rejects overloaded QRL event lookup by bare name", async () => {
    const contract = await helpers.getContractAt("Sample", contractAddress);

    expectHardhatError(
      () =>
        contract.decodeEventLog("AddrChanged", {
          address: contractAddress,
          data: "0x",
          topics: [],
        }),
      ERRORS.NETWORK.INVALID_QRL_ABI,
      "Event AddrChanged is overloaded. Use a full signature like AddrChanged(bytes32,address)."
    );
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

  // The ergonomic layer (direct aliases, factory deploy wrappers, default
  // sender) must never change the shapes of the explicit API. These tests pin
  // the old contract so regressions in the new layer surface immediately.
  describe("explicit contract API compatibility", () => {
    it("deployContract still returns the raw { hash, receipt, address } shape", async () => {
      const deployReceipt = {
        contractAddress,
        status: "0x1",
        transactionHash: txHash,
      };
      provider.setReturnValue("qrl_sendTransaction", txHash);
      provider.setReturnValue("qrl_getTransactionReceipt", deployReceipt);

      const result = await helpers.deployContract("Sample", {
        from: contractAddress,
      });

      assert.deepEqual(Object.keys(result).sort(), [
        "address",
        "hash",
        "receipt",
      ]);
      assert.equal(result.hash, txHash);
      assert.deepEqual(result.receipt, deployReceipt);
      assert.equal(result.address, checksummedContractAddress);
      assert.isUndefined((result as any).functions);
      assert.isUndefined((result as any).wait);
    });

    it("functions map still returns a raw hash string for state-changing calls", async () => {
      const contract = await helpers.getContractAt("Sample", contractAddress);

      provider.setReturnValue("qrl_sendTransaction", txHash);
      const result = await contract.functions.store(42, {
        from: contractAddress,
      });

      assert.strictEqual(result, txHash);
      assert.isString(result);
      assert.isUndefined((result as any).wait);
    });

    it("send map still returns a raw hash string", async () => {
      const contract = await helpers.getContractAt("Sample", contractAddress);

      provider.setReturnValue("qrl_sendTransaction", txHash);
      const result = await contract.send.store(42, { from: contractAddress });

      assert.strictEqual(result, txHash);
      assert.isString(result);
    });

    it("callStatic still returns a decoded array for single-output functions", async () => {
      const contract = await helpers.getContractAt("Sample", contractAddress);

      provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
      const result = await contract.callStatic.retrieve();

      assert.isArray(result);
      assert.lengthOf(result, 1);
      assert.equal(result[0].toString(10), "42");
    });

    it("functions map still returns a decoded array for read-only calls", async () => {
      const contract = await helpers.getContractAt("Sample", contractAddress);

      provider.setReturnValue("qrl_call", `0x${"0".repeat(126)}2a`);
      const result = await contract.functions.retrieve();

      assert.isArray(result);
      assert.equal(result[0].toString(10), "42");
    });

    it("explicit maps do not resolve a default sender", async () => {
      const contract = await helpers.getContractAt("Sample", contractAddress);

      provider.setReturnValue("qrl_sendTransaction", txHash);
      await contract.functions.store(42);
      await contract.send.store(42);

      assert.equal(provider.getNumberOfCalls("qrl_accounts"), 0);
      const params = provider.getLatestParams("qrl_sendTransaction");
      assert.isUndefined(params[0].from);
    });

    it("getContractAt still exposes the full explicit wrapper surface", async () => {
      const contract = await helpers.getContractAt("Sample", contractAddress);

      assert.equal(contract.address, checksummedContractAddress);
      assert.equal(contract.contractName, "Sample");
      assert.isObject(contract.artifact);
      assert.isObject(contract.functions);
      assert.isObject(contract.callStatic);
      assert.isObject(contract.send);
      assert.isFunction(contract.callFunction);
      assert.isFunction(contract.sendFunction);
      assert.isFunction(contract.call);
      assert.isFunction(contract.sendTransaction);
      assert.isFunction(contract.encodeFunctionData);
      assert.isFunction(contract.decodeFunctionResult);
      assert.isFunction(contract.decodeEventLog);
      assert.isFunction(contract.decodeReceiptLogs);

      assert.equal(
        contract.encodeFunctionData("store", [42]),
        `0x6057361d${"0".repeat(126)}2a`
      );
      assert.deepEqual(
        contract
          .decodeFunctionResult("retrieve", `0x${"0".repeat(126)}2a`)
          .map((value: any) => value.toString(10)),
        ["42"]
      );
    });
  });
});
