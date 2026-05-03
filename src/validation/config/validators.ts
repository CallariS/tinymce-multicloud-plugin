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

/** Matches any string that contains at least one non-whitespace character. */
const rxNonEmpty = /^.*\S.*$/;
/** Matches strings that look like a relative or root-relative file path (starts with `./`, `../`, or `/`). */
const rxRelativePath = /^(?:\.{1,2}\/|\/)[^\s]+$/;
/** Matches strings that could plausibly be an API key (8+ alphanumeric/punctuation characters). */
const rxApiKeyLike = /^[A-Za-z0-9._\-~]{8,}$/;
/**
 * Dot-separated global path at which the config-layer {@link DBC} instance is registered
 * (i.e. `globalThis.MultiCloud.Validation.Config`).
 *
 * Controls how DBC violations in **configuration checks** (constructor preconditions,
 * field-shape invariants) are reported. Configure independently via
 * {@link configureMultiCloudValidation} `config` key.
 */
const VALIDATION_DBC_PATH = "MultiCloud.Validation.Config";

/**
 * Dot-separated global path at which the boundary-layer {@link DBC} instance is registered
 * (i.e. `globalThis.MultiCloud.Validation.Boundary`).
 *
 * Controls how DBC violations in **[Zod](https://zod.dev) boundary schema checks** (provider
 * API response shapes) are reported. Configure independently via
 * {@link configureMultiCloudValidation} `boundary` key.
 */
export const BOUNDARY_DBC_PATH = "MultiCloud.Validation.Boundary";

/**
 * Ensures a {@link DBC} instance exists at the given dot-separated `globalThis` path.
 *
 * Walks or creates each intermediate object along the segment chain, then instantiates
 * `new DBC()` at the final leaf node. Subsequent calls for the same path are no-ops
 * because the leaf is already a `DBC` instance.
 *
 * @param path - Dot-separated path at which to register the DBC instance.
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const ensureDBCAtPath = (path: string): void => {
    const host = globalThis as Record<string, unknown>;
    const segments = path.split(".");
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

ensureDBCAtPath(VALIDATION_DBC_PATH);
ensureDBCAtPath(BOUNDARY_DBC_PATH);

/**
 * Abstract base class for all per-provider configuration validators.
 *
 * Uses xdbc `@DBC.ParamvalueProvider` so that constructor parameter decorators
 * (`@DEFINED.PRE`, `@PLAIN_OBJECT.PRE`) are resolved through the registered DBC
 * instance at {@link VALIDATION_DBC_PATH}.
 *
 * Subclasses implement {@link validateSdkModeRequirements} to enforce provider-specific
 * required fields (e.g. `clientId`, `appKey`). SDK-mode checks are skipped when
 * `config.enabled === false` or a `pickerUrl` popup override is present.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
@DBC.ParamvalueProvider
abstract class BaseProviderConfigValidator {
    protected readonly prefix: string;
    protected readonly config: Record<string, unknown>;

    /**
     * @param providerId - The cloud provider identifier (used for error context paths).
     * @param config - The raw provider configuration object.
     * @throws {DBC.Infringement} If `config` is `undefined` or not a plain object
     *   (unless soft logging mode is active via {@link configureMultiCloudValidation}).
     */
    public constructor(
        protected readonly providerId: CloudProviderId,
        @DEFINED.PRE(undefined, "Did you pass a provider config object?", VALIDATION_DBC_PATH)
        @PLAIN_OBJECT.PRE(undefined, "Did you pass a provider config as an object?", VALIDATION_DBC_PATH)
        config: Record<string, unknown>,
    ) {
        this.prefix = `providers.${providerId}`;
        this.config = config;
    }

    /**
     * Validates the provider configuration and returns a typed {@link ProviderRuntimeConfig}.
     *
     * SDK-mode field checks (see {@link validateSdkModeRequirements}) are run only when the
     * provider is both enabled and does not have a `pickerUrl` popup override.
     *
     * @returns The validated, narrowed {@link ProviderRuntimeConfig} object.
     * @throws {DBC.Infringement} If any required SDK-mode field is absent or invalid
     *   (unless soft logging mode is active via {@link configureMultiCloudValidation}).
     */
    public validate(): ProviderRuntimeConfig {
        const enabled = this.config.enabled !== false;
        const hasPopupOverride = Boolean(this.config.pickerUrl);

        if (enabled && !hasPopupOverride) {
            this.validateSdkModeRequirements(this.config, this.prefix);
        }

        return this.config as ProviderRuntimeConfig;
    }

    /**
     * Validates provider-specific fields that are required in SDK mode (i.e. when no
     * `pickerUrl` popup override is configured and the provider is enabled).
     *
     * @param config - The raw provider configuration object.
     * @param context - Dot-separated xdbc context path used in infringement messages.
     * @throws {DBC.Infringement} If any required SDK-mode field is absent or invalid
     *   (unless soft logging mode is active via {@link configureMultiCloudValidation}).
     */
    protected abstract validateSdkModeRequirements(
        config: Record<string, unknown>,
        context: string,
    ): void;
}

/**
 * Validator for providers that have no provider-specific SDK-mode requirements
 * beyond the common base checks (i.e. popup-only or custom providers).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/**
 * Validator for the Google Drive provider. Enforces that `clientId` and `apiKey` are
 * both present, string-typed, and at least superficially key-shaped in SDK mode.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/**
 * Validator for the OneDrive provider. Enforces that `clientId` is present,
 * a string, and at least superficially key-shaped in SDK mode.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
class OneDriveConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(config: Record<string, unknown>, context: string): void {
        DEFINED.tsCheck(config.clientId, "Did you set OneDrive clientId?", `${context}.clientId`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.clientId, "string", "Did you set OneDrive clientId as a string?", `${context}.clientId`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.clientId, rxApiKeyLike, "Did you provide a valid OneDrive clientId?", `${context}.clientId`, VALIDATION_DBC_PATH);
    }
}

/**
 * Validator for the Dropbox provider. Enforces that `appKey` is present,
 * a string, and at least superficially key-shaped in SDK mode.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
class DropboxConfigValidator extends BaseProviderConfigValidator {
    protected validateSdkModeRequirements(config: Record<string, unknown>, context: string): void {
        DEFINED.tsCheck(config.appKey, "Did you set Dropbox appKey?", `${context}.appKey`, VALIDATION_DBC_PATH);
        TYPE.tsCheck(config.appKey, "string", "Did you set Dropbox appKey as a string?", `${context}.appKey`, VALIDATION_DBC_PATH);
        REGEX.tsCheck(config.appKey, rxApiKeyLike, "Did you provide a valid Dropbox appKey?", `${context}.appKey`, VALIDATION_DBC_PATH);
    }
}

/**
 * Validator for the BayernCloud/Nextcloud provider. Enforces that `baseUrl` is a valid URL,
 * `username` is non-empty, and that at least one of `password` or `bearerToken` is supplied
 * in SDK mode.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/**
 * Returns the appropriate {@link BaseProviderConfigValidator} subclass for the given provider.
 *
 * Falls back to {@link GenericProviderConfigValidator} for unrecognised provider IDs
 * (e.g. custom providers registered by integrators).
 *
 * @param providerId - The cloud provider identifier.
 * @param config - The raw (already normalised) provider configuration object.
 * @returns A validator instance ready to call `.validate()` on.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/**
 * Normalises a raw provider configuration value to a plain `Record<string, unknown>`.
 *
 * Accepted input forms:
 * - `undefined` / `null` → `{ enabled: false }`
 * - `boolean` → `{ enabled: <value> }`
 * - `object` (non-array) → shallow copy of the object
 *
 * Any other value triggers a DBC infringement.
 *
 * @param providerId - The cloud provider identifier (used in error context paths).
 * @param value - The raw value from `MultiCloudPluginOptions.providers[providerId]`.
 * @returns A normalised plain object config record.
 * @throws {DBC.Infringement} If `value` is not one of the accepted forms
 *   (unless soft logging mode is active via {@link configureMultiCloudValidation}).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/** Shape shared by both `config` and `boundary` sub-option objects. */
type DBCLayerOptions = {
    /** When `true` (default), violations throw `DBC.Infringement`. Set to `false` for soft logging mode. */
    throwOnInfringement?: boolean;
    /** When `true` (default), violations are logged to the browser console. Set to `false` to suppress all output. */
    logToConsole?: boolean;
};

/**
 * Applies the given settings to the {@link DBC} instance registered at `path`.
 * Silently no-ops if no DBC instance is found there.
 */
const applyDBCSettings = (path: string, settings: DBCLayerOptions | undefined): void => {
    if (!settings) return;
    const host = globalThis as Record<string, unknown>;
    const segments = path.split(".");
    let cursor: Record<string, unknown> = host;
    for (const segment of segments) {
        if (typeof cursor[segment] !== "object" || cursor[segment] === null) return;
        cursor = cursor[segment] as Record<string, unknown>;
    }
    if (!(cursor instanceof DBC)) return;
    const dbc = cursor as unknown as DBC;
    if (settings.throwOnInfringement !== undefined)
        dbc.infringementSettings.throwException = settings.throwOnInfringement;
    if (settings.logToConsole !== undefined)
        dbc.infringementSettings.logToConsole = settings.logToConsole;
};

/**
 * Configures the xdbc {@link DBC} instances used by the MultiCloud validation layer.
 *
 * Two independent DBC instances control how violations are reported:
 * - **`config`** — governs configuration contract checks (missing/malformed plugin options
 *   and provider credentials). Registered at `globalThis.MultiCloud.Validation.Config`.
 * - **`boundary`** — governs [Zod](https://zod.dev) schema checks on data returned by
 *   provider APIs (picker results, Graph API responses, etc.). Registered at
 *   `globalThis.MultiCloud.Validation.Boundary`.
 *
 * Both layers default to throwing `DBC.Infringement` on violations. Call this function
 * to switch either or both layers to soft logging mode (log to console instead of throwing)
 * or to turn off their output entirely. Settings are applied independently — e.g. you can
 * silence config violations while keeping boundary checks strict.
 *
 * Must be called **before** any plugin initialisation to take effect.
 *
 * @param options.config - Settings for the configuration contract layer.
 * @param options.boundary - Settings for the API boundary schema layer.
 *
 * @example
 * ```ts
 * // Soft-log config violations, keep boundary checks strict (default)
 * configureMultiCloudValidation({
 *   config: { throwOnInfringement: false, logToConsole: true },
 * });
 * ```
 *
 * @example
 * ```ts
 * // Both layers in soft logging mode
 * configureMultiCloudValidation({
 *   config:    { throwOnInfringement: false, logToConsole: true },
 *   boundary:  { throwOnInfringement: false, logToConsole: true },
 * });
 * ```
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const configureMultiCloudValidation = (options: {
    config?: DBCLayerOptions;
    boundary?: DBCLayerOptions;
}): void => {
    applyDBCSettings(VALIDATION_DBC_PATH, options.config);
    applyDBCSettings(BOUNDARY_DBC_PATH, options.boundary);
};

/**
 * Top-level validator for the full {@link MultiCloudPluginOptions} object passed by
 * the integrator to the plugin at registration time.
 *
 * Uses xdbc `INVARIANT` decorators on the `boundaryOptions` property to declare
 * structural contracts that are evaluated every time `boundaryOptions` is assigned.
 * All provider entries are normalised (via {@link normalizeProviderConfig}) and then
 * delegated to the appropriate {@link BaseProviderConfigValidator} subclass.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export class PluginOptionsValidator {
    /**
     * Internal staging field used by the xdbc `INVARIANT` decorators.
     * Writing to this field triggers all declared structural contract checks.
     */
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

    /**
     * Validates raw plugin options, runs all xdbc DBC contract checks, normalises
     * every provider configuration entry, and returns a fully-typed
     * {@link MultiCloudPluginOptions} object ready for use by the plugin internals.
     *
     * @param options - The raw (untyped) options object passed by the integrator.
     * @returns A validated and normalised {@link MultiCloudPluginOptions}.
     * @throws {DBC.Infringement} If any contract check fails
     *   (unless soft logging mode is active via {@link configureMultiCloudValidation}).
     * @throws {ZodError} If a Zod schema check (e.g. via `validatePickerResultBoundary`) fails.
     *
     * @author Salvatore Callari <Callari@WaXCode.net>
     */
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
