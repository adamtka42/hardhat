const { lazyFunction, lazyObject } = require("@theqrl/hardhat/plugins");

global.Web3 = lazyFunction(() => require("@theqrl/web3").Web3);
global.web3 = lazyObject(() => new global.Web3());

console.log(global.web3.qrl.getAccounts.name);
