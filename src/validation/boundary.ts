import { ZOD } from "xdbc/src/DBC/ZOD";
import { z } from "zod";
import type {
    CloudProviderId,
    MultiCloudPluginOptions,
    PickerResult,
} from "../types";

const providerRuntimeConfigSchema = z.object({
    enabled: z.boolean().optional(),
    pickerUrl: z.string().min(1).optional(),
    popupFeatures: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    clientId: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    scopes: z.array(z.string().min(1)).optional(),
    token: z.string().min(1).optional(),
    headers: z.record(z.string()).optional(),
    appId: z.string().min(1).optional(),
    pickerLocale: z.string().min(1).optional(),
    viewMimeTypes: z.string().min(1).optional(),
    action: z.enum(["query", "share", "download"]).optional(),
    multiSelect: z.boolean().optional(),
    redirectUri: z.string().min(1).optional(),
    advanced: z.record(z.unknown()).optional(),
    appKey: z.string().min(1).optional(),
    linkType: z.enum(["preview", "direct"]).optional(),
    multiselect: z.boolean().optional(),
    extensions: z.array(z.string().min(1)).optional(),
    mode: z.literal("nextcloud-webdav").optional(),
    baseUrl: z.string().url().optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    bearerToken: z.string().min(1).optional(),
    webdavPath: z.string().optional(),
    createPublicShare: z.boolean().optional(),
    sharingApiPath: z.string().min(1).optional(),
    sharePassword: z.string().min(1).optional(),
    shareExpireDate: z.string().min(1).optional(),
});

const pluginOptionsSchema = z.object({
    providers: z.record(providerRuntimeConfigSchema).optional(),
    defaultProvider: z.string().min(1).optional(),
    defaultInsertMode: z.enum(["link", "image", "embed"]).optional(),
    dialogTitle: z.string().min(1).optional(),
    popupTimeoutMs: z.number().int().positive().optional(),
});

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
): MultiCloudPluginOptions => validate("plugin options", options, pluginOptionsSchema);

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
