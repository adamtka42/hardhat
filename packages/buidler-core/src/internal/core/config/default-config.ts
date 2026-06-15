import { HardhatConfig } from "../../../types";

const defaultConfig: HardhatConfig = {
  defaultNetwork: "localhost",
  hyperion: {
    version: "local",
    optimizer: {
      enabled: false,
      runs: 200,
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  mocha: {
    timeout: 20000,
  },
};

export default defaultConfig;
