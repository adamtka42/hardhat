# 5. Testing contracts

Writing automated tests when building smart contracts is important because
contract bugs are hard to fix after deployment. For this tutorial we are going
to use **hardhatqrlvm**, a local in-process QRL VM network, and [Mocha](https://mochajs.org/)
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

    const token = await Token.deploy();

    const ownerBalance = await token.balanceOf(owner);
    const totalSupply = await token.totalSupply();

    assert.strictEqual(totalSupply.toString(10), ownerBalance.toString(10));
  });
});
```

On your terminal run:

```sh
npx hardhat test --network hardhatqrlvm
```

You should see output like this:

```text
$ npx hardhat test --network hardhatqrlvm
All contracts have already been compiled, skipping compilation.


  Token contract
    ✓ Deployment should assign the total supply of tokens to the owner


  1 passing
```

This means the test passed. Let's now explain the important lines:

```js
const [owner] = await network.provider.send("qrl_accounts");
```

This asks the configured QRL provider for available accounts. With `hardhatqrlvm`,
the accounts come from `networks.hardhatqrlvm.accounts` in `hardhat.config.js`.

```js
const Token = await qrl.getContractFactory("Token");
```

A QRL contract factory is used to deploy new instances of a compiled contract.

```js
const token = await Token.deploy();
```

Calling `deploy()` sends a deployment transaction, waits for the receipt, and
returns a contract wrapper connected to the deployed address. The sender
defaults to the network's `from` config or the first `qrl_accounts` account,
and the deployment metadata is available as `token.deployTransactionHash` and
`token.deployReceipt`. To connect to an already deployed contract, use
`qrl.getContractAt("Token", address)`.

```js
const ownerBalance = await token.balanceOf(owner);
```

Read-only (`view`/`pure`) contract methods can be called directly on the
wrapper. They perform a simulated call that does not change contract state,
and a single return value is unwrapped to a scalar.

```js
const tx = await token.transfer(receiver, 50, { from: owner });
const receipt = await tx.wait();
```

State-changing contract methods send a transaction and return a transaction
response with a `hash` and a receipt-polling `wait()`. Method aliases accept
the ABI arguments followed by an optional transaction overrides object such as
`{ from: owner }`.

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

    const token = await Token.deploy({ from: owner });

    let tx = await token.transfer(addr1, 50, { from: owner });
    await tx.wait();

    let addr1Balance = await token.balanceOf(addr1);
    assert.strictEqual(addr1Balance.toString(10), "50");

    tx = await token.transfer(addr2, 50, { from: addr1 });
    await tx.wait();

    const addr2Balance = await token.balanceOf(addr2);
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
    token = await Token.deploy({ from: owner });
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const storedOwner = await token.owner();
      assert.strictEqual(storedOwner, owner);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await token.balanceOf(owner);
      const totalSupply = await token.totalSupply();
      assert.strictEqual(totalSupply.toString(10), ownerBalance.toString(10));
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      let tx = await token.transfer(addr1, 50, { from: owner });
      await tx.wait();

      const addr1Balance = await token.balanceOf(addr1);
      assert.strictEqual(addr1Balance.toString(10), "50");

      tx = await token.transfer(addr2, 50, { from: addr1 });
      await tx.wait();

      const addr2Balance = await token.balanceOf(addr2);
      assert.strictEqual(addr2Balance.toString(10), "50");
    });

    it("Should fail if sender does not have enough tokens", async function () {
      const initialOwnerBalance = await token.balanceOf(owner);

      await assert.rejects(
        token.transfer(owner, 1, { from: addr1 }),
        /Not enough tokens/
      );

      const finalOwnerBalance = await token.balanceOf(owner);
      assert.strictEqual(
        finalOwnerBalance.toString(10),
        initialOwnerBalance.toString(10)
      );
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await token.balanceOf(owner);

      let tx = await token.transfer(addr1, 100, { from: owner });
      await tx.wait();

      tx = await token.transfer(addr2, 50, { from: owner });
      await tx.wait();

      const finalOwnerBalance = await token.balanceOf(owner);
      const addr1Balance = await token.balanceOf(addr1);
      const addr2Balance = await token.balanceOf(addr2);

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

