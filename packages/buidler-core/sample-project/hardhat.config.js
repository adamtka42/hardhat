task("accounts", "Prints the list of QRL accounts", async (_, { network }) => {
  const accounts = await network.provider.send("qrl_accounts");

  for (const address of accounts) {
    console.log(address);
  }
});

const accounts =
  process.env.QRL_ACCOUNT_SEED === undefined
    ? []
    : [process.env.QRL_ACCOUNT_SEED];

const localAccountAddress = `Q${"01".repeat(64)}`;

module.exports = {
  defaultNetwork: process.env.HARDHAT_DEFAULT_NETWORK || "qrlLocal",
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
    },
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      qrlJsMonorepoPath: process.env.QRLJS_MONOREPO_PATH,
      from: localAccountAddress,
      accounts: [{ address: localAccountAddress, balance: "1000000000000" }],
      blockGasLimit: 30000000,
    },
  },
};
