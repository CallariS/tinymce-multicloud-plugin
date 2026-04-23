import { DEFINED } from "xdbc/src/DBC/DEFINED";
import { OR } from "xdbc/src/DBC/OR";
import { REGEX } from "xdbc/src/DBC/REGEX";
import { TYPE } from "xdbc/src/DBC/TYPE";
import type {
  CloudProviderId,
  MultiCloudPluginOptions,
  ProviderRuntimeConfig,
} from "../../types";

const rxNonEmpty = /^.*\S.*$/;
const rxRelativePath = /^(?:\.{1,2}\/|\/)[^\s]+$/;
const rxApiKeyLike = /^[A-Za-z0-9._\-~]{8,}$/;

class XdbcBoundary {
  public static assertXdbc(result: boolean | string, context: string): void {
    if (result !== true) {
      throw new Error(`[XDBC Boundary] ${context}: ${result}`);
    }
  }

  public static ensurePlainObject(value: unknown, context: string): Record<string, unknown> {
    this.assertXdbc(TYPE.checkAlgorithm(value, "object"), context);

    if (value === null || Array.isArray(value)) {
      throw new Error(`[XDBC Boundary] ${context}: expected a non-null object.`);
    }

    return value as Record<string, unknown>;
  }

  public static optionalString(
    value: unknown,
    context: string,
    regex: RegExp = rxNonEmpty,
  ): void {
    if (value === undefined) return;

    this.assertXdbc(TYPE.checkAlgorithm(value, "string"), context);
    this.assertXdbc(REGEX.checkAlgorithm(value, regex), context);
  }

  public static requiredString(
    value: unknown,
    context: string,
    regex: RegExp = rxNonEmpty,
  ): void {
    this.assertXdbc(DEFINED.checkAlgorithm(value), context);
    this.assertXdbc(TYPE.checkAlgorithm(value, "string"), context);
    this.assertXdbc(REGEX.checkAlgorithm(value, regex), context);
  }

  public static optionalBoolean(value: unknown, context: string): void {
    if (value === undefined) return;
    this.assertXdbc(TYPE.checkAlgorithm(value, "boolean"), context);
  }

  public static optionalPositiveNumber(value: unknown, context: string): void {
    if (value === undefined) return;

    this.assertXdbc(TYPE.checkAlgorithm(value, "number"), context);
    if ((value as number) <= 0) {
      throw new Error(`[XDBC Boundary] ${context}: must be a positive number.`);
    }
  }

  public static optionalUrlOrRelative(value: unknown, context: string): void {
    if (value === undefined) return;

    this.assertXdbc(TYPE.checkAlgorithm(value, "string"), context);
    const composed = OR.checkAlgorithm(
      [new REGEX(REGEX.stdExp.url), new REGEX(rxRelativePath)],
      value,
    );
    this.assertXdbc(composed, context);
  }
}

abstract class BaseProviderConfigValidator {
  protected readonly prefix: string;

  public constructor(
    protected readonly providerId: CloudProviderId,
    protected readonly config: Record<string, unknown>,
  ) {
    this.prefix = `providers.${providerId}`;
  }

  public validate(): ProviderRuntimeConfig {
    this.validateCommonLeafValues();

    const enabled = this.config.enabled !== false;
    const hasPopupOverride = Boolean(this.config.pickerUrl);

    if (enabled && !hasPopupOverride) {
      this.validateSdkModeRequirements();
    }

    return this.config as ProviderRuntimeConfig;
  }

  protected validateCommonLeafValues(): void {
    XdbcBoundary.optionalBoolean(this.config.enabled, `${this.prefix}.enabled`);
    XdbcBoundary.optionalString(this.config.popupFeatures, `${this.prefix}.popupFeatures`);
    XdbcBoundary.optionalPositiveNumber(this.config.timeoutMs, `${this.prefix}.timeoutMs`);
    XdbcBoundary.optionalUrlOrRelative(this.config.pickerUrl, `${this.prefix}.pickerUrl`);

    XdbcBoundary.optionalString(this.config.clientId, `${this.prefix}.clientId`, rxApiKeyLike);
    XdbcBoundary.optionalString(this.config.apiKey, `${this.prefix}.apiKey`, rxApiKeyLike);
    XdbcBoundary.optionalString(this.config.appKey, `${this.prefix}.appKey`, rxApiKeyLike);

    if (this.config.redirectUri !== undefined) {
      XdbcBoundary.optionalUrlOrRelative(this.config.redirectUri, `${this.prefix}.redirectUri`);
    }
  }

  protected abstract validateSdkModeRequirements(): void;
}

class GenericProviderConfigValidator extends BaseProviderConfigValidator {
  protected validateSdkModeRequirements(): void {
    // Generic providers only use common validation.
  }
}

class GoogleDriveConfigValidator extends BaseProviderConfigValidator {
  protected validateSdkModeRequirements(): void {
    XdbcBoundary.requiredString(this.config.clientId, `${this.prefix}.clientId`, rxApiKeyLike);
    XdbcBoundary.requiredString(this.config.apiKey, `${this.prefix}.apiKey`, rxApiKeyLike);
  }
}

class OneDriveConfigValidator extends BaseProviderConfigValidator {
  protected validateSdkModeRequirements(): void {
    XdbcBoundary.requiredString(this.config.clientId, `${this.prefix}.clientId`, rxApiKeyLike);
  }
}

class DropboxConfigValidator extends BaseProviderConfigValidator {
  protected validateSdkModeRequirements(): void {
    XdbcBoundary.requiredString(this.config.appKey, `${this.prefix}.appKey`, rxApiKeyLike);
  }
}

class BayernCloudConfigValidator extends BaseProviderConfigValidator {
  protected validateSdkModeRequirements(): void {
    XdbcBoundary.requiredString(this.config.baseUrl, `${this.prefix}.baseUrl`, REGEX.stdExp.url);
    XdbcBoundary.requiredString(this.config.username, `${this.prefix}.username`);

    const authRule = OR.checkAlgorithm(
      [
        { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.password) },
        { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.bearerToken) },
      ],
      this.config,
    );
    XdbcBoundary.assertXdbc(authRule, `${this.prefix}.password|bearerToken`);

    if (this.config.password !== undefined) {
      XdbcBoundary.requiredString(this.config.password, `${this.prefix}.password`);
    }

    if (this.config.bearerToken !== undefined) {
      XdbcBoundary.requiredString(this.config.bearerToken, `${this.prefix}.bearerToken`);
    }
  }
}

const createProviderValidator = (
  providerId: CloudProviderId,
  config: Record<string, unknown>,
): BaseProviderConfigValidator => {
  if (providerId === "googleDrive") return new GoogleDriveConfigValidator(providerId, config);
  if (providerId === "oneDrive") return new OneDriveConfigValidator(providerId, config);
  if (providerId === "dropbox") return new DropboxConfigValidator(providerId, config);
  if (providerId === "bayerncloud") return new BayernCloudConfigValidator(providerId, config);

  return new GenericProviderConfigValidator(providerId, config);
};

export class PluginOptionsValidator {
  public validate(options: unknown): MultiCloudPluginOptions {
    const raw = XdbcBoundary.ensurePlainObject(options, "plugin options");
    const providersRaw =
      raw.providers === undefined
        ? {}
        : XdbcBoundary.ensurePlainObject(raw.providers, "plugin options.providers");

    const providers: Partial<Record<CloudProviderId, ProviderRuntimeConfig>> = {};

    for (const [providerId, value] of Object.entries(providersRaw)) {
      const config = XdbcBoundary.ensurePlainObject(
        value,
        `plugin options.providers.${providerId}`,
      );

      providers[providerId as CloudProviderId] = createProviderValidator(
        providerId as CloudProviderId,
        config,
      ).validate();
    }

    if (raw.defaultProvider !== undefined) {
      XdbcBoundary.requiredString(raw.defaultProvider, "plugin options.defaultProvider");
    }

    if (raw.defaultInsertMode !== undefined) {
      const mode = raw.defaultInsertMode;
      const isValidMode = mode === "link" || mode === "image" || mode === "embed";
      if (!isValidMode) {
        throw new Error(
          "[XDBC Boundary] plugin options.defaultInsertMode: must be link, image or embed.",
        );
      }
    }

    XdbcBoundary.optionalString(raw.dialogTitle, "plugin options.dialogTitle");
    XdbcBoundary.optionalPositiveNumber(raw.popupTimeoutMs, "plugin options.popupTimeoutMs");

    if (
      raw.defaultProvider !== undefined &&
      providers[raw.defaultProvider as CloudProviderId] === undefined
    ) {
      throw new Error(
        "[XDBC Boundary] plugin options.defaultProvider: provider not configured in providers map.",
      );
    }

    return {
      providers,
      defaultProvider: raw.defaultProvider as CloudProviderId | undefined,
      defaultInsertMode: raw.defaultInsertMode as MultiCloudPluginOptions["defaultInsertMode"],
      dialogTitle: raw.dialogTitle as string | undefined,
      popupTimeoutMs: raw.popupTimeoutMs as number | undefined,
    };
  }
}
