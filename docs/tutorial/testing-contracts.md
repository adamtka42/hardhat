# 5. Testing contracts

Writing automated tests when building smart contracts is important because
contract bugs are hard to fix after deployment. For this tutorial we are going
to use **qrlLocal**, a local in-process QRL VM network, and [Mocha](https://mochajs.org/)
as our test runner.

## Writing tests

Create a new directory called `test` inside the project root directory and
create a new file called `Token.js`.

Start with the code below. We will explain it next, but for now paste this into
`Token.js`:

```js
const assert = require("assert");

describe("Token contract", function () {
  it("Deployment should assign the total supply of tokens to the owner", async function () {
    this.timeout(300000);

    const [owner] = await network.provider.send("qrl_accounts");
    const Token = await qrl.getContractFactory("Token");

    const deployment = await Token.deploy({ from: owner });
    const token = await qrl.getContractAt("Token", deployment.address);

    const [ownerBalance] = await token.callStatic.balanceOf(owner);
    const [totalSupply] = await token.callStatic.totalSupply();

    assert.strictEqual(totalSupply.toString(10), ownerBalance.toString(10));
  });
});
```

On your terminal run:

```sh
QRLJS_MONOREPO_PATH=/path/to/qrljs-monorepo npx hardhat test --network qrlLocal
```

You should see output like this:

```text
$ npx hardhat test --network qrlLocal
All contracts have already been compiled, skipping compilation.


  Token contract
    ✓ Deployment should assign the total supply of tokens to the owner


  1 passing
```

This means the test passed. Let's now explain the important lines:

```js
const [owner] = await network.provider.send("qrl_accounts");
```

This asks the configured QRL provider for available accounts. With `qrlLocal`,
the accounts come from `networks.qrlLocal.accounts` in `hardhat.config.js`.

```js
const Token = await qrl.getContractFactory("Token");
```

A QRL contract factory is used to deploy new instances of a compiled contract.

```js
const deployment = await Token.deploy({ from: owner });
```

Calling `deploy()` sends a deployment transaction and waits for the receipt.
The returned object includes the transaction hash and deployed QRL contract
address.

```js
const token = await qrl.getContractAt("Token", deployment.address);
```

This creates a contract object connected to the deployed address.

```js
const [ownerBalance] = await token.callStatic.balanceOf(owner);
```

`callStatic` simulates a read-only contract call. It does not send a
transaction and does not change contract state.

```js
await token.functions.transfer(receiver, 50, { from: owner });
```

`functions` sends a transaction for state-changing contract methods. After a
transaction, use `qrl.waitForTransaction(txHash)` when you need to wait
explicitly for the receipt.

### Using a different account

If you need to send a transaction from an account other than the deployer, pass
that account in the transaction overrides:

```js
const assert = require("assert");

describe("Transactions", function () {
  it("Should transfer tokens between accounts", async function () {
    this.timeout(300000);

    const [owner, addr1, addr2] = await network.provider.send("qrl_accounts");
    const Token = await qrl.getContractFactory("Token");

    const deployment = await Token.deploy({ from: owner });
    const token = await qrl.getContractAt("Token", deployment.address);

    let txHash = await token.functions.transfer(addr1, 50, { from: owner });
    await qrl.waitForTransaction(txHash);

    let [addr1Balance] = await token.callStatic.balanceOf(addr1);
    assert.strictEqual(addr1Balance.toString(10), "50");

    txHash = await token.functions.transfer(addr2, 50, { from: addr1 });
    await qrl.waitForTransaction(txHash);

    const [addr2Balance] = await token.callStatic.balanceOf(addr2);
    assert.strictEqual(addr2Balance.toString(10), "50");
  });
});
```

### Full coverage

Now that we have covered the basics, here is a fuller test suite for the token.
It includes deployment checks, successful transfers, failed transfers, and
state updates after multiple transactions.

```js
const assert = require("assert");

describe("Token contract", function () {
  let token;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    this.timeout(300000);

    [owner, addr1, addr2] = await network.provider.send("qrl_accounts");

    const Token = await qrl.getContractFactory("Token");
    const deployment = await Token.deploy({ from: owner });
    token = await qrl.getContractAt("Token", deployment.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const [storedOwner] = await token.callStatic.owner();
      assert.strictEqual(storedOwner, owner);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const [ownerBalance] = await token.callStatic.balanceOf(owner);
      const [totalSupply] = await token.callStatic.totalSupply();
      assert.strictEqual(totalSupply.toString(10), ownerBalance.toString(10));
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      let txHash = await token.functions.transfer(addr1, 50, { from: owner });
      await qrl.waitForTransaction(txHash);

      const [addr1Balance] = await token.callStatic.balanceOf(addr1);
      assert.strictEqual(addr1Balance.toString(10), "50");

      txHash = await token.functions.transfer(addr2, 50, { from: addr1 });
      await qrl.waitForTransaction(txHash);

      const [addr2Balance] = await token.callStatic.balanceOf(addr2);
      assert.strictEqual(addr2Balance.toString(10), "50");
    });

    it("Should fail if sender does not have enough tokens", async function () {
      const [initialOwnerBalance] = await token.callStatic.balanceOf(owner);

      await assert.rejects(
        token.functions.transfer(owner, 1, { from: addr1 }),
        /Not enough tokens/
      );

      const [finalOwnerBalance] = await token.callStatic.balanceOf(owner);
      assert.strictEqual(
        finalOwnerBalance.toString(10),
        initialOwnerBalance.toString(10)
      );
    });

    it("Should update balances after transfers", async function () {
      const [initialOwnerBalance] = await token.callStatic.balanceOf(owner);

      let txHash = await token.functions.transfer(addr1, 100, { from: owner });
      await qrl.waitForTransaction(txHash);

      txHash = await token.functions.transfer(addr2, 50, { from: owner });
      await qrl.waitForTransaction(txHash);

      const [finalOwnerBalance] = await token.callStatic.balanceOf(owner);
      const [addr1Balance] = await token.callStatic.balanceOf(addr1);
      const [addr2Balance] = await token.callStatic.balanceOf(addr2);

      assert.strictEqual(
        finalOwnerBalance.toString(10),
        (BigInt(initialOwnerBalance.toString(10)) - 150n).toString()
      );
      assert.strictEqual(addr1Balance.toString(10), "100");
      assert.strictEqual(addr2Balance.toString(10), "50");
    });
  });
});
```

Keep in mind that when you run `npx hardhat test`, your contracts will be
compiled if they have changed since the last time you ran your tests.

