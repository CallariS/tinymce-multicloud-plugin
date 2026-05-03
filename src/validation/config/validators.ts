import { DBC } from "xdbc/src/DBC";
import { DEFINED } from "xdbc/src/DBC/DEFINED";
import { GREATER } from "xdbc/src/DBC/COMPARISON/GREATER";
import { OR } from "xdbc/src/DBC/OR";
import { REGEX } from "xdbc/src/DBC/REGEX";
import { TYPE } from "xdbc/src/DBC/TYPE";
import { PLAIN_OBJECT } from "xdbc/src/DBC/ARR/PLAIN_OBJECT";
import type {
    CloudProviderId,
    MultiCloudPluginOptions,
    ProviderRuntimeConfig,
} from "../../types";

const rxNonEmpty = /^.*\S.*$/;
const rxRelativePath = /^(?:\.{1,2}\/|\/)[^\s]+$/;
const rxApiKeyLike = /^[A-Za-z0-9._\-~]{8,}$/;
const VALIDATION_DBC_PATH = "MultiCloud.Validation.DBC";

const ensureDBCInstance = (): void => {
    const host = globalThis as Record<string, unknown>;
    const segments = VALIDATION_DBC_PATH.split(".");
    let cursor: Record<string, unknown> = host;

    for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i];
        if (
            typeof cursor[key] !== "object" ||
            cursor[key] === null ||
            Array.isArray(cursor[key])
        ) {
            cursor[key] = {};
        }

        cursor = cursor[key] as Record<string, unknown>;
    }

    const last = segments[segments.length - 1];
    if (!(cursor[last] instanceof DBC)) {
        cursor[last] = new DBC();
    }
};

ensureDBCInstance();

@DBC.ParamvalueProvider
abstract class BaseProviderConfigValidator {
    protected readonly prefix: string;
    protected readonly config: Record<string, unknown>;

    public constructor(
        protected readonly providerId: CloudProviderId,
        @DEFINED.PRE(undefined, "Did you pass a provider config object?", VALIDATION_DBC_PATH)
        @PLAIN_OBJECT.PRE(undefined, "Did you pass a provider config as an object?", VALIDATION_DBC_PATH)
        config: Record<string, unknown>,
    ) {
        this.prefix = `providers.${providerId}`;
        this.config = config;
    }

    public validate(): ProviderRuntimeConfig {
        const enabled = this.config.enabled !== false;
        const hasPopupOverride = Boolean(this.config.pickerUrl);

        if (enabled && !hasPopupOverride) {
            this.validateSdkModeRequirements(this.config, this.prefix);
        }

        return this.config as ProviderRuntimeConfig;
    }

    protected abstract validateSdkModeRequirements(
        config: Record<string, unknown>,
        context: string,
    ): void;
}

class GenericProviderConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(
        config: Record<string, unknown>,
        context: string,
    ): void {
        void config;
        void context;
        // Generic providers only use common validation.
    }
}

class GoogleDriveConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(config: Record<string, unknown>, context: string): void {
        DEFINED.tsCheck(config.clientId, "Did you set Google Drive clientId?", `${context}.clientId`, VALIDATION_DBC_PATH);
        DEFINED.tsCheck(config.apiKey, "Did you set Google Drive apiKey?", `${context}.apiKey`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.clientId, "string", "Did you set Google Drive clientId as a string?", `${context}.clientId`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.apiKey, "string", "Did you set Google Drive apiKey as a string?", `${context}.apiKey`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.clientId, rxApiKeyLike, "Did you provide a valid Google Drive clientId?", `${context}.clientId`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.apiKey, rxApiKeyLike, "Did you provide a valid Google Drive apiKey?", `${context}.apiKey`, VALIDATION_DBC_PATH);
    }
}

class OneDriveConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(config: Record<string, unknown>, context: string): void {
        DEFINED.tsCheck(config.clientId, "Did you set OneDrive clientId?", `${context}.clientId`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.clientId, "string", "Did you set OneDrive clientId as a string?", `${context}.clientId`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.clientId, rxApiKeyLike, "Did you provide a valid OneDrive clientId?", `${context}.clientId`, VALIDATION_DBC_PATH);
    }
}

class DropboxConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(config: Record<string, unknown>, context: string): void {
        DEFINED.tsCheck(config.appKey, "Did you set Dropbox appKey?", `${context}.appKey`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.appKey, "string", "Did you set Dropbox appKey as a string?", `${context}.appKey`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.appKey, rxApiKeyLike, "Did you provide a valid Dropbox appKey?", `${context}.appKey`, VALIDATION_DBC_PATH);
    }
}

class BayernCloudConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(config: Record<string, unknown>, context: string): void {
        DEFINED.tsCheck(config.baseUrl, "Did you set BayernCloud baseUrl?", `${context}.baseUrl`, VALIDATION_DBC_PATH);
        DEFINED.tsCheck(config.username, "Did you set BayernCloud username?", `${context}.username`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.baseUrl, "string", "Did you set BayernCloud baseUrl as a string?", `${context}.baseUrl`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.username, "string", "Did you set BayernCloud username as a string?", `${context}.username`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.baseUrl, REGEX.stdExp.url, "Did you set BayernCloud baseUrl to a valid URL?", `${context}.baseUrl`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.username, rxNonEmpty, "Did you leave BayernCloud username empty?", `${context}.username`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.password, rxNonEmpty, "Did you leave BayernCloud password empty?", `${context}.password`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.bearerToken, rxNonEmpty, "Did you leave BayernCloud bearerToken empty?", `${context}.bearerToken`, VALIDATION_DBC_PATH);
        OR.tsCheck(
            config,
            [
                { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.password) },
                { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.bearerToken) },
            ],
            "Did you provide BayernCloud password or bearerToken?",
            `${context}.password|bearerToken`,
            VALIDATION_DBC_PATH,
        );
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

const normalizeProviderConfig = (
    providerId: CloudProviderId,
    value: unknown,
): Record<string, unknown> => {
    OR.tsCheck(
        value,
        [
            {
                check: (v) =>
                    v === undefined ||
                    v === null ||
                    typeof v === "boolean" ||
                    (typeof v === "object" && !Array.isArray(v))
                        ? true
                        : "Expected object, boolean, or undefined",
            },
        ],
        "Did you pass a valid provider config (object, boolean, or undefined)?",
        `providers.${providerId}`,
        VALIDATION_DBC_PATH,
    );

    if (value === undefined || value === null) {
        return { enabled: false };
    }

    if (typeof value === "boolean") {
        return { enabled: value };
    }

    return { ...value } as Record<string, unknown>;
};

export const configureMultiCloudValidation = (options: {
    throwOnInfringement?: boolean;
    logToConsole?: boolean;
}): void => {
    const host = globalThis as Record<string, unknown>;
    const segments = VALIDATION_DBC_PATH.split(".");
    let cursor: Record<string, unknown> = host;
    for (const segment of segments) {
        if (typeof cursor[segment] !== "object" || cursor[segment] === null) return;
        cursor = cursor[segment] as Record<string, unknown>;
    }
    if (!(cursor instanceof DBC)) return;
    const dbc = cursor as unknown as DBC;
    if (options.throwOnInfringement !== undefined)
        dbc.infringementSettings.throwException = options.throwOnInfringement;
    if (options.logToConsole !== undefined)
        dbc.infringementSettings.logToConsole = options.logToConsole;
};

export class PluginOptionsValidator {
    @TYPE.INVARIANT("object", undefined, "Did you pass a plugin options object?", VALIDATION_DBC_PATH)
    @PLAIN_OBJECT.INVARIANT("providers", "Did you set plugin options.providers as an object?", VALIDATION_DBC_PATH)
    @TYPE.INVARIANT("string", "defaultProvider::dialogTitle", "Did you set defaultProvider/dialogTitle as strings?", VALIDATION_DBC_PATH)
    @REGEX.INVARIANT(rxNonEmpty, "defaultProvider::dialogTitle", "Did you leave defaultProvider or dialogTitle empty?", VALIDATION_DBC_PATH)
    @TYPE.INVARIANT("number", "popupTimeoutMs", "Did you set popupTimeoutMs as a number?", VALIDATION_DBC_PATH)
    @GREATER.INVARIANT(0, false, false, "popupTimeoutMs", "Did you set popupTimeoutMs greater than 0?", VALIDATION_DBC_PATH)
    @OR.INVARIANT(
        [
            {
                check: (v) =>
                    v === undefined || v === "link" || v === "image" || v === "embed"
                        ? true
                        : "Value has to be one of: link, image, embed",
            },
        ],
        "defaultInsertMode",
        "Did you set defaultInsertMode to link, image, or embed?",
        VALIDATION_DBC_PATH,
    )
    @OR.INVARIANT(
        [
            {
                check: (v) => {
                    if (v === null || typeof v !== "object" || Array.isArray(v)) {
                        return "Value has to be an object";
                    }

                    const raw = v as Record<string, unknown>;
                    const defaultProvider = raw.defaultProvider;
                    if (defaultProvider === undefined) {
                        return true;
                    }

                    if (typeof defaultProvider !== "string") {
                        return "defaultProvider must be a string";
                    }

                    const providers = raw.providers;
                    if (providers === undefined || providers === null || typeof providers !== "object") {
                        return "provider not configured in providers map";
                    }

                    return Object.prototype.hasOwnProperty.call(providers, defaultProvider)
                        ? true
                        : "provider not configured in providers map";
                },
            },
        ],
        undefined,
        "Did you configure defaultProvider inside providers map?",
        VALIDATION_DBC_PATH,
    )
    private boundaryOptions: Record<string, unknown> = {};

    public validate(options: unknown): MultiCloudPluginOptions {
        const raw = PLAIN_OBJECT.tsCheck(
            DEFINED.tsCheck(options, "Did you pass plugin options?", "plugin options", VALIDATION_DBC_PATH) as Record<string, unknown>,
            "Did you pass a plain object for plugin options?",
            "plugin options",
            VALIDATION_DBC_PATH,
        );

        OR.tsCheck(
            raw.defaultInsertMode,
            [{ check: (v) => v === undefined || v === "link" || v === "image" || v === "embed" ? true : "Value has to be one of: link, image, embed" }],
            "Did you set defaultInsertMode to link, image, or embed?",
            "plugin options.defaultInsertMode",
            VALIDATION_DBC_PATH,
        );

        if (raw.popupTimeoutMs !== undefined) {
            TYPE.tsCheck(raw.popupTimeoutMs, "number", "Did you set popupTimeoutMs as a number?", "plugin options.popupTimeoutMs", VALIDATION_DBC_PATH);
            OR.tsCheck(
                raw.popupTimeoutMs,
                [{ check: (v) => typeof v === "number" && v > 0 ? true : "Value must be greater than 0" }],
                "Did you set popupTimeoutMs greater than 0?",
                "plugin options.popupTimeoutMs",
                VALIDATION_DBC_PATH,
            );
        }

        if (raw.defaultProvider !== undefined) {
            OR.tsCheck(
                raw,
                [{
                    check: (v) => {
                        const obj = v as Record<string, unknown>;
                        if (typeof obj.defaultProvider !== "string") return "defaultProvider must be a string";
                        const providers = obj.providers;
                        if (providers === undefined || providers === null || typeof providers !== "object") return "provider not configured in providers map";
                        return Object.prototype.hasOwnProperty.call(providers, obj.defaultProvider)
                            ? true
                            : "provider not configured in providers map";
                    },
                }],
                "Did you configure defaultProvider inside providers map?",
                "plugin options.defaultProvider",
                VALIDATION_DBC_PATH,
            );
        }

        this.boundaryOptions = raw;

        const providersRaw =
            raw.providers === undefined
                ? {}
                : PLAIN_OBJECT.tsCheck(
                      DEFINED.tsCheck(raw.providers, "Did you set providers as a plain object?", "plugin options.providers", VALIDATION_DBC_PATH) as Record<string, unknown>,
                      "Did you set providers as a plain object?",
                      "plugin options.providers",
                      VALIDATION_DBC_PATH,
                  );

        const providers: Partial<Record<CloudProviderId, ProviderRuntimeConfig>> = {};

        for (const [providerId, value] of Object.entries(providersRaw)) {
            const config = normalizeProviderConfig(providerId as CloudProviderId, value);

            providers[providerId as CloudProviderId] = createProviderValidator(
                providerId as CloudProviderId,
                config,
            ).validate();
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
