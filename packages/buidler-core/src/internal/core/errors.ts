import { getClosestCallerPackage } from "../util/caller-package";
import { replaceAll } from "../util/strings";

import { ErrorDescriptor, ERRORS, getErrorCode } from "./errors-list";

// For an explanation about these classes constructors go to:
// https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work

export class HardhatError extends Error {
  public static isHardhatError(other: any): other is HardhatError {
    return (
      other !== undefined && other !== null && other._isHardhatError === true
    );
  }

  public readonly errorDescriptor: ErrorDescriptor;
  public readonly number: number;
  public readonly parent?: Error;

  private readonly _isHardhatError: boolean;

  constructor(
    errorDescriptor: ErrorDescriptor,
    messageArguments: { [p: string]: any } = {},
    parentError?: Error
  ) {
    const prefix = `${getErrorCode(errorDescriptor)}: `;

    const formattedMessage = applyErrorMessageTemplate(
      errorDescriptor.message,
      messageArguments
    );

    super(prefix + formattedMessage);
    this.errorDescriptor = errorDescriptor;
    this.number = errorDescriptor.number;

    if (parentError instanceof Error) {
      this.parent = parentError;
    }

    this._isHardhatError = true;
    Object.setPrototypeOf(this, HardhatError.prototype);
  }
}

/**
 * This class is used to throw errors from Hardhat plugins.
 */
export class HardhatPluginError extends Error {
  public static isHardhatPluginError(other: any): other is HardhatPluginError {
    return (
      other !== undefined &&
      other !== null &&
      other._isHardhatPluginError === true
    );
  }

  public readonly parent?: Error;
  public readonly pluginName: string;

  private readonly _isHardhatPluginError: boolean;

  /**
   * Creates a HardhatPluginError.
   *
   * @param pluginName The name of the plugin.
   * @param message An error message that will be shown to the user.
   * @param parent The error that causes this error to be thrown.
   */
  public constructor(pluginName: string, message: string, parent?: Error);

  /**
   * A DEPRECATED constructor that automatically obtains the caller package and
   * use it as plugin name.
   *
   * @deprecated Use the above constructor.
   *
   * @param message An error message that will be shown to the user.
   * @param parent The error that causes this error to be thrown.
   */
  public constructor(message: string, parent?: Error);

  public constructor(
    pluginNameOrMessage: string,
    messageOrParent?: string | Error,
    parent?: Error
  ) {
    if (typeof messageOrParent === "string") {
      super(messageOrParent);
      this.pluginName = pluginNameOrMessage;
      this.parent = parent;
    } else {
      super(pluginNameOrMessage);
      this.pluginName = getClosestCallerPackage()!;
      this.parent = messageOrParent;
    }

    this._isHardhatPluginError = true;
    Object.setPrototypeOf(this, HardhatPluginError.prototype);
  }
}

/**
 * This function applies error messages templates like this:
 *
 *  - Template is a string which contains a variable tags. A variable tag is a
 *    a variable name surrounded by %. Eg: %plugin1%
 *  - A variable name is a string of alphanumeric ascii characters.
 *  - Every variable tag is replaced by its value.
 *  - %% is replaced by %.
 *  - Values can't contain variable tags.
 *  - If a variable is not present in the template, but present in the values
 *    object, an error is thrown.
 *
 * @param template The template string.
 * @param values A map of variable names to their values.
 */
export function applyErrorMessageTemplate(
  template: string,
  values: { [templateVar: string]: any }
): string {
  return _applyErrorMessageTemplate(template, values, false);
}

function _applyErrorMessageTemplate(
  template: string,
  values: { [templateVar: string]: any },
  isRecursiveCall: boolean
): string {
  if (!isRecursiveCall) {
    for (const variableName of Object.keys(values)) {
      if (variableName.match(/^[a-zA-Z][a-zA-Z0-9]*$/) === null) {
        throw new HardhatError(ERRORS.INTERNAL.TEMPLATE_INVALID_VARIABLE_NAME, {
          variable: variableName,
        });
      }

      const variableTag = `%${variableName}%`;

      if (!template.includes(variableTag)) {
        throw new HardhatError(ERRORS.INTERNAL.TEMPLATE_VARIABLE_TAG_MISSING, {
          variable: variableName,
        });
      }
    }
  }

  if (template.includes("%%")) {
    return template
      .split("%%")
      .map((part) => _applyErrorMessageTemplate(part, values, true))
      .join("%");
  }

  for (const variableName of Object.keys(values)) {
    let value: string;

    if (values[variableName] === undefined) {
      value = "undefined";
    } else if (values[variableName] === null) {
      value = "null";
    } else {
      value = values[variableName].toString();
    }

    if (value === undefined) {
      value = "undefined";
    }

    const variableTag = `%${variableName}%`;

    if (value.match(/%([a-zA-Z][a-zA-Z0-9]*)?%/) !== null) {
      throw new HardhatError(
        ERRORS.INTERNAL.TEMPLATE_VALUE_CONTAINS_VARIABLE_TAG,
        { variable: variableName }
      );
    }

    template = replaceAll(template, variableTag, value);
  }

  return template;
}
