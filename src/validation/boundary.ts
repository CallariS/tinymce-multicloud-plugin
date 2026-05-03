import { ZOD } from "xdbc/src/DBC/ZOD";
import { z } from "zod";
import type {
    CloudProviderId,
    MultiCloudPluginOptions,
    PickerResult,
} from "../types";
import { PluginOptionsValidator } from "./config/validators";

/**
 * Zod schema that validates the shape of a {@link PickerResult} returned by any
 * cloud provider. Ensures `item.id`, `item.name`, and `item.url` are non-empty
 * and that `item.url` is a valid URL. All optional URL fields (`thumbnailUrl`,
 * `embedUrl`, `downloadUrl`) are also validated as URLs when present.
 */
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

/**
 * Zod schema for a Google Drive file/document object returned by the Google Picker API.
 * Validates the `id` field as required; all other fields (`name`, `url`, `mimeType`,
 * `thumbnails`) are optional but type-checked when present.
 */
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

/**
 * Zod schema for a Microsoft Graph Drive item returned by the OneDrive navigable picker.
 * Validates `name` as required; `id`, `webUrl`, `@microsoft.graph.downloadUrl`, and
 * `file.mimeType` are optional but type-checked when present.
 */
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

/**
 * Zod schema for a Dropbox Chooser file object.
 * Validates `link` as a required URL; `id`, `name`, and `thumbnailLink` are optional
 * but validated as URL / non-empty string when present.
 */
const dropboxFileSchema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    link: z.string().url(),
    thumbnailLink: z.string().url().optional(),
});

/**
 * Zod schema for a BayernCloud/Nextcloud WebDAV node (as produced by
 * `parseWebDavListing`). Validates `id`, `name`, `url`, and `webdavPath` as non-empty
 * strings, `mimeType` as an optional string, and `isDirectory` as a boolean.
 */
const webDavNodeSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
    mimeType: z.string().optional(),
    isDirectory: z.boolean(),
    webdavPath: z.string().min(1),
});

/**
 * Validates raw plugin options at the system boundary.
 *
 * Delegates to {@link PluginOptionsValidator} which applies both xdbc DBC contract
 * checks and normalisation. Use this function as the single entry point for all
 * user-supplied plugin configuration before it is consumed by the plugin internals.
 *
 * @param options - The raw (untyped) plugin options object supplied by the integrator.
 * @returns The validated and normalised {@link MultiCloudPluginOptions}.
 * @throws {DBC.Infringement} If any required field is missing or violates a contract
 *   (unless soft logging mode is active via {@link configureMultiCloudValidation}).
 * @throws {ZodError} If the Zod schema rejects the shape of any nested field.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const validatePluginOptionsBoundary = (
    options: unknown,
): MultiCloudPluginOptions => new PluginOptionsValidator().validate(options);

/**
 * Validates the raw result object returned by a cloud provider's picker against the
 * `pickerResultSchema` Zod schema.
 *
 * @param providerId - Identifier of the provider (used in the error message context).
 * @param result - The raw picker result value to validate.
 * @returns The validated {@link PickerResult}.
 * @throws {ZodError} If the value does not conform to `pickerResultSchema`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const validatePickerResultBoundary = (
    providerId: CloudProviderId,
    result: unknown,
): PickerResult => ZOD.tsCheck<PickerResult>(result, pickerResultSchema, `${providerId} picker result`);

/**
 * Validates a raw Google Picker document object against `googleDocSchema`.
 *
 * @param doc - The raw document object from the Google Picker callback.
 * @returns The validated typed Google Doc object.
 * @throws {ZodError} If the value does not conform to `googleDocSchema`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const validateGoogleDocBoundary = (doc: unknown) =>
    ZOD.tsCheck<z.infer<typeof googleDocSchema>>(doc, googleDocSchema, "google picker doc");

/**
 * Validates a raw Microsoft Graph Drive item against `oneDriveFileSchema`.
 *
 * @param file - The raw item object from the OneDrive navigable picker.
 * @returns The validated typed OneDrive file object.
 * @throws {ZodError} If the value does not conform to `oneDriveFileSchema`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const validateOneDriveFileBoundary = (file: unknown) =>
    ZOD.tsCheck<z.infer<typeof oneDriveFileSchema>>(file, oneDriveFileSchema, "onedrive selection");

/**
 * Validates a raw Dropbox Chooser file object against `dropboxFileSchema`.
 *
 * @param file - The raw file object from the Dropbox Chooser callback.
 * @returns The validated typed Dropbox file object.
 * @throws {ZodError} If the value does not conform to `dropboxFileSchema`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const validateDropboxFileBoundary = (file: unknown) =>
    ZOD.tsCheck<z.infer<typeof dropboxFileSchema>>(file, dropboxFileSchema, "dropbox selection");

/**
 * Validates a raw BayernCloud/Nextcloud WebDAV node against `webDavNodeSchema`.
 *
 * @param node - The raw WebDAV node object as returned by `parseWebDavListing`.
 * @returns The validated typed {@link WebDavNode}-shaped object.
 * @throws {ZodError} If the value does not conform to `webDavNodeSchema`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const validateWebDavNodeBoundary = (node: unknown) =>
    ZOD.tsCheck<z.infer<typeof webDavNodeSchema>>(node, webDavNodeSchema, "bayerncloud webdav node");
