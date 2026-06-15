// This is a sample Hardhat task. To learn how to create your own go to
// https://github.com/cyyber/hardhat#tasks
task("accounts", "Prints the list of QRL accounts", async (_, { network }) => {
  const accounts = await network.provider.send("qrl_accounts");

  for (const address of accounts) {
    console.log(address);
  }
});

// You have to export an object to set up your config
// This object can have the following optional entries:
// defaultNetwork, networks, and paths.
// Go to https://github.com/cyyber/hardhat#configuration to learn more
module.exports = {};
