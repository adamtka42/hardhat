import { IQrlProvider } from "../../../types";

export function wrapSend(
  provider: IQrlProvider,
  sendWrapper: (method: string, params: any[]) => Promise<any>
): IQrlProvider {
  const cloningSendWrapper = (method: string, params: any[] = []) => {
    const cloneDeep = require("lodash/cloneDeep");
    return sendWrapper(method, cloneDeep(params));
  };

  return new Proxy(provider, {
    get(target: IQrlProvider, p: PropertyKey, receiver: any): any {
      if (p === "send") {
        return cloningSendWrapper;
      }

      const originalValue = Reflect.get(target, p, receiver);

      if (originalValue instanceof Function) {
        return (...args: any[]) => {
          const returned = Reflect.apply(originalValue, target, args);
          if (returned !== target) {
            return returned;
          }

          return receiver;
        };
      }

      return originalValue;
    },
  });
}
