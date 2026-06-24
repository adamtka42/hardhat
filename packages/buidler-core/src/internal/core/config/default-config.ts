import { HardhatConfig } from "../../../types";

const defaultConfig: HardhatConfig = {
  defaultNetwork: "qrl",
  hyperion: {
    version: "local",
    optimizer: {
      enabled: false,
      runs: 200,
    },
  },
  networks: {
    qrl: {
      url: "http://127.0.0.1:33462",
    },
    qrlLocal: {
      type: "qrl-local",
      chainId: 1,
      accounts: [],
      automine: true,
      blockGasLimit: 30000000,
    },
  },
  mocha: {
    timeout: 20000,
  },
};

export default defaultConfig;
