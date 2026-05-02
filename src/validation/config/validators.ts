import { DBC } from "xdbc/src/DBC";
import { DEFINED } from "xdbc/src/DBC/DEFINED";
import { GREATER } from "xdbc/src/DBC/COMPARISON/GREATER";
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

class XdbcBoundary {
    public static assertXdbc(result: boolean | string, context: string): void {
        if (result !== true) {
            throw new Error(`[XDBC Boundary] ${context}: ${result}`);
        }
    }

    public static ensurePlainObject(value: unknown, context: string): Record<string, unknown> {
        if (
            value === undefined ||
            value === null ||
            Array.isArray(value) ||
            typeof value !== "object"
        ) {
            throw new Error(`[XDBC Boundary] ${context}: expected a plain object.`);
        }

        return value as Record<string, unknown>;
    }
}

abstract class BaseProviderConfigValidator {
    protected readonly prefix: string;
    // Config validated in constructor via XdbcBoundary.ensurePlainObject
    // INVARIANT decorators removed due to conflict with constructor property assignment
    protected readonly config: Record<string, unknown>;

    public constructor(
        protected readonly providerId: CloudProviderId,
        config: Record<string, unknown>,
    ) {
        this.prefix = `providers.${providerId}`;
        this.config = XdbcBoundary.ensurePlainObject(config, `${this.prefix} config`);
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
    @DBC.ParamvalueProvider
    protected validateSdkModeRequirements(
        @DEFINED.PRE("clientId::apiKey", "Did you set Google Drive clientId and apiKey?", VALIDATION_DBC_PATH)
        @TYPE.PRE("string", "clientId::apiKey", "Did you set Google Drive clientId and apiKey as strings?", VALIDATION_DBC_PATH)
        @REGEX.PRE(rxApiKeyLike, "clientId::apiKey", "Did you provide valid Google Drive clientId and apiKey values?", VALIDATION_DBC_PATH)
        config: Record<string, unknown>,
        context: string,
    ): void {
        void config;
        void context;
    }
}

class OneDriveConfigValidator extends BaseProviderConfigValidator {
    @DBC.ParamvalueProvider
    protected validateSdkModeRequirements(
        @DEFINED.PRE("clientId", "Did you set OneDrive clientId?", VALIDATION_DBC_PATH)
        @TYPE.PRE("string", "clientId", "Did you set OneDrive clientId as a string?", VALIDATION_DBC_PATH)
        @REGEX.PRE(rxApiKeyLike, "clientId", "Did you provide a valid OneDrive clientId?", VALIDATION_DBC_PATH)
        config: Record<string, unknown>,
        context: string,
    ): void {
        void config;
        void context;
    }
}

class DropboxConfigValidator extends BaseProviderConfigValidator {
    @DBC.ParamvalueProvider
    protected validateSdkModeRequirements(
        @DEFINED.PRE("appKey", "Did you set Dropbox appKey?", VALIDATION_DBC_PATH)
        @TYPE.PRE("string", "appKey", "Did you set Dropbox appKey as a string?", VALIDATION_DBC_PATH)
        @REGEX.PRE(rxApiKeyLike, "appKey", "Did you provide a valid Dropbox appKey?", VALIDATION_DBC_PATH)
        config: Record<string, unknown>,
        context: string,
    ): void {
        void config;
        void context;
    }
}

class BayernCloudConfigValidator extends BaseProviderConfigValidator {
    @DBC.ParamvalueProvider
    protected validateSdkModeRequirements(
        @DEFINED.PRE("baseUrl::username", "Did you set BayernCloud baseUrl and username?", VALIDATION_DBC_PATH)
        @TYPE.PRE("string", "baseUrl::username", "Did you set BayernCloud baseUrl and username as strings?", VALIDATION_DBC_PATH)
        @REGEX.PRE(REGEX.stdExp.url, "baseUrl", "Did you set BayernCloud baseUrl to a valid URL?", VALIDATION_DBC_PATH)
        @REGEX.PRE(rxNonEmpty, "username::password::bearerToken", "Did you leave BayernCloud credentials empty?", VALIDATION_DBC_PATH)
        config: Record<string, unknown>,
        context: string,
    ): void {
        void context;

        const authRule = OR.checkAlgorithm(
            [
                { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.password) },
                { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.bearerToken) },
            ],
            config,
        );
        XdbcBoundary.assertXdbc(authRule, `${this.prefix}.password|bearerToken`);
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
    if (value === undefined || value === null) {
        return { enabled: false };
    }

    if (typeof value === "boolean") {
        return { enabled: value };
    }

    if (typeof value === "object" && !Array.isArray(value)) {
        // Ensure it's a plain object by creating a shallow copy
        // This handles cases where the object might be a Proxy or have special prototype chains
        return { ...value } as Record<string, unknown>;
    }

    throw new Error(
        `[XDBC Boundary] providers.${providerId}: expected object|boolean|undefined provider config.`,
    );
};

export class PluginOptionsValidator {
    @TYPE.INVARIANT("object", undefined, "Did you pass a plugin options object?", VALIDATION_DBC_PATH)
    @TYPE.INVARIANT("object", "providers", "Did you set plugin options.providers as an object?", VALIDATION_DBC_PATH)
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
        const raw = XdbcBoundary.ensurePlainObject(options, "plugin options");

        const insertMode = raw.defaultInsertMode;
        if (insertMode !== undefined && insertMode !== "link" && insertMode !== "image" && insertMode !== "embed") {
            throw new Error(`[XDBC Boundary] plugin options.defaultInsertMode: expected "link", "image", or "embed".`);
        }

        const timeout = raw.popupTimeoutMs;
        if (timeout !== undefined) {
            if (typeof timeout !== "number") {
                throw new Error(`[XDBC Boundary] plugin options.popupTimeoutMs: expected a number.`);
            }
            if (timeout <= 0) {
                throw new Error(`[XDBC Boundary] plugin options.popupTimeoutMs: expected a positive number greater than 0.`);
            }
        }

        const defaultProvider = raw.defaultProvider;
        if (defaultProvider !== undefined) {
            const providersMap =
                typeof raw.providers === "object" && raw.providers !== null && !Array.isArray(raw.providers)
                    ? (raw.providers as Record<string, unknown>)
                    : null;
            if (
                typeof defaultProvider !== "string" ||
                providersMap === null ||
                !Object.prototype.hasOwnProperty.call(providersMap, defaultProvider)
            ) {
                throw new Error(
                    `[XDBC Boundary] plugin options.defaultProvider: "${String(defaultProvider)}" is not configured in providers.`,
                );
            }
        }

        this.boundaryOptions = raw;

        const providersRaw =
            raw.providers === undefined
                ? {}
                : XdbcBoundary.ensurePlainObject(raw.providers, "plugin options.providers");

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
