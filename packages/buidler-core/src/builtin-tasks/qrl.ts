import { extendEnvironment } from "../internal/core/config/config-env";
import { createQrlRuntimeHelpers } from "../internal/qrl/helpers";

export default function () {
  extendEnvironment((env) => {
    env.qrl = createQrlRuntimeHelpers(env);
  });
}
