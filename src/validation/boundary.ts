import { ZOD } from "xdbc/src/DBC/ZOD";
import { z } from "zod";
import type {
    CloudProviderId,
    MultiCloudPluginOptions,
    PickerResult,
} from "../types";
import { PluginOptionsValidator } from "./config/validators";

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
): MultiCloudPluginOptions => new PluginOptionsValidator().validate(options);

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
