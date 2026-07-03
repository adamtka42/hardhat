# 4. Writing and compiling smart contracts

We are going to create a simple smart contract that implements a token that can
be transferred. Token contracts are commonly used to exchange or store value.
We will not go in depth into the Hyperion code of the contract in this
tutorial, but there is some logic you should know:

- There is a fixed total supply of tokens that cannot be changed.
- The entire supply is assigned to the address that deploys the contract.
- Anyone can receive tokens.
- Anyone with enough tokens can transfer tokens.
- The token is non-divisible. You can transfer 1, 2, 3, or 37 tokens but not
  2.5.

::: tip
You may have heard about ERC-20 on Ethereum or SQRCTF1 on QRL. For simplicity's
sake the token we are going to build is not a full standard token.
:::

## Writing smart contracts

Start by creating a new directory called `contracts` and create a file inside
the directory called `Token.hyp`.

Paste the code below into the file and take a minute to read it:

```solidity
// SPDX-License-Identifier: MIT
pragma hyperion >=0.0;

contract Token {
    string public name = "My QRL Token";
    string public symbol = "MQT";

    uint256 public totalSupply = 1000000;
    address public owner;

    mapping(address => uint256) private balances;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor() {
        balances[msg.sender] = totalSupply;
        owner = msg.sender;
    }

    function transfer(address to, uint256 amount) external {
        require(balances[msg.sender] >= amount, "Not enough tokens");

        balances[msg.sender] -= amount;
        balances[to] += amount;

        emit Transfer(msg.sender, to, amount);
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
}
```

::: tip
QRL Hardhat compiles Hyperion source files with the `.hyp` extension. We
recommend matching the file name to the contract it contains.
:::

## Compiling contracts

To compile the contract run:

```sh
npx hardhat compile
```

The `compile` task is one of the built-in tasks.

```text
$ npx hardhat compile
Compiling...
Compiled 1 contract successfully
```

The contract has been successfully compiled and is ready to be used. Compiled
artifacts are written to `artifacts/` and compiler cache files are written to
`cache/`.

For more details about compiler configuration, see
[Compiling contracts](../guides/compile-contracts.md).

