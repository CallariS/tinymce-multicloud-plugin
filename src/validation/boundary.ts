import { ZOD } from "xdbc/src/DBC/ZOD";
import { DEFINED } from "xdbc/src/DBC/DEFINED";
import { OR } from "xdbc/src/DBC/OR";
import { REGEX } from "xdbc/src/DBC/REGEX";
import { TYPE } from "xdbc/src/DBC/TYPE";
import { z } from "zod";
import type {
    CloudProviderId,
    MultiCloudPluginOptions,
    PickerResult,
    ProviderRuntimeConfig,
} from "../types";

const rxNonEmpty = /^.*\S.*$/;
const rxRelativePath = /^(?:\.{1,2}\/|\/)[^\s]+$/;
const rxApiKeyLike = /^[A-Za-z0-9._\-~]{8,}$/;

const assertXdbc = (result: boolean | string, context: string): void => {
    if (result !== true) {
        throw new Error(`[XDBC Boundary] ${context}: ${result}`);
    }
};

const ensurePlainObject = (value: unknown, context: string): Record<string, unknown> => {
    assertXdbc(TYPE.checkAlgorithm(value, "object"), context);

    if (value === null || Array.isArray(value)) {
        throw new Error(`[XDBC Boundary] ${context}: expected a non-null object.`);
    }

    return value as Record<string, unknown>;
};

const validateOptionalString = (
    value: unknown,
    context: string,
    regex: RegExp = rxNonEmpty,
): void => {
    if (value === undefined) return;

    assertXdbc(TYPE.checkAlgorithm(value, "string"), context);
    assertXdbc(REGEX.checkAlgorithm(value, regex), context);
};

const validateRequiredString = (
    value: unknown,
    context: string,
    regex: RegExp = rxNonEmpty,
): void => {
    assertXdbc(DEFINED.checkAlgorithm(value), context);
    assertXdbc(TYPE.checkAlgorithm(value, "string"), context);
    assertXdbc(REGEX.checkAlgorithm(value, regex), context);
};

const validateOptionalBoolean = (value: unknown, context: string): void => {
    if (value === undefined) return;
    assertXdbc(TYPE.checkAlgorithm(value, "boolean"), context);
};

const validateOptionalPositiveNumber = (value: unknown, context: string): void => {
    if (value === undefined) return;
    assertXdbc(TYPE.checkAlgorithm(value, "number"), context);
    if ((value as number) <= 0) {
        throw new Error(`[XDBC Boundary] ${context}: must be a positive number.`);
    }
};

const validateOptionalUrlOrRelative = (value: unknown, context: string): void => {
    if (value === undefined) return;
    assertXdbc(TYPE.checkAlgorithm(value, "string"), context);

    const composed = OR.checkAlgorithm([
        new REGEX(REGEX.stdExp.url),
        new REGEX(rxRelativePath),
    ], value);
    assertXdbc(composed, context);
};

const validateProviderConfig = (
    providerId: string,
    providerConfig: Record<string, unknown>,
): ProviderRuntimeConfig => {
    const prefix = `providers.${providerId}`;
    const enabled = providerConfig.enabled !== false;

    validateOptionalBoolean(providerConfig.enabled, `${prefix}.enabled`);
    validateOptionalString(providerConfig.popupFeatures, `${prefix}.popupFeatures`);
    validateOptionalPositiveNumber(providerConfig.timeoutMs, `${prefix}.timeoutMs`);
    validateOptionalUrlOrRelative(providerConfig.pickerUrl, `${prefix}.pickerUrl`);

    validateOptionalString(providerConfig.clientId, `${prefix}.clientId`, rxApiKeyLike);
    validateOptionalString(providerConfig.apiKey, `${prefix}.apiKey`, rxApiKeyLike);
    validateOptionalString(providerConfig.appKey, `${prefix}.appKey`, rxApiKeyLike);

    if (providerConfig.redirectUri !== undefined) {
        validateOptionalUrlOrRelative(providerConfig.redirectUri, `${prefix}.redirectUri`);
    }

    const hasPopupOverride = Boolean(providerConfig.pickerUrl);
    if (enabled && !hasPopupOverride) {
        if (providerId === "googleDrive") {
            validateRequiredString(providerConfig.clientId, `${prefix}.clientId`, rxApiKeyLike);
            validateRequiredString(providerConfig.apiKey, `${prefix}.apiKey`, rxApiKeyLike);
        }

        if (providerId === "oneDrive") {
            validateRequiredString(providerConfig.clientId, `${prefix}.clientId`, rxApiKeyLike);
        }

        if (providerId === "dropbox") {
            validateRequiredString(providerConfig.appKey, `${prefix}.appKey`, rxApiKeyLike);
        }

        if (providerId === "bayerncloud") {
            validateRequiredString(providerConfig.baseUrl, `${prefix}.baseUrl`, REGEX.stdExp.url);
            validateRequiredString(providerConfig.username, `${prefix}.username`);

            const authRule = OR.checkAlgorithm([
                { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.password) },
                { check: (v) => DEFINED.checkAlgorithm((v as Record<string, unknown>)?.bearerToken) },
            ], providerConfig);
            assertXdbc(authRule, `${prefix}.password|bearerToken`);

            if (providerConfig.password !== undefined) {
                validateRequiredString(providerConfig.password, `${prefix}.password`);
            }
            if (providerConfig.bearerToken !== undefined) {
                validateRequiredString(providerConfig.bearerToken, `${prefix}.bearerToken`);
            }
        }
    }

    return providerConfig as ProviderRuntimeConfig;
};

const pickerResultSchema = z.object({
    item: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        url: z.string().url(),
        mimeType: z.string().optional(),
        thumbnailUrl: z.string().url().optional(),
        embedUrl: z.string().url().optional(),
        downloadUrl: z.string().url().optional(),
        type: z.enum(["file", "folder"]).optional(),
    }),
    mode: z.enum(["link", "image", "embed"]).optional(),
});

const googleDocSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
    mimeType: z.string().optional(),
    thumbnails: z
        .array(
            z.object({
                url: z.string().url().optional(),
            }),
        )
        .optional(),
});

const oneDriveFileSchema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    webUrl: z.string().url().optional(),
    "@microsoft.graph.downloadUrl": z.string().url().optional(),
    file: z
        .object({
            mimeType: z.string().optional(),
        })
        .optional(),
});

const dropboxFileSchema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    link: z.string().url(),
    thumbnailLink: z.string().url().optional(),
});

const webDavNodeSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
    mimeType: z.string().optional(),
    isDirectory: z.boolean(),
    webdavPath: z.string().min(1),
});

const validate = <T>(name: string, value: unknown, schema: z.ZodType<T>): T => {
    const result = ZOD.checkAlgorithm(value, schema);
    if (result !== true) {
        throw new Error(`[XDBC Boundary] ${name}: ${result}`);
    }

    return schema.parse(value);
};

export const validatePluginOptionsBoundary = (
    options: unknown,
): MultiCloudPluginOptions => {
    const raw = ensurePlainObject(options, "plugin options");
    const providersRaw = raw.providers === undefined
        ? {}
        : ensurePlainObject(raw.providers, "plugin options.providers");

    const providers: Partial<Record<CloudProviderId, ProviderRuntimeConfig>> = {};
    for (const [providerId, value] of Object.entries(providersRaw)) {
        const config = ensurePlainObject(value, `plugin options.providers.${providerId}`);
        providers[providerId as CloudProviderId] = validateProviderConfig(providerId, config);
    }

    if (raw.defaultProvider !== undefined) {
        validateRequiredString(raw.defaultProvider, "plugin options.defaultProvider");
    }

    if (raw.defaultInsertMode !== undefined) {
        const mode = raw.defaultInsertMode;
        const isValidMode = mode === "link" || mode === "image" || mode === "embed";
        if (!isValidMode) {
            throw new Error("[XDBC Boundary] plugin options.defaultInsertMode: must be link, image or embed.");
        }
    }

    validateOptionalString(raw.dialogTitle, "plugin options.dialogTitle");
    validateOptionalPositiveNumber(raw.popupTimeoutMs, "plugin options.popupTimeoutMs");

    if (raw.defaultProvider !== undefined && providers[raw.defaultProvider as CloudProviderId] === undefined) {
        throw new Error("[XDBC Boundary] plugin options.defaultProvider: provider not configured in providers map.");
    }

    return {
        providers,
        defaultProvider: raw.defaultProvider as CloudProviderId | undefined,
        defaultInsertMode: raw.defaultInsertMode as MultiCloudPluginOptions["defaultInsertMode"],
        dialogTitle: raw.dialogTitle as string | undefined,
        popupTimeoutMs: raw.popupTimeoutMs as number | undefined,
    };
};

export const validatePickerResultBoundary = (
    providerId: CloudProviderId,
    result: unknown,
): PickerResult => validate(`${providerId} picker result`, result, pickerResultSchema);

export const validateGoogleDocBoundary = (doc: unknown) =>
    validate("google picker doc", doc, googleDocSchema);

export const validateOneDriveFileBoundary = (file: unknown) =>
    validate("onedrive selection", file, oneDriveFileSchema);

export const validateDropboxFileBoundary = (file: unknown) =>
    validate("dropbox selection", file, dropboxFileSchema);

export const validateWebDavNodeBoundary = (node: unknown) =>
    validate("bayerncloud webdav node", node, webDavNodeSchema);
