import type {
    BayernCloudNextcloudProviderConfig,
    CloudItem,
    CloudProvider,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { basicAuthHeader, combineUrl, detectInsertMode, toAbsoluteUrl } from "./utils";

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

        nodes.push({
            id: hrefPath,
            name,
            url: hrefAbsolute,
            mimeType: contentTypeNode?.textContent || (isDirectory ? "inode/directory" : undefined),
            type: isDirectory ? "folder" : "file",
            isDirectory,
            webdavPath: hrefPath,
        });
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
        const targetUrl = shareUrl || selected.url;

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
});
