import type {
    CloudProvider,
    GoogleDriveProviderConfig,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { detectInsertMode, loadScript } from "./utils";
import { validateGoogleDocBoundary } from "../validation/boundary";

/** Shape of the OAuth 2.0 token response returned by the GIS token client (legacy implicit flow). */
type TokenResponse = { access_token?: string; error?: string };
/** Shape of the token exchange response returned by the Cloudflare Worker `/google-token` endpoint. */
type TokenExchangeResponse = { access_token: string; expires_in?: number };

declare global {
    interface Window {
        gapi: any;
        google: any;
    }
}

/** URL of the Google API JavaScript client (gapi). Loaded lazily at first use. */
const GAPI_SCRIPT = "https://apis.google.com/js/api.js";
/** URL of the Google Identity Services (GIS) authentication script. Loaded lazily at first use. */
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";

/** Guards against re-initialising the gapi `client:picker` module on subsequent calls. */
let gapiClientReady = false;
/** The GIS code client instance (Authorization Code flow). Initialised when `tokenExchangeUrl` is set. */
let codeClient: any;
/** The GIS token client instance (implicit flow, legacy). Initialised when `tokenExchangeUrl` is absent. */
let tokenClient: any;
/** Unix timestamp (ms) after which the cached access token must be refreshed. */
let tokenExpiresAt = 0;

/**
 * Ensures the Google APIs (gapi client + GIS) are loaded and initialised.
 *
 * On first call: loads both SDK scripts, initialises the gapi client with the Drive v3
 * discovery document, and creates the GIS token client.
 * On subsequent calls: returns immediately if everything is already ready.
 *
 * @param config - Provider config supplying `clientId`, `apiKey`, and optionally `scopes`.
 * @throws {Error} If `clientId` or `apiKey` are missing.
 * @throws {Error} If the Google API scripts fail to load or initialise.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const ensureGoogleApis = async (config: GoogleDriveProviderConfig): Promise<void> => {
    if (!config.clientId || !config.apiKey) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Google Drive requires clientId and apiKey. ]");
    }

    await loadScript(GAPI_SCRIPT);
    await loadScript(GIS_SCRIPT);

    if (!window.gapi || !window.google?.accounts?.oauth2) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Google APIs are not available in this browser. ]");
    }

    if (!gapiClientReady) {
        await new Promise<void>((resolve, reject) => {
            window.gapi.load("client:picker", async () => {
                try {
                    await window.gapi.client.init({
                        apiKey: config.apiKey,
                        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
                    });
                    gapiClientReady = true;
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    const scopes = (config.scopes || [
        "https://www.googleapis.com/auth/drive.file",
    ]).join(" ");

    if (config.tokenExchangeUrl) {
        // Authorization Code flow (secure, recommended)
        if (!codeClient) {
            codeClient = window.google.accounts.oauth2.initCodeClient({
                client_id: config.clientId,
                scope: scopes,
                ux_mode: "popup",
                callback: () => undefined,
            });
        }
    } else {
        // Legacy implicit (token) flow — kept for backward compatibility
        if (!tokenClient) {
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Using the deprecated implicit (token) flow. Set tokenExchangeUrl in the Google Drive provider config to switch to the secure Authorization Code flow. ]]");
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: config.clientId,
                scope: scopes,
                callback: () => undefined,
            });
        }
    }
};

/**
 * Requests a Google OAuth 2.0 access token via the GIS token client.
 *
 * If a token is already cached by gapi (from a previous consent), the silent
 * `prompt: ""` flow is used. Otherwise, the full consent screen is shown.
 *
 * @returns A promise resolving to the raw access token string.
 * @throws {Error} If the token request fails or the user denies consent.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const requestToken = async (): Promise<string> =>
    new Promise((resolve, reject) => {
        tokenClient.callback = (response: TokenResponse) => {
            if (response.error || !response.access_token) {
                reject(new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] ${response.error || "Unable to obtain Google access token."} ]`));
                return;
            }

            resolve(response.access_token);
        };

        const existingToken = window.gapi.client.getToken();
        tokenClient.requestAccessToken({ prompt: existingToken ? "" : "consent" });
    });

/**
 * Requests a Google OAuth 2.0 authorization code via the GIS code client (Authorization Code flow).
 *
 * Opens a browser popup showing the Google consent screen. After the user grants consent the
 * GIS library delivers the one-time authorization code to the configured callback.
 *
 * @returns A promise resolving to the authorization code string.
 * @throws {Error} If the user denies consent or the popup closes without completing auth.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const requestAuthCode = (): Promise<string> =>
    new Promise((resolve, reject) => {
        codeClient.callback = (response: { code?: string; error?: string }) => {
            if (response.error || !response.code) {
                reject(new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] ${response.error || "Unable to obtain Google authorization code."} ]]`));
                return;
            }
            resolve(response.code);
        };
        codeClient.requestCode();
    });

/**
 * Exchanges a Google OAuth 2.0 authorization code for an access token by calling the
 * configured server-side token exchange endpoint (Cloudflare Worker).
 *
 * The Worker holds the `client_secret` and performs the exchange against
 * `https://oauth2.googleapis.com/token`, returning only the access token to the browser.
 *
 * @param code - One-time authorization code received from the GIS callback.
 * @param tokenExchangeUrl - URL of the Cloudflare Worker `/google-token` endpoint.
 * @returns A promise resolving to the token exchange response.
 * @throws {Error} If the Worker request fails or the response is missing an access token.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const exchangeCodeForToken = async (
    code: string,
    tokenExchangeUrl: string,
): Promise<TokenExchangeResponse> => {
    const response = await fetch(tokenExchangeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Token exchange failed (${response.status}): ${text} ]]`);
    }

    const data = await response.json() as TokenExchangeResponse;
    if (!data.access_token) {
        throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Token exchange response is missing access_token. ]]");
    }
    return data;
};

/**
 * Obtains a valid Google OAuth 2.0 access token using whichever flow is configured.
 *
 * - **Authorization Code flow** (when `config.tokenExchangeUrl` is set): reuses a cached token
 *   when one exists and has not yet expired; otherwise opens the GIS consent popup, exchanges
 *   the resulting code at the Worker, and stores the token in the gapi client.
 * - **Legacy implicit flow** (when `config.tokenExchangeUrl` is absent): delegates to
 *   {@link requestToken} with a deprecation warning emitted by {@link ensureGoogleApis}.
 *
 * @param config - Provider config used to determine which flow to use.
 * @returns A promise resolving to the raw access token string.
 * @throws {Error} If the token request or exchange fails.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const requestAccessToken = async (config: GoogleDriveProviderConfig): Promise<string> => {
    if (config.tokenExchangeUrl) {
        // Reuse a cached, unexpired token (60-second safety margin)
        const existing = window.gapi.client.getToken();
        if (existing?.access_token && Date.now() < tokenExpiresAt) {
            return existing.access_token;
        }
        const code = await requestAuthCode();
        const { access_token, expires_in } = await exchangeCodeForToken(code, config.tokenExchangeUrl);
        window.gapi.client.setToken({ access_token });
        tokenExpiresAt = Date.now() + ((expires_in ?? 3600) - 60) * 1000;
        return access_token;
    }
    // Legacy: implicit (token) flow
    return requestToken();
};

/**
 * Fetches file metadata from the Drive v3 REST API for the given file ID.
 *
 * Returns `null` on failure (e.g. permission error, network issue) rather than throwing,
 * so callers can fall back gracefully.
 *
 * @param fileId - The Google Drive file ID.
 * @returns A promise resolving to the raw Drive API file object, or `null` on failure.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getFileMetadata = async (fileId: string): Promise<any> => {
    try {
        const response = await window.gapi.client.drive.files.get({
            fileId,
            fields: "id,name,mimeType,webContentLink,thumbnailLink,iconLink",
        });
        return response.result;
    } catch (error) {
        console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Failed to fetch file metadata:", error, "]");
        return null;
    }
};

/**
 * Returns the appropriate Google-hosted embed/preview URL for a file based on its MIME type.
 *
 * Google Workspace files (Docs, Sheets, Slides, Forms, Drawings) each have dedicated
 * `/preview` endpoints. All other files fall back to the generic Drive viewer.
 *
 * @param fileId - The Google Drive file ID.
 * @param mimeType - MIME type of the file (case-insensitive). May be `undefined`.
 * @returns Absolute embed URL string.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getEmbedUrl = (fileId: string, mimeType: string | undefined): string => {
    const mime = mimeType?.toLowerCase() || "";

    // Google Workspace files have specific viewer URLs
    if (mime === "application/vnd.google-apps.document") {
        return `https://docs.google.com/document/d/${fileId}/preview`;
    }
    if (mime === "application/vnd.google-apps.spreadsheet") {
        return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
    }
    if (mime === "application/vnd.google-apps.presentation") {
        return `https://docs.google.com/presentation/d/${fileId}/preview`;
    }
    if (mime === "application/vnd.google-apps.form") {
        return `https://docs.google.com/forms/d/${fileId}/viewform?embedded=true`;
    }
    if (mime === "application/vnd.google-apps.drawing") {
        return `https://docs.google.com/drawings/d/${fileId}/preview`;
    }

    // PDFs and other files use the generic Drive viewer
    return `https://drive.google.com/file/d/${fileId}/preview`;
};

/**
 * Builds and displays the Google Picker UI, then resolves with the user's selection.
 *
 * Injects a one-time CSS rule to raise the Picker dialog above TinyMCE's own modals
 * (z-index fix). After the user picks a file the Drive v3 API is called to obtain full
 * metadata, and the result is assembled into a {@link PickerResult}.
 *
 * URL strategy:
 * - Raster images — thumbnail endpoint (`sz=w2000`) for direct `<img>` rendering.
 * - SVG — embed URL (browser renders SVG natively in an iframe at full vector quality).
 * - Other files — `webContentLink` if available, then `webViewLink`, then a fallback view URL.
 *
 * @param config - Provider config supplying `apiKey`, `pickerLocale`, and `viewMimeTypes`.
 * @param accessToken - OAuth 2.0 access token obtained from {@link requestToken}.
 * @returns A promise resolving to the {@link PickerResult}, or `null` if the user cancelled.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const launchPicker = async (
    config: GoogleDriveProviderConfig,
    accessToken: string,
): Promise<PickerResult | null> =>
    new Promise((resolve) => {
        // Inject CSS to ensure picker appears above TinyMCE
        if (!document.getElementById("google-picker-z-index-fix")) {
            const style = document.createElement("style");
            style.id = "google-picker-z-index-fix";
            style.textContent = `
                .picker-dialog, .picker.modal-dialog { 
                    z-index: 100000 !important; 
                }
                .picker-dialog-bg { 
                    z-index: 99999 !important; 
                }
            `;
            document.head.appendChild(style);
        }

        const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false);

        if (config.viewMimeTypes) {
            view.setMimeTypes(config.viewMimeTypes);
        }

        const picker = new window.google.picker.PickerBuilder()
            .setOAuthToken(accessToken)
            .setDeveloperKey(config.apiKey)
            .setLocale(config.pickerLocale || "en")
            .setTitle("Select a Google Drive file")
            .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
            .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
            .addView(view)
            .setCallback((data: any) => {
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Google Picker callback:", data, "]");

                // Ignore intermediate events like 'loaded', only handle terminal actions
                if (data.action === window.google.picker.Action.CANCEL) {
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Picker cancelled ]");
                    resolve(null);
                    return;
                }

                if (data.action !== window.google.picker.Action.PICKED) {
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Non-terminal action, ignoring:", data.action, "]");
                    return; // Don't resolve, wait for PICKED or CANCEL
                }

                if (!data.docs?.length) {
                    console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] No files in picked event ]");
                    resolve(null);
                    return;
                }

                const doc = data.docs[0];
                console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Selected document:", doc, "]");

                // Fetch file metadata asynchronously and resolve
                (async () => {
                    try {
                        const metadata = await getFileMetadata(doc.id);
                        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] File metadata from Drive API:", metadata, "]");

                        const validatedDoc = validateGoogleDocBoundary(doc);
                        const fallbackUrl = `https://drive.google.com/file/d/${doc.id}/view`;

                        // Always use a stable public URL as the stored URL.
                        // webContentLink (uc?export=download) sends Content-Disposition: attachment
                        // so browsers won't render it as an <img>. For raster images, use the thumbnail
                        // endpoint which serves content directly. SVG is treated as embed (iframe)
                        // because the thumbnail endpoint rasterizes it, losing vector quality.
                        const isSvg = validatedDoc.mimeType === "image/svg+xml" ||
                            /\.svg$/i.test(validatedDoc.name || "");
                        const isRasterImage = !isSvg && validatedDoc.mimeType?.startsWith("image/");
                        let directUrl: string;
                        if (isRasterImage) {
                            directUrl = `https://drive.google.com/thumbnail?id=${validatedDoc.id}&sz=w2000`;
                            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Using thumbnail endpoint for image:", directUrl, "]");
                        } else if (metadata?.webContentLink) {
                            directUrl = metadata.webContentLink;
                            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Using webContentLink:", directUrl, "]");
                        } else {
                            directUrl = validatedDoc.url || fallbackUrl;
                            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Using fallback URL:", directUrl, "]");
                        }

                        const embedUrl = getEmbedUrl(validatedDoc.id, validatedDoc.mimeType);
                        const result = {
                            item: {
                                id: validatedDoc.id,
                                name: validatedDoc.name || validatedDoc.id,
                                url: isSvg ? embedUrl : directUrl,
                                mimeType: validatedDoc.mimeType,
                                thumbnailUrl: metadata?.thumbnailLink || validatedDoc.thumbnails?.[0]?.url,
                                embedUrl,
                            },
                            mode: isSvg ? "embed" as const : detectInsertMode({
                                id: validatedDoc.id,
                                name: validatedDoc.name || validatedDoc.id,
                                url: directUrl,
                                mimeType: validatedDoc.mimeType,
                            }),
                        };

                        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Returning picker result:", result, "]");
                        resolve(result);
                    } catch (error) {
                        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Error processing picker result:", error, "]");
                        resolve(null);
                    }
                })();
            })
            .build();

        picker.setVisible(true);
    });

/**
 * Uploads a file to Google Drive using the multipart upload API, then optionally
 * sets the file to public-reader sharing so embedded URLs are accessible without auth.
 *
 * @param config - Provider config (access token is read from the gapi client cache).
 * @param file - The `File` object to upload.
 * @returns A promise resolving to the {@link PickerResult} for the uploaded file, or `null` on failure.
 * @throws {Error} If no access token is available, if the upload request fails, or if metadata
 *   cannot be fetched after a successful upload.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const uploadFile = async (
    config: GoogleDriveProviderConfig,
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Uploading file to Google Drive:", file.name, "]");

        // Create metadata
        const metadata = {
            name: file.name,
            mimeType: file.type,
        };

        // Use multipart upload
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", file);

        const accessToken = window.gapi.client.getToken()?.access_token;
        if (!accessToken) {
            throw new Error("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] No access token available. ]");
        }

        const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webContentLink,thumbnailLink,iconLink", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            body: form,
        });

        if (!response.ok) {
            throw new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Upload failed: ${response.statusText} ]`);
        }

        const uploadedFile = await response.json();
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] File uploaded successfully:", uploadedFile, "]");

        // Make the file publicly accessible
        try {
            await fetch(`https://www.googleapis.com/drive/v3/files/${uploadedFile.id}/permissions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    role: "reader",
                    type: "anyone",
                }),
            });
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] File set to public sharing ]");
        } catch (error) {
            console.warn("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Failed to set public sharing (file remains private):", error, "]");
        }

        // Fetch full metadata
        const metadata2 = await getFileMetadata(uploadedFile.id);
        const isImage = file.type.startsWith("image/");

        let directUrl: string;
        if (isImage && metadata2?.thumbnailLink) {
            directUrl = metadata2.thumbnailLink.replace(/=s\d+$/, "=s2000");
        } else if (metadata2?.webContentLink) {
            directUrl = metadata2.webContentLink;
        } else {
            directUrl = `https://drive.google.com/file/d/${uploadedFile.id}/view`;
        }

        return {
            item: {
                id: uploadedFile.id,
                name: uploadedFile.name,
                url: directUrl,
                mimeType: uploadedFile.mimeType,
                thumbnailUrl: metadata2?.thumbnailLink,
                embedUrl: getEmbedUrl(uploadedFile.id, uploadedFile.mimeType),
            },
            mode: detectInsertMode({
                id: uploadedFile.id,
                name: uploadedFile.name,
                url: directUrl,
                mimeType: uploadedFile.mimeType,
            }),
        };
    } catch (error) {
        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / GoogleDrive ] Upload error:", error, "]");
        throw error;
    }
};

export const googleDriveProvider = (): CloudProvider => ({
    id: "googleDrive",
    label: "Google Drive",
    pick: async (context) => {
        const config = context.providerConfig as GoogleDriveProviderConfig;

        if (config.pickerUrl) {
            return await createPopupProvider("googleDrive", "Google Drive", "/pickers/google-drive.html").pick(context);
        }

        await ensureGoogleApis(config);
        const accessToken = await requestAccessToken(config);
        return await launchPicker(config, accessToken);
    },
    upload: async (context, file) => {
        const config = context.providerConfig as GoogleDriveProviderConfig;

        await ensureGoogleApis(config);
        await requestAccessToken(config); // Ensure we have a valid token
        const result = await uploadFile(config, file);

        if (result && file.type.startsWith("video/")) {
            context.editor.notificationManager.open({
                type: "info",
                text: "Video uploaded. Google Drive needs a few minutes to process it — the embedded player will start working once transcoding is complete.",
                timeout: 10000,
            });
        }

        return result;
    },
});
