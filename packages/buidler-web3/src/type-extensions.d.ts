import "@theqrl/hardhat/types";

declare module "@theqrl/hardhat/types" {
  interface HardhatRuntimeEnvironment {
    Web3: any;
    web3: any;
  }
}
