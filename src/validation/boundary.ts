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
    mode: z.enum(["link", "image", "embed", "audio"]).optional(),
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

export const validatePluginOptionsBoundary = (
    options: unknown,
): MultiCloudPluginOptions => new PluginOptionsValidator().validate(options);

export const validatePickerResultBoundary = (
    providerId: CloudProviderId,
    result: unknown,
): PickerResult => ZOD.tsCheck<PickerResult>(result, pickerResultSchema, `${providerId} picker result`);

export const validateGoogleDocBoundary = (doc: unknown) =>
    ZOD.tsCheck<z.infer<typeof googleDocSchema>>(doc, googleDocSchema, "google picker doc");

export const validateOneDriveFileBoundary = (file: unknown) =>
    ZOD.tsCheck<z.infer<typeof oneDriveFileSchema>>(file, oneDriveFileSchema, "onedrive selection");

export const validateDropboxFileBoundary = (file: unknown) =>
    ZOD.tsCheck<z.infer<typeof dropboxFileSchema>>(file, dropboxFileSchema, "dropbox selection");

export const validateWebDavNodeBoundary = (node: unknown) =>
    ZOD.tsCheck<z.infer<typeof webDavNodeSchema>>(node, webDavNodeSchema, "bayerncloud webdav node");
