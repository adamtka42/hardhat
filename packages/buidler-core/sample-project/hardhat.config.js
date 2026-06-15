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

module.exports = {
  defaultNetwork: "qrl",
  networks: {
    qrl: {
      url: process.env.QRL_RPC_URL || "http://127.0.0.1:33462",
      accounts,
    },
  },
};
