import type {
    CloudProvider,
    OneDriveProviderConfig,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { detectInsertMode, loadScript } from "./utils";
import { validateOneDriveFileBoundary } from "../validation/boundary";

declare global {
    interface Window {
        msal: any;
    }
}

const MSAL_SDK = "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js";

interface GraphDriveItem {
    id: string;
    name: string;
    webUrl: string;
    "@microsoft.graph.downloadUrl"?: string;
    file?: {
        mimeType: string;
    };
    folder?: any;
}

let msalInstance: any = null;

const ensureMsal = async (): Promise<void> => {
    if (msalInstance) return;

    console.log("[OneDrive] Loading MSAL from:", MSAL_SDK);
    await loadScript(MSAL_SDK);

    if (!window.msal?.PublicClientApplication) {
        throw new Error("MSAL library failed to load");
    }
    console.log("[OneDrive] MSAL loaded successfully");
};

const getAccessToken = async (clientId: string): Promise<string> => {
    if (!msalInstance) {
        const redirectUri = window.location.origin + window.location.pathname;
        console.log("[OneDrive] Initializing MSAL with redirectUri:", redirectUri);

        msalInstance = new window.msal.PublicClientApplication({
            auth: {
                clientId: clientId,
                authority: "https://login.microsoftonline.com/common",
                redirectUri: redirectUri,
            },
            cache: {
                cacheLocation: "localStorage",
            },
        });
        await msalInstance.initialize();
    }

    const scopes = ["Files.Read", "Files.Read.All", "Files.ReadWrite.All"];

    try {
        // Try silent token acquisition first
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            const response = await msalInstance.acquireTokenSilent({
                scopes,
                account: accounts[0],
            });
            console.log("[OneDrive] Got token silently");
            return response.accessToken;
        }
    } catch (err) {
        console.log("[OneDrive] Silent token acquisition failed, will use popup");
    }

    // Fall back to popup
    console.log("[OneDrive] Opening auth popup...");
    const response = await msalInstance.acquireTokenPopup({ scopes });
    console.log("[OneDrive] Auth successful");
    return response.accessToken;
};

const listFolderItems = async (accessToken: string, folderId?: string): Promise<GraphDriveItem[]> => {
    const endpoint = folderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
        : "https://graph.microsoft.com/v1.0/me/drive/root/children";

    console.log("[OneDrive] Fetching items from:", endpoint);
    const response = await fetch(endpoint, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[OneDrive] Graph API error:", response.status, errorText);
        throw new Error(`Graph API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("[OneDrive] API returned:", data);
    console.log("[OneDrive] Items count:", data.value?.length || 0);
    return data.value || [];
};

const showNavigablePicker = async (
    accessToken: string,
    currentPath: string[] = [],
    folderId?: string
): Promise<GraphDriveItem | null> => {
    const items = await listFolderItems(accessToken, folderId);

    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100000;
        `;

        const dialog = document.createElement("div");
        dialog.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 24px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const title = document.createElement("h2");
        title.textContent = "Select from OneDrive";
        title.style.cssText = "margin: 0 0 8px 0; font-size: 20px; font-weight: 600;";

        // Breadcrumb
        const breadcrumb = document.createElement("div");
        breadcrumb.style.cssText = "margin-bottom: 12px; font-size: 14px; color: #666;";
        breadcrumb.textContent = currentPath.length > 0 ? currentPath.join(" / ") : "Root";

        const listContainer = document.createElement("div");
        listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 16px;
        `;

        const fileList = document.createElement("ul");
        fileList.style.cssText = "list-style: none; padding: 0; margin: 0;";

        const folders = items.filter(item => item.folder);
        const files = items.filter(item => item.file);

        console.log("[OneDrive] Folders:", folders.length, "Files:", files.length);

        // Show folders first
        folders.forEach(folder => {
            const li = document.createElement("li");
            li.style.cssText = `
                padding: 12px;
                border-bottom: 1px solid #eee;
                cursor: pointer;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const icon = document.createElement("span");
            icon.textContent = "📁";
            icon.style.cssText = "font-size: 18px;";

            const name = document.createElement("span");
            name.textContent = folder.name;
            name.style.cssText = "font-weight: 500;";

            li.appendChild(icon);
            li.appendChild(name);

            li.addEventListener("mouseenter", () => li.style.background = "#f5f5f5");
            li.addEventListener("mouseleave", () => li.style.background = "white");

            li.addEventListener("click", async () => {
                document.body.removeChild(overlay);
                const newPath = [...currentPath, folder.name];
                const result = await showNavigablePicker(accessToken, newPath, folder.id);
                resolve(result);
            });

            fileList.appendChild(li);
        });

        // Show files
        files.forEach(file => {
            const li = document.createElement("li");
            li.style.cssText = `
                padding: 12px;
                border-bottom: 1px solid #eee;
                cursor: pointer;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const icon = document.createElement("span");
            icon.textContent = "📄";
            icon.style.cssText = "font-size: 18px;";

            const name = document.createElement("span");
            name.textContent = file.name;

            li.appendChild(icon);
            li.appendChild(name);

            li.addEventListener("mouseenter", () => li.style.background = "#f5f5f5");
            li.addEventListener("mouseleave", () => li.style.background = "white");

            li.addEventListener("click", () => {
                document.body.removeChild(overlay);
                resolve(file);
            });

            fileList.appendChild(li);
        });

        if (folders.length === 0 && files.length === 0) {
            const emptyMsg = document.createElement("li");
            emptyMsg.textContent = "This folder is empty";
            emptyMsg.style.cssText = "padding: 20px; text-align: center; color: #666;";
            fileList.appendChild(emptyMsg);
        }

        listContainer.appendChild(fileList);

        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = "display: flex; justify-content: space-between; gap: 8px;";

        const leftButtons = document.createElement("div");
        leftButtons.style.cssText = "display: flex; gap: 8px;";

        // Back button (if not at root)
        if (currentPath.length > 0) {
            const backBtn = document.createElement("button");
            backBtn.textContent = "← Back";
            backBtn.style.cssText = `
                padding: 8px 16px;
                border: 1px solid #ddd;
                border-radius: 4px;
                background: white;
                cursor: pointer;
                font-size: 14px;
            `;
            backBtn.addEventListener("click", async () => {
                document.body.removeChild(overlay);
                const newPath = currentPath.slice(0, -1);
                // Need to get parent folder ID - for now, restart from root
                const result = await showNavigablePicker(accessToken, []);
                resolve(result);
            });
            leftButtons.appendChild(backBtn);
        }

        const rightButtons = document.createElement("div");
        rightButtons.style.cssText = "display: flex; gap: 8px;";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            font-size: 14px;
        `;
        cancelBtn.addEventListener("click", () => {
            document.body.removeChild(overlay);
            resolve(null);
        });

        rightButtons.appendChild(cancelBtn);
        buttonContainer.appendChild(leftButtons);
        buttonContainer.appendChild(rightButtons);

        dialog.appendChild(title);
        dialog.appendChild(breadcrumb);
        dialog.appendChild(listContainer);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);

        document.body.appendChild(overlay);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });
    });
};

const getThumbnailUrl = async (accessToken: string, itemId: string): Promise<string | null> => {
    try {
        console.log("[OneDrive] Fetching thumbnail for item:", itemId);
        const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/thumbnails`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            console.warn("[OneDrive] Thumbnail fetch failed:", response.status);
            return null;
        }

        const data = await response.json();
        // Get the largest thumbnail available (large > medium > small)
        const thumbnail = data.value?.[0];
        const largeUrl = thumbnail?.large?.url || thumbnail?.medium?.url || thumbnail?.small?.url;

        if (largeUrl) {
            console.log("[OneDrive] Got thumbnail URL:", largeUrl);
            return largeUrl;
        }

        return null;
    } catch (err) {
        console.error("[OneDrive] Error fetching thumbnail:", err);
        return null;
    }
};

const getPublicEmbedUrl = async (accessToken: string, item: GraphDriveItem): Promise<string | null> => {
    try {
        console.log("[OneDrive] Creating public anonymous sharing link for:", item.name);

        // Create an anonymous sharing link
        const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/createLink`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    type: "embed",
                    scope: "anonymous",
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.warn("[OneDrive] createLink failed:", response.status, errorText);
            return null;
        }

        const data = await response.json();
        console.log("[OneDrive] Sharing link created:", data.link?.webUrl);

        // Try to extract embeddable URL from the webHtml
        if (data.link?.webHtml) {
            // Microsoft provides embed HTML like: <iframe src="..." />
            const srcMatch = data.link.webHtml.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                const embedSrc = srcMatch[1];
                console.log("[OneDrive] Extracted embed src:", embedSrc);

                // If it's an officeapps.live.com URL, use it directly (CSP allows these)
                if (embedSrc.includes('officeapps.live.com')) {
                    console.log("[OneDrive] Found Office Apps embed URL (CSP-friendly)");
                    return embedSrc;
                }

                // If it's still onedrive.live.com, try to convert to Office Online Viewer
                if (embedSrc.includes('onedrive.live.com')) {
                    console.log("[OneDrive] Got onedrive.live.com URL, trying Office Online Viewer conversion...");
                    // Try using the sharing URL with Office Online Viewer
                    const shareUrl = data.link?.webUrl;
                    if (shareUrl) {
                        const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(shareUrl)}`;
                        console.log("[OneDrive] Converted to Office Online Viewer URL");
                        return viewerUrl;
                    }
                }

                return embedSrc;
            }
        }

        // Fallback: try Office Online Viewer with the sharing URL
        if (data.link?.webUrl) {
            const shareUrl = data.link.webUrl;
            const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(shareUrl)}`;
            console.log("[OneDrive] Using Office Online Viewer with sharing URL");
            return viewerUrl;
        }

        console.warn("[OneDrive] Could not extract embeddable URL from sharing link");
        return null;
    } catch (err) {
        console.error("[OneDrive] Error creating public embed URL:", err);
        return null;
    }
};

const getPublicDownloadUrl = async (accessToken: string, item: GraphDriveItem): Promise<string | null> => {
    try {
        console.log("[OneDrive] Creating public anonymous download link for:", item.name);

        // Create an anonymous view link (download link type doesn't work for archives)
        const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/createLink`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    type: "view",
                    scope: "anonymous",
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.warn("[OneDrive] createLink for download failed:", response.status, errorText);
            return null;
        }

        const data = await response.json();
        const shareUrl = data.link?.webUrl;

        if (shareUrl) {
            console.log("[OneDrive] Got public sharing URL:", shareUrl);
            // Convert 1drv.ms short link to direct download URL
            // Add ?download=1 to force direct download
            const downloadUrl = shareUrl.replace('/view/', '/download/').replace('1drv.ms', 'onedrive.live.com');
            return downloadUrl + (downloadUrl.includes('?') ? '&download=1' : '?download=1');
        }

        console.warn("[OneDrive] Could not get public download URL");
        return null;
    } catch (err) {
        console.error("[OneDrive] Error creating public download URL:", err);
        return null;
    }
};

const openOneDrivePicker = async (
    config: OneDriveProviderConfig,
): Promise<PickerResult | null> => {
    if (!config.clientId) {
        throw new Error("OneDrive requires clientId.");
    }

    console.log("[OneDrive] Getting access token...");
    const accessToken = await getAccessToken(config.clientId);

    console.log("[OneDrive] Showing navigable file picker...");
    const selected = await showNavigablePicker(accessToken);

    if (!selected) {
        console.log("[OneDrive] User cancelled");
        return null;
    }

    console.log("[OneDrive] User selected:", selected.name);

    const validated = validateOneDriveFileBoundary(selected);
    const mimeType = validated.file?.mimeType || "";

    let url = validated.webUrl || validated["@microsoft.graph.downloadUrl"] || "";
    if (!url) {
        throw new Error("OneDrive file does not have a usable URL.");
    }

    // For images, create a permanent public share link instead of the expiring thumbnail URL
    if (mimeType.startsWith("image/")) {
        console.log("[OneDrive] Detected image, creating public share link...");
        const shareUrl = await getPublicDownloadUrl(accessToken, validated);
        if (shareUrl) {
            url = shareUrl;
            console.log("[OneDrive] Using public share URL for image");
        } else {
            console.warn("[OneDrive] Could not get public share URL, falling back to webUrl");
        }
    }
    // For documents/PDFs, try to get an embeddable public URL
    else if (mimeType === "application/pdf" ||
        mimeType.includes("word") ||
        mimeType.includes("excel") ||
        mimeType.includes("powerpoint") ||
        mimeType.includes("officedocument")) {
        console.log("[OneDrive] Detected document, attempting to create embeddable URL...");
        const embedUrl = await getPublicEmbedUrl(accessToken, validated);
        if (embedUrl) {
            url = embedUrl;
            console.log("[OneDrive] Got embeddable URL, will try to embed");
        } else {
            console.log("[OneDrive] Could not get embeddable URL, will insert as link");
        }
    }
    // For videos, use the direct download URL for streaming in a <video> tag
    else if (mimeType.startsWith("video/")) {
        const directUrl = validated["@microsoft.graph.downloadUrl"];
        if (directUrl) {
            url = directUrl;
            console.log("[OneDrive] Using direct download URL for video streaming");
        } else {
            console.warn("[OneDrive] No direct download URL for video, will insert as link");
        }
    }
    // Note: Archives are NOT embedded for OneDrive - inserted as links instead

    // Determine insert mode
    let insertMode = detectInsertMode({
        id: validated.id || validated.name,
        name: validated.name || validated.id,
        url,
        mimeType: validated.file?.mimeType,
    });

    // If we tried to embed a document but still have the original webUrl, fall back to link
    if (insertMode === "embed" &&
        url === validated.webUrl &&
        !mimeType.startsWith("image/")) {
        console.log("[OneDrive] Falling back to link mode (embed URL unavailable)");
        insertMode = "link";
    }

    const result: PickerResult = {
        item: {
            id: validated.id || validated.name,
            name: validated.name || validated.id,
            url,
            mimeType: validated.file?.mimeType,
            downloadUrl: validated["@microsoft.graph.downloadUrl"],
        },
        mode: insertMode,
    };

    console.log("[OneDrive] Returning result:", result);
    return result;
};

const uploadFile = async (
    config: OneDriveProviderConfig,
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.log("[OneDrive] Uploading file:", file.name);

        const accessToken = await getAccessToken(config.clientId!);

        // Upload the file using Microsoft Graph API
        // PUT /me/drive/root:/{filename}:/content
        const encodedFilename = encodeURIComponent(file.name);
        const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedFilename}:/content`;

        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Upload failed: ${uploadResponse.status} ${errorText}`);
        }

        const uploadedItem: GraphDriveItem = await uploadResponse.json();
        console.log("[OneDrive] File uploaded successfully:", uploadedItem.name);

        const mimeType = uploadedItem.file?.mimeType || file.type;
        let url = uploadedItem.webUrl;

        // For images, get thumbnail URL
        if (mimeType.startsWith("image/")) {
            console.log("[OneDrive] Fetching thumbnail for uploaded image...");
            const thumbnailUrl = await getThumbnailUrl(accessToken, uploadedItem.id);
            if (thumbnailUrl) {
                url = thumbnailUrl;
                console.log("[OneDrive] Using thumbnail URL for uploaded image");
            }
        }
        // For documents, try to get embeddable URL
        else if (mimeType === "application/pdf" ||
            mimeType.includes("word") ||
            mimeType.includes("excel") ||
            mimeType.includes("powerpoint") ||
            mimeType.includes("officedocument")) {
            console.log("[OneDrive] Creating embeddable URL for uploaded document...");
            const embedUrl = await getPublicEmbedUrl(accessToken, uploadedItem);
            if (embedUrl) {
                url = embedUrl;
                console.log("[OneDrive] Got embeddable URL for uploaded document");
            }
        }
        // For videos, use the direct download URL for streaming in a <video> tag
        else if (mimeType.startsWith("video/")) {
            const directUrl = uploadedItem["@microsoft.graph.downloadUrl"];
            if (directUrl) {
                url = directUrl;
                console.log("[OneDrive] Using direct download URL for uploaded video streaming");
            } else {
                console.warn("[OneDrive] No direct download URL for uploaded video, will insert as link");
            }
        }
        // Note: Archives are NOT embedded for OneDrive - inserted as links instead

        // Determine insert mode
        let insertMode = detectInsertMode({
            id: uploadedItem.id,
            name: uploadedItem.name,
            url,
            mimeType,
        });

        // If we tried to embed but still have the original webUrl, fall back to link
        if (insertMode === "embed" &&
            url === uploadedItem.webUrl &&
            !mimeType.startsWith("image/")) {
            console.log("[OneDrive] Falling back to link mode for uploaded document");
            insertMode = "link";
        }

        const result: PickerResult = {
            item: {
                id: uploadedItem.id,
                name: uploadedItem.name,
                url,
                mimeType,
                downloadUrl: uploadedItem["@microsoft.graph.downloadUrl"],
            },
            mode: insertMode,
        };

        console.log("[OneDrive] Returning upload result:", result);
        return result;
    } catch (error) {
        console.error("[OneDrive] Upload error:", error);
        throw error;
    }
};

export const oneDriveProvider = (): CloudProvider => ({
    id: "oneDrive",
    label: "OneDrive",
    pick: async (context) => {
        const config = context.providerConfig as OneDriveProviderConfig;

        console.log("[OneDrive] pick() called with config:", config);

        if (config.pickerUrl) {
            console.log("[OneDrive] Using mock picker from:", config.pickerUrl);
            return await createPopupProvider("oneDrive", "OneDrive", "/pickers/onedrive.html").pick(context);
        }

        console.log("[OneDrive] Loading MSAL library...");
        await ensureMsal();
        console.log("[OneDrive] MSAL loaded, starting picker flow...");
        return await openOneDrivePicker(config);
    },
    upload: async (context, file) => {
        const config = context.providerConfig as OneDriveProviderConfig;

        console.log("[OneDrive] upload() called for file:", file.name);

        await ensureMsal();
        return await uploadFile(config, file);
    },
});
