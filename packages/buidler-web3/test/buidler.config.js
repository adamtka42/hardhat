const { loadPluginFile } = require("@theqrl/hardhat/plugins-testing");
loadPluginFile(__dirname + "/../src/index");

module.exports = {
  defaultNetwork: "hardhatqrlvm",
  networks: {
    httpWithStaleLocalType: {
      type: "qrl-local",
      url: "http://127.0.0.1:1",
    },
  },
};
