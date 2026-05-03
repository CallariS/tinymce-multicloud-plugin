import type {
    BayernCloudNextcloudProviderConfig,
    CloudItem,
    CloudProvider,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { basicAuthHeader, combineUrl, detectInsertMode, toAbsoluteUrl } from "./utils";
import { validateWebDavNodeBoundary } from "../validation/boundary";

/**
 * Represents a WebDAV node (file or directory) returned by a Nextcloud PROPFIND listing,
 * extended with directory and path metadata.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
type WebDavNode = CloudItem & {
    isDirectory: boolean;
    webdavPath: string;
};

/**
 * Asserts that `value` is a non-empty string and returns it.
 *
 * @param value - The string to test.
 * @param fieldName - Human-readable name of the field, used in the error message.
 * @returns The original `value` string if truthy.
 * @throws {Error} If `value` is `undefined` or empty.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const required = (value: string | undefined, fieldName: string): string => {
    if (!value) {
        throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] BayernCloud requires ${fieldName}. ]`);
    }
    return value;
};

/**
 * Builds the HTTP `Authorization` header map for a Nextcloud request.
 *
 * Priority: `bearerToken` &gt; Basic auth (`username` + `password`) &gt; empty object.
 *
 * @param config - BayernCloud/Nextcloud provider configuration.
 * @returns A `Record<string, string>` containing an `Authorization` header, or `{}` if no credentials.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getAuthHeaders = (config: BayernCloudNextcloudProviderConfig): Record<string, string> => {
    if (config.bearerToken) {
        return { Authorization: `Bearer ${config.bearerToken}` };
    }

    if (config.username && config.password) {
        return { Authorization: basicAuthHeader(config.username, config.password) };
    }

    return {};
};

/**
 * Builds the full WebDAV endpoint URL for listing the configured root folder.
 *
 * Combines `config.baseUrl` with the canonical Nextcloud WebDAV path
 * (`remote.php/dav/files/<username>/<webdavPath>`). `config.webdavPath`
 * defaults to the drive root if omitted.
 *
 * @param config - BayernCloud/Nextcloud provider configuration.
 * @returns The absolute WebDAV endpoint URL string.
 * @throws {Error} If `config.baseUrl` or `config.username` is absent (via {@link required}).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getWebDavEndpoint = (config: BayernCloudNextcloudProviderConfig): string => {
    const baseUrl = required(config.baseUrl, "baseUrl");
    const username = required(config.username, "username");
    const path = (config.webdavPath || "").replace(/^\/+/, "");
    return combineUrl(baseUrl, `remote.php/dav/files/${encodeURIComponent(username)}/${path}`);
};

/**
 * Parses a WebDAV `PROPFIND` XML response body into an array of {@link WebDavNode}.
 *
 * The `<d:response>` element whose `<d:href>` matches the requested `endpoint` is skipped
 * (it represents the listing root itself, not a child). Relative HREFs are resolved against
 * `baseUrl`. Directories are detected by the presence of a `<d:collection>` element.
 *
 * @param baseUrl - The Nextcloud instance base URL (used to resolve relative HREFs).
 * @param endpoint - The PROPFIND endpoint URL (used to filter the root response entry).
 * @param xmlText - The raw XML response body from the PROPFIND request.
 * @returns An array of {@link WebDavNode} objects (may include both files and directories).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const parseWebDavListing = (
    baseUrl: string,
    endpoint: string,
    xmlText: string,
): WebDavNode[] => {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const responses = Array.from(doc.getElementsByTagNameNS("DAV:", "response"));
    const endpointPathname = new URL(endpoint, baseUrl).pathname.replace(/\/+$/, "");

    const nodes: WebDavNode[] = [];

    responses.forEach((responseNode) => {
        const hrefNode = responseNode.getElementsByTagNameNS("DAV:", "href")[0];
        if (!hrefNode?.textContent) {
            return;
        }

        const hrefAbsolute = toAbsoluteUrl(baseUrl, hrefNode.textContent);
        const hrefUrl = new URL(hrefAbsolute, baseUrl);
        const hrefPath = hrefUrl.pathname.replace(/\/+$/, "");

        if (hrefPath === endpointPathname) {
            return;
        }

        const displayNameNode = responseNode.getElementsByTagNameNS("DAV:", "displayname")[0];
        const contentTypeNode = responseNode.getElementsByTagNameNS("DAV:", "getcontenttype")[0];
        const collectionNode = responseNode.getElementsByTagNameNS("DAV:", "collection")[0];

        const isDirectory = Boolean(collectionNode);
        const pathSegments = hrefPath.split("/").filter(Boolean);
        const fallbackName = decodeURIComponent(pathSegments[pathSegments.length - 1] || "file");
        const name = displayNameNode?.textContent?.trim() || fallbackName;

        const rawNode = {
            id: hrefPath,
            name,
            url: hrefAbsolute,
            mimeType: contentTypeNode?.textContent || (isDirectory ? "inode/directory" : undefined),
            type: isDirectory ? "folder" : "file",
            isDirectory,
            webdavPath: hrefPath,
        };

        nodes.push(validateWebDavNodeBoundary(rawNode) as WebDavNode);
    });

    return nodes.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
};

/**
 * Performs a WebDAV `PROPFIND` request (depth 1) against the configured folder and
 * returns the parsed list of child nodes.
 *
 * @param config - BayernCloud/Nextcloud provider configuration.
 * @returns A promise resolving to an array of {@link WebDavNode}.
 * @throws {Error} If `config.baseUrl` or `config.username` is absent.
 * @throws {Error} If the PROPFIND request returns a non-OK HTTP status.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const listWebDavNodes = async (
    config: BayernCloudNextcloudProviderConfig,
): Promise<WebDavNode[]> => {
    const endpoint = getWebDavEndpoint(config);
    const response = await fetch(endpoint, {
        method: "PROPFIND",
        headers: {
            Depth: "1",
            "Content-Type": "application/xml; charset=utf-8",
            ...getAuthHeaders(config),
            ...(config.headers || {}),
        },
        body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontenttype/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
        throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] BayernCloud WebDAV listing failed (${response.status}). ]`);
    }

    const xml = await response.text();
    return parseWebDavListing(required(config.baseUrl, "baseUrl"), endpoint, xml);
};

/**
 * Extracts the public share URL from a Nextcloud OCS Sharing API XML response.
 *
 * @param xmlText - The raw XML body of the OCS API response.
 * @returns The share URL string if found, or `null` if the `<url>` element is absent.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const parseShareUrl = (xmlText: string): string | null => {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const urlNode = doc.getElementsByTagName("url")[0];
    return urlNode?.textContent?.trim() || null;
};

/**
 * Creates a public (anonymous-view) share link for a file on the Nextcloud instance
 * using the OCS Sharing API.
 *
 * Does nothing and returns `null` when `config.createPublicShare` is `false` or absent.
 * The WebDAV path is converted to a root-relative Nextcloud file path before the API call.
 * Optional password protection and expiry date can be set via `config.sharePassword`
 * and `config.shareExpireDate`. The Nextcloud `sharingApiPath` defaults to
 * `/ocs/v2.php/apps/files_sharing/api/v1/shares`.
 *
 * @param config - BayernCloud/Nextcloud provider configuration.
 * @param fileWebDavPath - The server-side WebDAV path of the file to share (e.g. `/remote.php/dav/files/user/file.pdf`).
 * @returns A promise resolving to the public share URL, or `null` if sharing is disabled or fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const createPublicShare = async (
    config: BayernCloudNextcloudProviderConfig,
    fileWebDavPath: string,
): Promise<string | null> => {
    if (!config.createPublicShare) {
        return null;
    }

    const baseUrl = required(config.baseUrl, "baseUrl");
    const sharingPath = config.sharingApiPath || "/ocs/v2.php/apps/files_sharing/api/v1/shares";
    const endpoint = combineUrl(baseUrl, sharingPath);

    const marker = "/remote.php/dav/files/";
    const markerPos = fileWebDavPath.indexOf(marker);
    const relativePath = markerPos >= 0
        ? decodeURIComponent(fileWebDavPath.slice(markerPos + marker.length).split("/").slice(1).join("/"))
        : decodeURIComponent(fileWebDavPath.split("/").slice(-1)[0] || "");

    const payload = new URLSearchParams({
        path: `/${relativePath.replace(/^\/+/, "")}`,
        shareType: "3",
    });

    if (config.sharePassword) {
        payload.set("password", config.sharePassword);
    }
    if (config.shareExpireDate) {
        payload.set("expireDate", config.shareExpireDate);
    }

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "OCS-APIRequest": "true",
            "Content-Type": "application/x-www-form-urlencoded",
            ...getAuthHeaders(config),
            ...(config.headers || {}),
        },
        body: payload.toString(),
    });

    if (!response.ok) {
        return null;
    }

    return parseShareUrl(await response.text());
};

/**
 * Shows a TinyMCE selectbox dialog that lets the user choose a file from the
 * already-fetched WebDAV listing.
 *
 * Only non-directory nodes are presented. The dialog returns the chosen
 * {@link WebDavNode} on submit, or `null` on cancel / close.
 *
 * @param editor - The active TinyMCE editor instance.
 * @param nodes - The WebDAV nodes (files and folders) retrieved from the server.
 * @returns A promise resolving to the selected {@link WebDavNode}, or `null` if cancelled.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const selectBayernCloudNode = async (
    editor: any,
    nodes: WebDavNode[],
): Promise<WebDavNode | null> =>
    new Promise((resolve) => {
        const selectable = nodes.filter((node) => !node.isDirectory);

        if (!selectable.length) {
            resolve(null);
            return;
        }

        const api = editor.windowManager.open({
            title: "BayernCloud (Nextcloud) file picker",
            body: {
                type: "panel",
                items: [
                    {
                        type: "selectbox",
                        name: "fileId",
                        label: "File",
                        items: selectable.map((node) => ({
                            text: node.name,
                            value: node.id,
                        })),
                    },
                ],
            },
            initialData: { fileId: selectable[0].id },
            buttons: [
                { type: "cancel", text: "Cancel" },
                { type: "submit", text: "Insert", primary: true },
            ],
            onSubmit: (dialogApi: any) => {
                const data = dialogApi.getData();
                dialogApi.close();
                resolve(selectable.find((node) => node.id === data.fileId) || null);
            },
            onCancel: () => resolve(null),
            onClose: () => resolve(null),
        });

        api.focus("fileId");
    });

/**
 * Uploads a file to the configured Nextcloud WebDAV path via HTTP `PUT`, optionally
 * creates a public share link, and resolves the appropriate insert mode.
 *
 * Upload destination: `<baseUrl>/remote.php/dav/files/<username>/<webdavPath>/<filename>`.
 *
 * If `config.createPublicShare` is `true` and a share URL is obtained:
 * - **Image files**: share URL used as-is (no `/download` suffix, to avoid
 *   `Content-Disposition: attachment` which breaks `<img>` rendering).
 * - **Other files**: `/download` appended to force direct content delivery.
 *
 * PDF and OOXML documents with a public share URL are wrapped in a Google Docs Viewer
 * `<iframe>` embed URL for preview. For all other types, {@link detectInsertMode} selects
 * the insert mode based on file extension / MIME type.
 *
 * @param config - BayernCloud/Nextcloud provider configuration.
 * @param file - The `File` object to upload.
 * @returns A promise resolving to the {@link PickerResult}, or `null` on cancellation.
 * @throws {Error} If `baseUrl` or `username` is absent, or if the PUT request fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const uploadFile = async (
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Uploading file to Nextcloud:", file.name, "]");

        // Build WebDAV upload URL
        const baseUrl = required(config.baseUrl, "baseUrl");
        const username = required(config.username, "username");
        const webdavPath = (config.webdavPath || "").replace(/^\/+/, "");
        const uploadPath = `${webdavPath}${webdavPath && !webdavPath.endsWith('/') ? '/' : ''}${file.name}`;
        const uploadUrl = combineUrl(
            baseUrl,
            `remote.php/dav/files/${encodeURIComponent(username)}/${uploadPath}`
        );

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Upload URL:", uploadUrl, "]");

        // Upload file using WebDAV PUT
        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": file.type || "application/octet-stream",
                ...getAuthHeaders(config),
                ...(config.headers || {}),
            },
            body: file,
        });

        if (!uploadResponse.ok) {
            throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Upload failed: ${uploadResponse.status} ${uploadResponse.statusText} ]`);
        }

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] File uploaded successfully ]");

        // Get the WebDAV path for the uploaded file
        const webdavFilePath = `/remote.php/dav/files/${username}/${uploadPath}`;

        // Create public share link if enabled
        let shareUrl: string | null = null;
        const isImageFile = file.type.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp|bmp|apng|avif|tiff?)$/i.test(file.name);
        if (config.createPublicShare) {
            shareUrl = await createPublicShare(config, webdavFilePath);
            if (shareUrl) {
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Created public share:", shareUrl, "]");
                // For images, do NOT append /download — Content-Disposition: attachment prevents <img> rendering
                if (!isImageFile) {
                    shareUrl = shareUrl + "/download";
                }
            }
        }

        // Construct the file URL
        const fileUrl = shareUrl || uploadUrl;

        // Check if file should be embedded
        const fileName = file.name || "";
        const isPdf = /\.pdf$/i.test(fileName);
        const isOfficeDoc = /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(fileName);
        const isPublicShare = shareUrl !== null;

        let embedUrl: string | undefined;
        if ((isPdf || isOfficeDoc) && isPublicShare) {
            // Use Google Docs Viewer for documents with public share links
            embedUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;
        }

        return {
            item: {
                id: webdavFilePath,
                name: file.name,
                url: fileUrl,
                embedUrl,
                mimeType: file.type || "application/octet-stream",
            },
            mode: detectInsertMode({
                id: webdavFilePath,
                name: file.name,
                url: fileUrl,
                mimeType: file.type,
            }),
        };
    } catch (error) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Upload error:", error, "]");
        throw error;
    }
};

/**
 * Factory that creates the BayernCloud/Nextcloud {@link CloudProvider} instance.
 *
 * In SDK mode (`pickerUrl` absent), lists the configured WebDAV folder with a PROPFIND
 * request, shows a TinyMCE selectbox dialog for file selection, and optionally creates a
 * public share link via the OCS Sharing API. Uploading uses WebDAV PUT.
 *
 * Only `mode: "nextcloud-webdav"` is supported (this is also the default when `mode` is
 * omitted). Any other value throws.
 *
 * In mock/popup mode (`pickerUrl` present), delegates pick operations to a custom
 * popup URL via {@link createPopupProvider}.
 *
 * @returns A fully-configured {@link CloudProvider} with `id: "bayerncloud"`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const bayerncloudProvider = (): CloudProvider => ({
    id: "bayerncloud",
    label: "Nextcloud / BayernCloud",
    pick: async (context) => {
        const config = context.providerConfig as BayernCloudNextcloudProviderConfig;

        if (config.pickerUrl) {
            return await createPopupProvider("bayerncloud", "BayernCloud", "/pickers/bayerncloud.html").pick(context);
        }

        if ((config.mode || "nextcloud-webdav") !== "nextcloud-webdav") {
            throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Unsupported BayernCloud mode. Use nextcloud-webdav. ]");
        }

        const nodes = await listWebDavNodes(config);
        const selected = await selectBayernCloudNode(context.editor, nodes);

        if (!selected) {
            return null;
        }

        const shareUrl = await createPublicShare(config, selected.webdavPath);
        const isImage = selected.mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp|bmp|apng|avif|tiff?)$/i.test(selected.name);
        const isSvg = selected.mimeType === "image/svg+xml" || /\.svg$/i.test(selected.name);
        // For images, do NOT append /download — that adds Content-Disposition: attachment which prevents <img> rendering
        const targetUrl = shareUrl ? (isImage ? shareUrl : shareUrl + "/download") : selected.url;

        const result: PickerResult = {
            item: {
                id: selected.id,
                name: selected.name,
                url: targetUrl,
                mimeType: selected.mimeType,
            },
            mode: isSvg ? "link" : detectInsertMode({
                id: selected.id,
                name: selected.name,
                url: targetUrl,
                mimeType: selected.mimeType,
            }),
        };

        return result;
    },
    upload: async (context, file) => {
        const config = context.providerConfig as BayernCloudNextcloudProviderConfig;

        if (config.pickerUrl) {
            // For pickerUrl mode, open the picker in upload mode
            // The picker will handle file selection and upload internally
            const timeoutMs =
                config.timeoutMs ??
                context.options.popupTimeoutMs ??
                120000;
            const popupFeatures =
                config.popupFeatures ?? "popup=yes,width=1120,height=760,resizable=yes,scrollbars=yes";

            // Resolve picker URL
            // If it starts with http/https, use as-is
            // If it starts with ./ or ../, resolve relative to current page
            // Otherwise, resolve relative to plugin URL
            let pickerUrl: string;
            if (config.pickerUrl.startsWith("http")) {
                pickerUrl = config.pickerUrl;
            } else if (config.pickerUrl.startsWith("./") || config.pickerUrl.startsWith("../")) {
                // Resolve relative to the current page location
                pickerUrl = new URL(config.pickerUrl, window.location.href).toString();
            } else {
                // Resolve relative to plugin URL
                pickerUrl = new URL(config.pickerUrl, context.pluginUrl).toString();
            }

            // Add upload mode parameter
            const uploadUrl = pickerUrl.includes('?')
                ? `${pickerUrl}&mode=upload`
                : `${pickerUrl}?mode=upload`;

            const popup = window.open(uploadUrl, "tinymce_multicloud_picker", popupFeatures);

            if (!popup) {
                throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Popup could not be opened. Allow popups for this site. ]");
            }

            // Wait for upload result
            return new Promise((resolve, reject) => {
                let timeoutRef: number | undefined;

                const cleanup = () => {
                    window.removeEventListener("message", onMessage);
                    if (typeof timeoutRef === "number") {
                        window.clearTimeout(timeoutRef);
                    }
                };

                const onMessage = (event: MessageEvent) => {
                    const message = event.data;
                    if (!message || message.source !== "tinymce-multicloud-plugin") {
                        return;
                    }
                    if (message.providerId !== "bayerncloud") {
                        return;
                    }

                    cleanup();
                    popup.close();

                    if (message.type === "cancelled") {
                        resolve(null);
                        return;
                    }

                    if (!message.payload?.item?.url) {
                        reject(new Error("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Picker returned no file URL. ]"));
                        return;
                    }

                    resolve(message.payload);
                };

                window.addEventListener("message", onMessage);

                timeoutRef = window.setTimeout(() => {
                    cleanup();
                    popup.close();
                    reject(new Error("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Upload timed out. ]"));
                }, timeoutMs) as unknown as number;
            });
        }

        if ((config.mode || "nextcloud-webdav") !== "nextcloud-webdav") {
            throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / BayernCloud ] Unsupported BayernCloud mode. Use nextcloud-webdav. ]");
        }

        return await uploadFile(config, file);
    },
});
