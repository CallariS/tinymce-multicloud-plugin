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

/** URL of the MSAL Browser library (v2.38.0) loaded lazily at first use. */
const MSAL_SDK = "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js";
/** SRI hash for {@link MSAL_SDK}. Stable: the URL is version-pinned to 2.38.0. */
const MSAL_SDK_INTEGRITY = "sha384-mz+8Q3jA4XBFbnyAsyQegn/0LHvziH7qHLBa9GzcU3HzeWj9J16SXM5S+TsmPBy0";

/**
 * Represents a file or folder item returned by the Microsoft Graph Drive API.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/** Singleton MSAL `PublicClientApplication` instance, created on first use and reused thereafter. */
let msalInstance: any = null;

/**
 * Ensures the MSAL Browser SDK script is loaded and exposes `window.msal.PublicClientApplication`.
 *
 * @throws {Error} If the MSAL script fails to load or `window.msal.PublicClientApplication` is absent.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const ensureMsal = async (): Promise<void> => {
    if (msalInstance) return;

    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Loading MSAL from:", MSAL_SDK, "]");
    await loadScript(MSAL_SDK, {}, MSAL_SDK_INTEGRITY);

    if (!window.msal?.PublicClientApplication) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] MSAL library failed to load. ]");
    }
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] MSAL loaded successfully ]");
};

/**
 * Acquires a Microsoft Graph access token for OneDrive operations.
 *
 * On first call: initialises the MSAL `PublicClientApplication` with the given `clientId`,
 * sets `redirectUri` to the current page origin + pathname, and attempts silent token
 * acquisition if a cached account is present. Falls back to an interactive popup.
 *
 * @param clientId - Azure AD / Entra application (client) ID.
 * @returns A promise resolving to the raw access token string.
 * @throws {Error} If the MSAL SDK is unavailable or the interactive popup fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getAccessToken = async (clientId: string, redirectUri?: string): Promise<string> => {
    if (!msalInstance) {
        const resolvedRedirectUri = redirectUri ?? window.location.origin + window.location.pathname;
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Initializing MSAL with redirectUri:", resolvedRedirectUri, "]");

        msalInstance = new window.msal.PublicClientApplication({
            auth: {
                clientId: clientId,
                authority: "https://login.microsoftonline.com/common",
                redirectUri: resolvedRedirectUri,
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
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Got token silently ]");
            return response.accessToken;
        }
    } catch (err) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Silent token acquisition failed, will use popup ]");
    }

    // Fall back to popup
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Opening auth popup... ]");
    const response = await msalInstance.acquireTokenPopup({ scopes });
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Auth successful ]");
    return response.accessToken;
};

/**
 * Lists the children of a OneDrive folder via the Microsoft Graph API.
 *
 * @param accessToken - Bearer access token with at least `Files.Read` scope.
 * @param folderId - Graph item ID of the folder to list. Omit or pass `undefined` to list the drive root.
 * @returns A promise resolving to an array of {@link GraphDriveItem}.
 * @throws {Error} If the Graph API request fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const listFolderItems = async (accessToken: string, folderId?: string): Promise<GraphDriveItem[]> => {
    const endpoint = folderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
        : "https://graph.microsoft.com/v1.0/me/drive/root/children";

    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Fetching items from:", endpoint, "]");
    const response = await fetch(endpoint, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Graph API error:", response.status, errorText, "]");
        throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Graph API error: ${response.status} ${response.statusText} ]`);
    }

    const data = await response.json();
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] API returned:", data, "]");
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Items count:", data.value?.length || 0, "]");
    return data.value || [];
};

/**
 * Renders a custom overlay file-picker dialog that allows the user to navigate
 * the OneDrive folder tree and select a file.
 *
 * Folders are shown before files. Clicking a folder navigates into it (recursive call).
 * A breadcrumb shows the current path. A "Back" button is shown when not at the root.
 *
 * @param accessToken - Bearer access token used for listing folder contents.
 * @param currentPath - Breadcrumb path segments accumulated during navigation. Defaults to `[]` (root).
 * @param folderId - Graph item ID of the folder to list. `undefined` = drive root.
 * @returns A promise resolving to the selected {@link GraphDriveItem}, or `null` if the user cancelled.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Folders:", folders.length, "Files:", files.length, "]");

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

/**
 * Fetches the largest available thumbnail URL for a OneDrive item.
 *
 * Returns `null` rather than throwing if the thumbnail endpoint fails, so callers
 * can fall back gracefully (e.g. use `webUrl` instead).
 *
 * @param accessToken - Bearer access token with `Files.Read` scope.
 * @param itemId - Graph item ID of the file.
 * @returns A promise resolving to the thumbnail URL string, or `null` if unavailable.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getThumbnailUrl = async (accessToken: string, itemId: string): Promise<string | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Fetching thumbnail for item:", itemId, "]");
        const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/thumbnails`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Thumbnail fetch failed:", response.status, "]");
            return null;
        }

        const data = await response.json();
        // Get the largest thumbnail available (large > medium > small)
        const thumbnail = data.value?.[0];
        const largeUrl = thumbnail?.large?.url || thumbnail?.medium?.url || thumbnail?.small?.url;

        if (largeUrl) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Got thumbnail URL:", largeUrl, "]");
            return largeUrl;
        }

        return null;
    } catch (err) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Error fetching thumbnail:", err, "]");
        return null;
    }
};

/**
 * Creates an anonymous "embed" sharing link for a OneDrive item via the Graph `createLink` API
 * and extracts a stable embeddable URL from the response.
 *
 * For Office documents the `webHtml` in the response is parsed for an `<iframe src="...">` attribute.
 * `officeapps.live.com` URLs are used directly (CSP-friendly). `onedrive.live.com` URLs are
 * converted to an Office Online Viewer URL.
 *
 * Returns `null` rather than throwing on failure, allowing callers to fall back to link mode.
 *
 * @param accessToken - Bearer access token with `Files.ReadWrite` or `Files.ReadWrite.All` scope.
 * @param item - The {@link GraphDriveItem} to create a sharing link for.
 * @returns A promise resolving to the embed URL string, or `null` if unavailable.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getPublicEmbedUrl = async (accessToken: string, item: GraphDriveItem): Promise<string | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Creating public anonymous sharing link for:", item.name, "]");

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
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] createLink failed:", response.status, errorText, "]");
            return null;
        }

        const data = await response.json();
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Sharing link created:", data.link?.webUrl, "]");

        // Try to extract embeddable URL from the webHtml
        if (data.link?.webHtml) {
            // Microsoft provides embed HTML like: <iframe src="..." />
            const srcMatch = data.link.webHtml.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                const embedSrc = srcMatch[1];
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Extracted embed src:", embedSrc, "]");

                // If it's an officeapps.live.com URL, use it directly (CSP allows these)
                if (embedSrc.includes('officeapps.live.com')) {
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Found Office Apps embed URL (CSP-friendly) ]");
                    return embedSrc;
                }

                // If it's still onedrive.live.com, try to convert to Office Online Viewer
                if (embedSrc.includes('onedrive.live.com')) {
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Got onedrive.live.com URL, trying Office Online Viewer conversion... ]");
                    // Try using the sharing URL with Office Online Viewer
                    const shareUrl = data.link?.webUrl;
                    if (shareUrl) {
                        const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(shareUrl)}`;
                        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Converted to Office Online Viewer URL ]");
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
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Using Office Online Viewer with sharing URL ]");
            return viewerUrl;
        }

        console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Could not extract embeddable URL from sharing link ]");
        return null;
    } catch (err) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Error creating public embed URL:", err, "]");
        return null;
    }
};

/**
 * Creates an anonymous "view" sharing link for a OneDrive item and converts it into a
 * direct-download URL by appending `?download=1`.
 *
 * Returns `null` rather than throwing on failure.
 *
 * @param accessToken - Bearer access token with `Files.ReadWrite` or `Files.ReadWrite.All` scope.
 * @param item - The {@link GraphDriveItem} to create a download link for.
 * @returns A promise resolving to the download URL string, or `null` if unavailable.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getPublicDownloadUrl = async (accessToken: string, item: GraphDriveItem): Promise<string | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Creating public anonymous download link for:", item.name, "]");

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
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] createLink for download failed:", response.status, errorText, "]");
            return null;
        }

        const data = await response.json();
        const shareUrl = data.link?.webUrl;

        if (shareUrl) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Got public sharing URL:", shareUrl, "]");
            // Convert 1drv.ms short link to direct download URL
            // Add ?download=1 to force direct download
            const downloadUrl = shareUrl.replace('/view/', '/download/').replace('1drv.ms', 'onedrive.live.com');
            return downloadUrl + (downloadUrl.includes('?') ? '&download=1' : '?download=1');
        }

        console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Could not get public download URL ]");
        return null;
    } catch (err) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Error creating public download URL:", err, "]");
        return null;
    }
};

/**
 * Full SDK-mode pick flow for the OneDrive provider:
 * 1. Acquires an MSAL access token.
 * 2. Shows the navigable file picker overlay.
 * 3. Fetches an embeddable/thumbnail URL based on the selected file's MIME type.
 * 4. Assembles and returns a {@link PickerResult}.
 *
 * SVG files always use the permanent OneDrive viewer iframe (no raster choice dialog,
 * because OneDrive thumbnail URLs contain expiring auth tokens).
 * Audio/video files use the embed viewer for the same reason.
 *
 * @param config - OneDrive provider runtime configuration.
 * @returns A promise resolving to the {@link PickerResult}, or `null` if the user cancelled.
 * @throws {Error} If `clientId` is missing, MSAL fails, or the selected file has no usable URL.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const openOneDrivePicker = async (
    config: OneDriveProviderConfig,
): Promise<PickerResult | null> => {
    if (!config.clientId) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] OneDrive requires clientId. ]");
    }

    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Getting access token... ]");
    const accessToken = await getAccessToken(config.clientId, config.redirectUri);

    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Showing navigable file picker... ]");
    const selected = await showNavigablePicker(accessToken);

    if (!selected) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] User cancelled ]");
        return null;
    }

    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] User selected:", selected.name, "]");

    const validated = validateOneDriveFileBoundary(selected);
    const mimeType = validated.file?.mimeType || "";

    let url = validated.webUrl || validated["@microsoft.graph.downloadUrl"] || "";
    if (!url) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] OneDrive file does not have a usable URL. ]");
    }

    // For images, use the OneDrive embed viewer (iframe) instead of direct <img> embedding.
    // Cross-origin images served via the Shares API or download URLs are blocked for SVG,
    // and non-image MIME type responses break <img> for other formats too.
    // The embed viewer works reliably for all image types including SVG.
    // For SVGs: use the permanent 1drv.ms viewer iframe directly.
    // OneDrive has no stable public raster/thumbnail endpoint (all thumbnail URLs contain
    // expiring tempauth tokens), so the SVG choice dialog is not offered here.
    const isSvg = mimeType === "image/svg+xml" || /\.svg$/i.test(validated.name || "");
    if (isSvg) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Detected SVG, fetching permanent viewer URL... ]");
        const viewerUrl = await getPublicEmbedUrl(accessToken, validated);
        const svgResult: PickerResult = {
            item: {
                id: validated.id || validated.name,
                name: validated.name || validated.id,
                url: viewerUrl || validated.webUrl,
                mimeType: "image/svg+xml",
            },
            mode: viewerUrl ? "embed" as const : "link" as const,
        };
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Returning SVG result:", svgResult, "]");
        return svgResult;
    } else if (mimeType.startsWith("image/")) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Detected image, creating embed viewer URL... ]");
        const embedUrl = await getPublicEmbedUrl(accessToken, validated);
        if (embedUrl) {
            url = embedUrl;
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Using OneDrive embed viewer for image ]");
        } else {
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Could not get embed URL for image, using webUrl ]");
        }
    }
    // For documents/PDFs, try to get an embeddable public URL
    else if (mimeType === "application/pdf" ||
        mimeType.includes("word") ||
        mimeType.includes("excel") ||
        mimeType.includes("powerpoint") ||
        mimeType.includes("officedocument")) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Detected document, attempting to create embeddable URL... ]");
        const embedUrl = await getPublicEmbedUrl(accessToken, validated);
        if (embedUrl) {
            url = embedUrl;
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Got embeddable URL, will try to embed ]");
        } else {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Could not get embeddable URL, will insert as link ]");
        }
    }
    // For videos and audio, use the OneDrive embed viewer (iframe) instead of a direct
    // download URL. The @microsoft.graph.downloadUrl is a short-lived signed token that
    // expires within hours. A permanent anonymous sharing link (1drv.ms embed) is stable.
    else if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Detected media, creating permanent embed URL... ]");
        const embedUrl = await getPublicEmbedUrl(accessToken, validated);
        if (embedUrl) {
            url = embedUrl;
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Using OneDrive embed viewer for media ]");
        } else {
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Could not get embed URL for media, will insert as link ]");
        }
    }
    // Note: Archives are NOT embedded for OneDrive - inserted as links instead

    // Determine insert mode
    // Images and media: use embed (iframe via OneDrive viewer) since direct URLs are blocked or temporary
    const isMediaOrImage = mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");
    let insertMode = isMediaOrImage ? "embed" as const : detectInsertMode({
        id: validated.id || validated.name,
        name: validated.name || validated.id,
        url,
        mimeType: validated.file?.mimeType,
    });

    // If we tried to embed but still have the original webUrl (embed URL unavailable), fall back to link
    if (insertMode === "embed" && url === validated.webUrl) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Falling back to link mode (embed URL unavailable) ]");
        insertMode = "link";
    }

    const result: PickerResult = {
        item: {
            id: validated.id || validated.name,
            name: validated.name || validated.id,
            url,
            mimeType: validated.file?.mimeType,
        },
        mode: insertMode,
    };

    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Returning result:", result, "]");
    return result;
};

/**
 * Uploads a file to the authenticated user's OneDrive root via the Microsoft Graph API
 * (`PUT /me/drive/root:/{filename}:/content`) and derives an appropriate embeddable or
 * linkable URL based on the file's MIME type.
 *
 * URL strategy after upload:
 * - **SVG** — fetches a permanent anonymous embed viewer URL; falls back to `webUrl`.
 * - **Other images** — attempts {@link getThumbnailUrl}; uses `webUrl` if unavailable.
 * - **PDF / OOXML documents** — attempts {@link getPublicEmbedUrl} (Office Online Viewer).
 * - **Audio / video** — attempts {@link getPublicEmbedUrl} (permanent 1drv.ms iframe).
 * - **Archives / other** — `webUrl` (link mode).
 *
 * @param config - OneDrive provider runtime configuration (must include `clientId`).
 * @param file - The `File` object to upload.
 * @returns A promise resolving to the {@link PickerResult}, or `null` on cancellation.
 * @throws {Error} If the Graph API PUT request fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const uploadFile = async (
    config: OneDriveProviderConfig,
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Uploading file:", file.name, "]");

        const accessToken = await getAccessToken(config.clientId!, config.redirectUri);

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
            throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Upload failed: ${uploadResponse.status} ${errorText} ]`);
        }

        const uploadedItem: GraphDriveItem = await uploadResponse.json();
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] File uploaded successfully:", uploadedItem.name, "]");

        const mimeType = uploadedItem.file?.mimeType || file.type;
        let url = uploadedItem.webUrl;

        // For SVGs: fetch viewer URL (permanent embed) + thumbnail (raster fallback)
        // For SVGs: use the permanent 1drv.ms viewer iframe. No choice dialog since OneDrive
        // has no stable public raster URL (all thumbnails contain expiring tempauth tokens).
        const isUploadedSvg = mimeType === "image/svg+xml" || /\.svg$/i.test(file.name);
        if (isUploadedSvg) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Uploaded SVG, fetching permanent viewer URL... ]");
            const viewerUrl = await getPublicEmbedUrl(accessToken, uploadedItem);
            const svgResult: PickerResult = {
                item: {
                    id: uploadedItem.id,
                    name: uploadedItem.name,
                    url: viewerUrl || uploadedItem.webUrl,
                    mimeType: "image/svg+xml",
                },
                mode: viewerUrl ? "embed" as const : "link" as const,
            };
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Returning uploaded SVG result:", svgResult, "]");
            return svgResult;
        }
        // For non-SVG images, get thumbnail URL
        else if (mimeType.startsWith("image/")) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Fetching thumbnail for uploaded image... ]");
            const thumbnailUrl = await getThumbnailUrl(accessToken, uploadedItem.id);
            if (thumbnailUrl) {
                url = thumbnailUrl;
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Using thumbnail URL for uploaded image ]");
            }
        }
        // For documents, try to get embeddable URL
        else if (mimeType === "application/pdf" ||
            mimeType.includes("word") ||
            mimeType.includes("excel") ||
            mimeType.includes("powerpoint") ||
            mimeType.includes("officedocument")) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Creating embeddable URL for uploaded document... ]");
            const embedUrl = await getPublicEmbedUrl(accessToken, uploadedItem);
            if (embedUrl) {
                url = embedUrl;
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Got embeddable URL for uploaded document ]");
            }
        }
        // For videos and audio, use the OneDrive embed viewer (permanent 1drv.ms iframe)
        // instead of the short-lived @microsoft.graph.downloadUrl signed token
        else if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Creating permanent embed URL for uploaded media... ]");
            const embedUrl = await getPublicEmbedUrl(accessToken, uploadedItem);
            if (embedUrl) {
                url = embedUrl;
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Using OneDrive embed viewer for uploaded media ]");
            } else {
                console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Could not get embed URL for uploaded media, will insert as link ]");
            }
        }
        // Note: Archives are NOT embedded for OneDrive - inserted as links instead

        // Determine insert mode
        const isUploadedMediaOrImage = mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");
        let insertMode = isUploadedMediaOrImage ? "embed" as const : detectInsertMode({
            id: uploadedItem.id,
            name: uploadedItem.name,
            url,
            mimeType,
        });

        // If we tried to embed but still have the original webUrl, fall back to link
        if (insertMode === "embed" && url === uploadedItem.webUrl) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Falling back to link mode for uploaded file ]");
            insertMode = "link";
        }

        const result: PickerResult = {
            item: {
                id: uploadedItem.id,
                name: uploadedItem.name,
                url,
                mimeType,
            },
            mode: insertMode,
        };

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Returning upload result:", result, "]");
        return result;
    } catch (error) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Upload error:", error, "]");
        throw error;
    }
};

/**
 * Factory that creates the OneDrive {@link CloudProvider} instance.
 *
 * In SDK mode (`pickerUrl` absent), loads MSAL lazily on first use, then delegates
 * picking to {@link openOneDrivePicker} and uploading to {@link uploadFile}.
 *
 * In mock/popup mode (`pickerUrl` present), delegates pick operations to a custom
 * popup URL via {@link createPopupProvider}.
 *
 * @returns A fully-configured {@link CloudProvider} with `id: "oneDrive"`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const oneDriveProvider = (): CloudProvider => ({
    id: "oneDrive",
    label: "OneDrive",
    pick: async (context) => {
        const config = context.providerConfig as OneDriveProviderConfig;

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] pick() called with config:", config, "]");

        if (config.pickerUrl) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Using mock picker from:", config.pickerUrl, "]");
            return await createPopupProvider("oneDrive", "OneDrive", "/pickers/onedrive.html").pick(context);
        }

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] Loading MSAL library... ]");
        await ensureMsal();
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] MSAL loaded, starting picker flow... ]");
        return await openOneDrivePicker(config);
    },
    upload: async (context, file) => {
        const config = context.providerConfig as OneDriveProviderConfig;

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / OneDrive ] upload() called for file:", file.name, "]");

        await ensureMsal();
        return await uploadFile(config, file);
    },
});
