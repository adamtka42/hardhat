import { extendEnvironment } from "@theqrl/hardhat/config";
import {
  HARDHAT_QRLVM_NETWORK_NAME,
  lazyFunction,
  lazyObject,
} from "@theqrl/hardhat/plugins";

import { Web3HTTPProviderAdapter } from "./web3-provider-adapter";

export default function () {
  extendEnvironment((env) => {
    env.Web3 = lazyFunction(() => require("@theqrl/web3").Web3);
    env.web3 = lazyObject(() => {
      const Web3 = require("@theqrl/web3").Web3;
      const supportsSubscriptions =
        env.network.name === HARDHAT_QRLVM_NETWORK_NAME;
      return new Web3(
        new Web3HTTPProviderAdapter(env.network.provider, supportsSubscriptions)
      );
    });
  });
}
