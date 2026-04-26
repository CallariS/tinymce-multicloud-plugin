import type {
    BayernCloudNextcloudProviderConfig,
    CloudItem,
    CloudProvider,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { basicAuthHeader, combineUrl, detectInsertMode, toAbsoluteUrl } from "./utils";
import { validateWebDavNodeBoundary } from "../validation/boundary";

type WebDavNode = CloudItem & {
    isDirectory: boolean;
    webdavPath: string;
};

const required = (value: string | undefined, fieldName: string): string => {
    if (!value) {
        throw new Error(`BayernCloud requires ${fieldName}.`);
    }
    return value;
};

const getAuthHeaders = (config: BayernCloudNextcloudProviderConfig): Record<string, string> => {
    if (config.bearerToken) {
        return { Authorization: `Bearer ${config.bearerToken}` };
    }

    if (config.username && config.password) {
        return { Authorization: basicAuthHeader(config.username, config.password) };
    }

    return {};
};

const getWebDavEndpoint = (config: BayernCloudNextcloudProviderConfig): string => {
    const baseUrl = required(config.baseUrl, "baseUrl");
    const username = required(config.username, "username");
    const path = (config.webdavPath || "").replace(/^\/+/, "");
    return combineUrl(baseUrl, `remote.php/dav/files/${encodeURIComponent(username)}/${path}`);
};

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
        throw new Error(`BayernCloud WebDAV listing failed (${response.status}).`);
    }

    const xml = await response.text();
    return parseWebDavListing(required(config.baseUrl, "baseUrl"), endpoint, xml);
};

const parseShareUrl = (xmlText: string): string | null => {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const urlNode = doc.getElementsByTagName("url")[0];
    return urlNode?.textContent?.trim() || null;
};

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

const uploadFile = async (
    config: BayernCloudNextcloudProviderConfig,
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.log("Uploading file to Nextcloud:", file.name);

        // Build WebDAV upload URL
        const baseUrl = required(config.baseUrl, "baseUrl");
        const username = required(config.username, "username");
        const webdavPath = (config.webdavPath || "").replace(/^\/+/, "");
        const uploadPath = `${webdavPath}${webdavPath && !webdavPath.endsWith('/') ? '/' : ''}${file.name}`;
        const uploadUrl = combineUrl(
            baseUrl,
            `remote.php/dav/files/${encodeURIComponent(username)}/${uploadPath}`
        );

        console.log("Upload URL:", uploadUrl);

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
            throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
        }

        console.log("File uploaded successfully");

        // Get the WebDAV path for the uploaded file
        const webdavFilePath = `/remote.php/dav/files/${username}/${uploadPath}`;

        // Create public share link if enabled
        let shareUrl: string | null = null;
        if (config.createPublicShare) {
            shareUrl = await createPublicShare(config, webdavFilePath);
            if (shareUrl) {
                console.log("Created public share:", shareUrl);
                // Append /download for direct file access (needed for embedding)
                shareUrl = shareUrl + "/download";
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
        console.error("Upload error:", error);
        throw error;
    }
};

export const bayerncloudProvider = (): CloudProvider => ({
    id: "bayerncloud",
    label: "BayernCloud",
    pick: async (context) => {
        const config = context.providerConfig as BayernCloudNextcloudProviderConfig;

        if (config.pickerUrl) {
            return await createPopupProvider("bayerncloud", "BayernCloud", "/pickers/bayerncloud.html").pick(context);
        }

        if ((config.mode || "nextcloud-webdav") !== "nextcloud-webdav") {
            throw new Error("Unsupported BayernCloud mode. Use nextcloud-webdav.");
        }

        const nodes = await listWebDavNodes(config);
        const selected = await selectBayernCloudNode(context.editor, nodes);

        if (!selected) {
            return null;
        }

        const shareUrl = await createPublicShare(config, selected.webdavPath);
        // Append /download for direct file access (needed for embedding videos, images, PDFs)
        const targetUrl = shareUrl ? shareUrl + "/download" : selected.url;

        const result: PickerResult = {
            item: {
                id: selected.id,
                name: selected.name,
                url: targetUrl,
                mimeType: selected.mimeType,
            },
            mode: detectInsertMode({
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
                throw new Error("Popup could not be opened. Allow popups for this site.");
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
                        reject(new Error("Picker returned no file URL."));
                        return;
                    }

                    resolve(message.payload);
                };

                window.addEventListener("message", onMessage);

                timeoutRef = window.setTimeout(() => {
                    cleanup();
                    popup.close();
                    reject(new Error("Upload timed out."));
                }, timeoutMs) as unknown as number;
            });
        }

        if ((config.mode || "nextcloud-webdav") !== "nextcloud-webdav") {
            throw new Error("Unsupported BayernCloud mode. Use nextcloud-webdav.");
        }

        return await uploadFile(config, file);
    },
});
