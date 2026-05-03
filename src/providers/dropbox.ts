import type {
    CloudProvider,
    DropboxProviderConfig,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { detectInsertMode, loadScript } from "./utils";
import { validateDropboxFileBoundary } from "../validation/boundary";

declare global {
    interface Window {
        Dropbox: any;
    }
}

/** URL of the Dropbox Chooser SDK (Dropins). Loaded lazily at first use. */
const DROPBOX_DROPINS = "https://www.dropbox.com/static/api/2/dropins.js";
/** Dropbox OAuth 2.0 implicit-grant authorisation endpoint. */
const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
/** Dropbox Content API upload endpoint. */
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
/** Dropbox API endpoint for creating shared links. */
const DROPBOX_SHARING_URL = "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings";

/** In-memory cache of the Dropbox OAuth access token for the current page session. */
let cachedAccessToken: string | null = null;

/**
 * Clears the in-memory and `localStorage`-persisted Dropbox access token.
 * Called whenever a token is detected to be expired or rejected by the API.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const clearDropboxToken = () => {
    cachedAccessToken = null;
    localStorage.removeItem('dropbox_access_token');
    localStorage.removeItem('dropbox_token_expiry');
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Access token cleared (expired or invalid) ]");
};

/**
 * Ensures the Dropbox Chooser SDK (Dropins) script is loaded.
 *
 * @param appKey - Dropbox application key, passed as `data-app-key` on the script element.
 * @throws {Error} If `appKey` is empty.
 * @throws {Error} If the SDK script fails to load or `window.Dropbox.choose` is absent.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const ensureDropboxSdk = async (appKey: string): Promise<void> => {
    if (!appKey) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Dropbox requires appKey. ]");
    }

    await loadScript(DROPBOX_DROPINS, { "data-app-key": appKey, id: "dropboxjs" });

    if (!window.Dropbox?.choose) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Dropbox chooser SDK is unavailable. ]");
    }
};

/**
 * Opens the Dropbox Chooser dialog and resolves with the selected file's result.
 *
 * Converts the returned `www.dropbox.com/scl/fi/...` preview link to a raw-content URL
 * by appending `raw=1` so that browsers can fetch file bytes directly (images, PDFs, etc.).
 *
 * Embed URL resolution:
 * - SVG — raw URL used directly in an `<iframe>` (browsers render SVG natively at full vector quality).
 * - PDF — raw URL opened natively in the browser `<iframe>` renderer.
 * - OOXML Office docs — wrapped in an `https://view.officeapps.live.com/op/embed.aspx?src=...` URL.
 * - ODF and archives — inserted as links only (no viewer support).
 *
 * @param config - Dropbox provider runtime configuration (`linkType`, `multiselect`, `extensions`, `timeoutMs`).
 * @returns A promise resolving to the {@link PickerResult}, or `null` if the user cancelled.
 * @throws {Error} If the Chooser does not return a result within `config.timeoutMs` (default 180 s).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const openDropboxChooser = async (
    config: DropboxProviderConfig,
): Promise<PickerResult | null> =>
    new Promise((resolve, reject) => {
        const timeoutRef = window.setTimeout(() => {
            reject(new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Dropbox chooser did not return a selection. ]"));
        }, config.timeoutMs || 180000);

        const clear = () => window.clearTimeout(timeoutRef);

        window.Dropbox.choose({
            linkType: config.linkType || "preview",  // Use 'preview' for persistent www.dropbox.com/scl/fi/... links; raw=1 is appended below for direct content access
            multiselect: config.multiselect || false,
            extensions: config.extensions || [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"],
            success: (files: any[]) => {
                const first = files?.[0];
                if (!first?.link) {
                    clear();
                    resolve(null);
                    return;
                }

                const validated = validateDropboxFileBoundary(first);

                // Convert URL to raw content for embeddable files (images, PDFs, Office docs, archives)
                let fileUrl = validated.link;
                const fileName = validated.name || "";
                const isSvg = /\.svg$/i.test(fileName);
                const isImage = !isSvg && /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName);
                const isPdf = /\.pdf$/i.test(fileName);
                const isOfficeDoc = /\.(docx?|xlsx?|pptx?)$/i.test(fileName); // OOXML only — embeddable via Office Online
                const isOdf = /\.(odt|ods|odp)$/i.test(fileName); // OpenDocument — not supported by Office Online viewer
                const isArchive = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(fileName);
                const isAudio = /\.(mp3|wav|ogg|aac|m4a|flac|opus|oga|weba)$/i.test(fileName);
                const isVideo = /\.(mp4|webm|ogg|mov|m4v|avi|wmv|flv|mkv)$/i.test(fileName);

                if ((isImage || isSvg || isPdf || isOfficeDoc || isAudio || isVideo) && fileUrl.includes("dropbox.com")) {
                    // Add raw=1 so Dropbox serves file content directly instead of a preview/download page.
                    // Do NOT swap the domain to dl.dropboxusercontent.com — newer scl/fi/... links with
                    // rlkey params return 403 on that CDN domain.
                    if (/[?&]dl=[01]/.test(fileUrl)) {
                        fileUrl = fileUrl.replace(/([?&])dl=[01]/, "$1raw=1");
                    } else {
                        fileUrl += (fileUrl.includes("?") ? "&" : "?") + "raw=1";
                    }
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Converted to raw content URL:", fileUrl, "]");
                }

                // Use appropriate viewer for documents (Dropbox forces download with raw URLs)
                // Note: Archives and ODF files are NOT embedded - inserted as links instead.
                // ODF (odt/ods/odp) files cannot be embedded from Dropbox: Google Docs Viewer does
                // not support ODF served from Dropbox's CDN and returns raw XML instead.
                // SVG files use the raw URL directly as embedUrl — browsers render SVG natively
                // in an iframe at full vector quality. Google Docs Viewer does not support SVG.
                let embedUrl: string | undefined;
                if (isSvg) {
                    embedUrl = fileUrl; // raw=1 URL; browser renders as vector SVG in iframe
                } else if (isPdf) {
                    embedUrl = fileUrl; // raw=1 URL; browser renders PDF natively in iframe
                } else if (isOfficeDoc) {
                    embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
                }

                const result: PickerResult = {
                    item: {
                        id: validated.id || validated.name || "dropbox-file",
                        name: validated.name || "Dropbox file",
                        url: fileUrl,
                        embedUrl,
                        downloadUrl: (isAudio || isVideo) ? fileUrl : undefined,
                        thumbnailUrl: validated.thumbnailLink,
                        mimeType: isSvg ? "image/svg+xml" : undefined,
                    },
                    mode: (isArchive || isOdf) ? "link" : isSvg ? "embed" : detectInsertMode({
                        id: validated.id || validated.name || "dropbox-file",
                        name: validated.name || "Dropbox file",
                        url: fileUrl,
                    }),
                };

                clear();
                resolve(result);
            },
            cancel: () => {
                clear();
                resolve(null);
            },
        });
    });

/**
 * Acquires a Dropbox OAuth 2.0 access token using the implicit-grant flow.
 *
 * Token resolution order:
 * 1. In-memory `cachedAccessToken`.
 * 2. `localStorage` key `"dropbox_access_token"`.
 * 3. Interactive OAuth popup pointing to `DROPBOX_AUTH_URL`.
 *
 * The popup communicates the token back via `postMessage` (`type: "dropbox_oauth_token"`)
 * or by writing it to `localStorage` during the redirect callback. The token is then
 * cached in memory and in `localStorage` for subsequent calls.
 *
 * @param appKey - Dropbox application key used as `client_id` in the OAuth request.
 * @returns A promise resolving to the raw access token string.
 * @throws {Error} If the auth popup is blocked or the user closes it without authorising.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getAccessToken = async (appKey: string): Promise<string> => {
    // Check if we already have a token in cache or localStorage
    if (cachedAccessToken) {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Using cached access token ]");
        return cachedAccessToken;
    }

    // Check localStorage for persisted token
    const storedToken = localStorage.getItem('dropbox_access_token');
    if (storedToken) {
        const storedExpiry = localStorage.getItem('dropbox_token_expiry');
        if (storedExpiry && Date.now() >= parseInt(storedExpiry, 10)) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Stored token is expired, clearing... ]");
            clearDropboxToken();
        } else {
            cachedAccessToken = storedToken;
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Using stored access token ]");
            return cachedAccessToken;
        }
    }

    // Start OAuth flow
    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Starting OAuth flow... ]");
    const redirectUri = window.location.origin + window.location.pathname;
    const scopes = "files.metadata.read files.content.read files.content.write sharing.write";
    const authUrl = `${DROPBOX_AUTH_URL}?client_id=${appKey}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;

    // Open auth popup
    const popup = window.open(authUrl, "Dropbox Auth", "width=600,height=700,scrollbars=yes");

    if (!popup) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Failed to open Dropbox auth popup. Please allow popups for this site. ]");
    }

    // Wait for OAuth callback via postMessage or by checking URL after redirect
    return new Promise((resolve, reject) => {
        let resolved = false;

        // Listen for postMessage from popup
        const messageHandler = (event: MessageEvent) => {
            // Check origin for security
            if (event.origin !== window.location.origin) {
                return;
            }

            if (event.data && event.data.type === 'dropbox_oauth_token') {
                if (!resolved) {
                    resolved = true;
                    cachedAccessToken = event.data.token;
                    localStorage.setItem('dropbox_access_token', cachedAccessToken);
                    if (event.data.expiresIn) {
                        localStorage.setItem('dropbox_token_expiry', String(Date.now() + event.data.expiresIn * 1000));
                    }
                    window.removeEventListener('message', messageHandler);
                    popup.close();
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] OAuth successful via postMessage ]");
                    resolve(cachedAccessToken);
                }
            }
        };

        window.addEventListener('message', messageHandler);

        // Also check popup URL periodically (fallback)
        const checkInterval = setInterval(() => {
            try {
                if (popup.closed) {
                    if (!resolved) {
                        resolved = true;
                        clearInterval(checkInterval);
                        window.removeEventListener('message', messageHandler);

                        // Check if token was stored during redirect
                        const storedToken = localStorage.getItem('dropbox_access_token');
                        if (storedToken) {
                            cachedAccessToken = storedToken;
                            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] OAuth successful (token found in localStorage) ]");
                            resolve(cachedAccessToken);
                        } else {
                            reject(new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Dropbox auth popup was closed without authorization. ]"));
                        }
                    }
                    return;
                }

                // Try to check if popup has been redirected back to our domain
                try {
                    if (popup.location.href.startsWith(window.location.origin)) {
                        const popupHash = popup.location.hash;
                        if (popupHash && popupHash.includes("access_token=")) {
                            const match = popupHash.match(/access_token=([^&]+)/);
                            const expiryMatch = popupHash.match(/expires_in=(\d+)/);
                            if (match && match[1] && !resolved) {
                                resolved = true;
                                cachedAccessToken = match[1];
                                localStorage.setItem('dropbox_access_token', cachedAccessToken);
                                if (expiryMatch && expiryMatch[1]) {
                                    localStorage.setItem('dropbox_token_expiry', String(Date.now() + parseInt(expiryMatch[1], 10) * 1000));
                                }
                                clearInterval(checkInterval);
                                window.removeEventListener('message', messageHandler);
                                popup.close();
                                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] OAuth successful (token from popup URL) ]");
                                resolve(cachedAccessToken);
                            }
                        }
                    }
                } catch (e) {
                    // Cross-origin error, popup still on dropbox.com - this is expected
                }
            } catch (e) {
                // Ignore errors
            }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                clearInterval(checkInterval);
                window.removeEventListener('message', messageHandler);
                if (!popup.closed) {
                    popup.close();
                }
                reject(new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Dropbox auth timeout. ]"));
            }
        }, 300000);
    });
};

/**
 * Uploads a file to the authenticated user's Dropbox root via the Dropbox Content API
 * and creates a publicly accessible shared link.
 *
 * After uploading the file to `/<filename>` the function calls the sharing API to create
 * a `viewer`-role public shared link, then converts the resulting `www.dropbox.com` URL
 * to a raw-content URL (`raw=1`) so browser assets can be fetched directly.
 * If the shared link already exists (HTTP 409 conflict) the existing URL is reused.
 *
 * The {@link detectInsertMode} utility is used to derive the appropriate insert mode
 * from the file's MIME type and name.
 *
 * @param config - Dropbox provider runtime configuration (must include a valid `appKey`).
 * @param file - The `File` object to upload.
 * @returns A promise resolving to the {@link PickerResult}, or `null` on cancellation.
 * @throws {Error} If the upload or sharing API call fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const uploadFile = async (
    config: DropboxProviderConfig,
    file: File,
    _retried = false,
): Promise<PickerResult | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Uploading file:", file.name, "]");

        const accessToken = await getAccessToken(config.appKey);

        // Upload file to Dropbox
        const uploadPath = `/${file.name}`;
        const uploadResponse = await fetch(DROPBOX_UPLOAD_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/octet-stream",
                "Dropbox-API-Arg": JSON.stringify({
                    path: uploadPath,
                    mode: "add",
                    autorename: true,
                    mute: false,
                }),
            },
            body: file,
        });

        if (uploadResponse.status === 401) {
            // Token expired — clear it and retry once with a fresh token
            clearDropboxToken();
            if (!_retried) {
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Upload 401 - token expired, re-authenticating and retrying... ]");
                return uploadFile(config, file, true);
            }
            throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Dropbox authentication failed after re-authentication attempt. ]");
        }

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Upload failed: ${uploadResponse.status} ${errorText} ]`);
        }

        const uploadData = await uploadResponse.json();
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] File uploaded successfully:", uploadData.name, "]");

        // Create a shared link for the file
        let sharedUrl = "";
        try {
            const sharingResponse = await fetch(DROPBOX_SHARING_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    path: uploadData.path_display,
                    settings: {
                        requested_visibility: "public",
                    },
                }),
            });

            if (sharingResponse.ok) {
                const sharingData = await sharingResponse.json();
                const baseUrl = sharingData.url;

                // Office document MIME types
                const officeTypes = [
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
                    "application/msword", // .doc
                    "application/vnd.ms-excel", // .xls
                    "application/vnd.ms-powerpoint", // .ppt
                ];
                const archiveTypes = [
                    "application/zip",
                    "application/x-zip-compressed",
                    "application/x-rar-compressed",
                    "application/x-7z-compressed",
                    "application/x-tar",
                    "application/gzip",
                    "application/x-gzip",
                ];

                // For images, PDFs, Office docs, ODF docs, and archives, convert to raw content URL for proper embedding
                const odfTypes = [
                    "application/vnd.oasis.opendocument.text",
                    "application/vnd.oasis.opendocument.spreadsheet",
                    "application/vnd.oasis.opendocument.presentation",
                ];
                if (file.type.startsWith("image/") || file.type === "application/pdf" || officeTypes.includes(file.type) || archiveTypes.includes(file.type) || odfTypes.includes(file.type)) {
                    // Convert www.dropbox.com to dl.dropboxusercontent.com and add ?raw=1
                    sharedUrl = baseUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[?&]dl=[01]/g, (m) => m[0] + "raw=1");
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Created raw content URL:", sharedUrl, "]");
                } else {
                    // For other files, use direct download link
                    sharedUrl = baseUrl.replace("?dl=0", "?dl=1");
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Created direct download link:", sharedUrl, "]");
                }
            } else {
                const errorText = await sharingResponse.text();
                console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Failed to create shared link:", sharingResponse.status, errorText, "]");

                // Check if link already exists
                if (errorText.includes("shared_link_already_exists")) {
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Shared link already exists, trying to get existing link... ]");
                    try {
                        const getLinksResponse = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                path: uploadData.path_display,
                            }),
                        });

                        if (getLinksResponse.ok) {
                            const linksData = await getLinksResponse.json();
                            if (linksData.links && linksData.links.length > 0) {
                                const existingLink = linksData.links[0].url;
                                const officeTypes = [
                                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                                    "application/msword",
                                    "application/vnd.ms-excel",
                                    "application/vnd.ms-powerpoint",
                                ];
                                const archiveTypes = [
                                    "application/zip",
                                    "application/x-zip-compressed",
                                    "application/x-rar-compressed",
                                    "application/x-7z-compressed",
                                    "application/x-tar",
                                    "application/gzip",
                                    "application/x-gzip",
                                ];
                                const odfTypes2 = [
                                    "application/vnd.oasis.opendocument.text",
                                    "application/vnd.oasis.opendocument.spreadsheet",
                                    "application/vnd.oasis.opendocument.presentation",
                                ];
                                if (file.type.startsWith("image/") || file.type === "application/pdf" || officeTypes.includes(file.type) || archiveTypes.includes(file.type) || odfTypes2.includes(file.type)) {
                                    sharedUrl = existingLink.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[?&]dl=[01]/g, (m) => m[0] + "raw=1");
                                } else {
                                    sharedUrl = existingLink.replace("?dl=0", "?dl=1");
                                }
                                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Using existing shared link:", sharedUrl, "]");
                            }
                        }
                    } catch (e) {
                        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Failed to get existing link:", e, "]");
                    }
                }

                if (!sharedUrl) {
                    sharedUrl = `https://www.dropbox.com/home${uploadData.path_display}`;
                }
            }
        } catch (error) {
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Error creating shared link:", error, "]");
            sharedUrl = `https://www.dropbox.com/home${uploadData.path_display}`;
        }

        // Determine MIME type
        const mimeType = file.type || "application/octet-stream";

        const odfMimeTypes = [
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "application/vnd.oasis.opendocument.presentation",
        ];
        const isOdfFile = odfMimeTypes.includes(mimeType) || /\.(odt|ods|odp|odf)$/i.test(file.name);

        // Use appropriate viewer for documents (Dropbox forces download with raw URLs)
        // Note: Archives are NOT embedded - inserted as links instead
        let embedUrl: string | undefined;
        const archiveTypes = [
            "application/zip",
            "application/x-zip-compressed",
            "application/x-rar-compressed",
            "application/x-7z-compressed",
            "application/x-tar",
            "application/gzip",
            "application/x-gzip",
        ];

        if (mimeType === "application/pdf") {
            embedUrl = sharedUrl; // raw URL; browser renders PDF natively in iframe
        } else if (mimeType === "image/svg+xml" || /\.svg$/i.test(file.name)) {
            embedUrl = sharedUrl; // raw URL; browser renders SVG natively in iframe
        } else if (
            mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || // .docx
            mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || // .xlsx
            mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || // .pptx
            mimeType === "application/msword" || // .doc
            mimeType === "application/vnd.ms-excel" || // .xls
            mimeType === "application/vnd.ms-powerpoint" // .ppt
        ) {
            embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(sharedUrl)}`;
        }

        const isMediaFile = mimeType.startsWith("audio/") || mimeType.startsWith("video/");
        const isUploadSvg = mimeType === "image/svg+xml" || /\.svg$/i.test(file.name);

        const result: PickerResult = {
            item: {
                id: uploadData.id,
                name: uploadData.name,
                url: sharedUrl,
                embedUrl,
                downloadUrl: isMediaFile ? sharedUrl : undefined,
                mimeType,
            },
            mode: (archiveTypes.includes(mimeType) || isOdfFile) ? "link" : isUploadSvg ? "embed" : detectInsertMode({
                id: uploadData.id,
                name: uploadData.name,
                url: sharedUrl,
                mimeType,
            }),
        };

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Returning upload result:", result, "]");
        return result;
    } catch (error) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Upload error:", error, "]");
        throw error;
    }
};

/**
 * Factory that creates the Dropbox {@link CloudProvider} instance.
 *
 * In SDK mode (`pickerUrl` absent), uses the Dropbox Chooser (Dropins SDK) for picking
 * and the Dropbox Content API for uploading. Selecting files requires the `appKey`;
 * uploading additionally requires a valid OAuth 2.0 access token (acquired interactively
 * on first call via {@link getAccessToken}).
 *
 * In mock/popup mode (`pickerUrl` present), delegates pick operations to a custom
 * popup URL via {@link createPopupProvider}.
 *
 * @returns A fully-configured {@link CloudProvider} with `id: "dropbox"`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const dropboxProvider = (): CloudProvider => ({
    id: "dropbox",
    label: "Dropbox",
    pick: async (context) => {
        const config = context.providerConfig as DropboxProviderConfig;

        if (config.pickerUrl) {
            return await createPopupProvider("dropbox", "Dropbox", "/pickers/dropbox.html").pick(context);
        }

        await ensureDropboxSdk(config.appKey);
        return await openDropboxChooser(config);
    },
    upload: async (context, file) => {
        const config = context.providerConfig as DropboxProviderConfig;

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] upload() called for file:", file.name, "]");

        return await uploadFile(config, file);
    },
});

// Handle OAuth callback when page loads
if (typeof window !== 'undefined') {
    // Check if we're returning from Dropbox OAuth
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
        const match = hash.match(/access_token=([^&]+)/);
        if (match && match[1]) {
            const token = match[1];
            const expiryMatch = hash.match(/expires_in=(\d+)/);
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Captured OAuth token from URL ]");

            // Store token and expiry
            localStorage.setItem('dropbox_access_token', token);
            if (expiryMatch && expiryMatch[1]) {
                localStorage.setItem('dropbox_token_expiry', String(Date.now() + parseInt(expiryMatch[1], 10) * 1000));
            }
            cachedAccessToken = token;

            // If we're in a popup, send token to opener
            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.postMessage({
                        type: 'dropbox_oauth_token',
                        token: token,
                        expiresIn: expiryMatch ? parseInt(expiryMatch[1], 10) : undefined
                    }, window.location.origin);
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Sent token to opener via postMessage ]");
                    // Close popup after a short delay
                    setTimeout(() => window.close(), 500);
                } catch (e) {
                    console.error("[[ WaXCode / TinyMCE Multicloud Plugin / Dropbox ] Failed to send token to opener:", e, "]");
                }
            }

            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
    }
}
