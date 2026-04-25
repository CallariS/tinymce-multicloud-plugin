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

const DROPBOX_DROPINS = "https://www.dropbox.com/static/api/2/dropins.js";
const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
const DROPBOX_SHARING_URL = "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings";

let cachedAccessToken: string | null = null;

const ensureDropboxSdk = async (appKey: string): Promise<void> => {
    if (!appKey) {
        throw new Error("Dropbox requires appKey.");
    }

    await loadScript(DROPBOX_DROPINS, { "data-app-key": appKey, id: "dropboxjs" });

    if (!window.Dropbox?.choose) {
        throw new Error("Dropbox chooser SDK is unavailable.");
    }
};

const openDropboxChooser = async (
    config: DropboxProviderConfig,
): Promise<PickerResult | null> =>
    new Promise((resolve, reject) => {
        const timeoutRef = window.setTimeout(() => {
            reject(new Error("Dropbox chooser did not return a selection."));
        }, config.timeoutMs || 180000);

        const clear = () => window.clearTimeout(timeoutRef);

        window.Dropbox.choose({
            linkType: config.linkType || "preview",
            multiselect: config.multiselect || false,
            extensions: config.extensions || [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".doc", ".docx"],
            success: (files: any[]) => {
                const first = files?.[0];
                if (!first?.link) {
                    clear();
                    resolve(null);
                    return;
                }

                const validated = validateDropboxFileBoundary(first);

                const result: PickerResult = {
                    item: {
                        id: validated.id || validated.name || "dropbox-file",
                        name: validated.name || "Dropbox file",
                        url: validated.link,
                        thumbnailUrl: validated.thumbnailLink,
                    },
                    mode: detectInsertMode({
                        id: validated.id || validated.name || "dropbox-file",
                        name: validated.name || "Dropbox file",
                        url: validated.link,
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

const getAccessToken = async (appKey: string): Promise<string> => {
    // Check if we already have a token in cache
    if (cachedAccessToken) {
        console.log("[Dropbox] Using cached access token");
        return cachedAccessToken;
    }

    // Check if we have a token in URL hash (OAuth redirect)
    const hash = window.location.hash;
    if (hash.includes("access_token=")) {
        const match = hash.match(/access_token=([^&]+)/);
        if (match && match[1]) {
            cachedAccessToken = match[1];
            console.log("[Dropbox] Got access token from OAuth redirect");
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return cachedAccessToken;
        }
    }

    // Start OAuth flow
    console.log("[Dropbox] Starting OAuth flow...");
    const redirectUri = window.location.origin + window.location.pathname;
    const authUrl = `${DROPBOX_AUTH_URL}?client_id=${appKey}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}`;

    // Open auth popup
    const popup = window.open(authUrl, "Dropbox Auth", "width=600,height=700");
    
    if (!popup) {
        throw new Error("Failed to open Dropbox auth popup. Please allow popups for this site.");
    }

    // Wait for OAuth callback
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            try {
                if (popup.closed) {
                    clearInterval(checkInterval);
                    reject(new Error("Dropbox auth popup was closed"));
                    return;
                }

                // Check if popup redirected back with token
                try {
                    const popupHash = popup.location.hash;
                    if (popupHash && popupHash.includes("access_token=")) {
                        const match = popupHash.match(/access_token=([^&]+)/);
                        if (match && match[1]) {
                            cachedAccessToken = match[1];
                            clearInterval(checkInterval);
                            popup.close();
                            console.log("[Dropbox] OAuth successful");
                            resolve(cachedAccessToken);
                        }
                    }
                } catch (e) {
                    // Cross-origin error, popup not redirected yet
                }
            } catch (e) {
                // Ignore errors
            }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
            clearInterval(checkInterval);
            if (!popup.closed) {
                popup.close();
            }
            reject(new Error("Dropbox auth timeout"));
        }, 300000);
    });
};

const uploadFile = async (
    config: DropboxProviderConfig,
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.log("[Dropbox] Uploading file:", file.name);

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

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Upload failed: ${uploadResponse.status} ${errorText}`);
        }

        const uploadData = await uploadResponse.json();
        console.log("[Dropbox] File uploaded successfully:", uploadData.name);

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
                // Convert preview link to direct link by changing ?dl=0 to ?dl=1
                sharedUrl = sharingData.url.replace("?dl=0", "?dl=1");
                console.log("[Dropbox] Created shared link:", sharedUrl);
            } else {
                console.warn("[Dropbox] Failed to create shared link, using file path");
                sharedUrl = `https://www.dropbox.com/home${uploadData.path_display}`;
            }
        } catch (error) {
            console.warn("[Dropbox] Error creating shared link:", error);
            sharedUrl = `https://www.dropbox.com/home${uploadData.path_display}`;
        }

        // Determine MIME type
        const mimeType = file.type || "application/octet-stream";

        const result: PickerResult = {
            item: {
                id: uploadData.id,
                name: uploadData.name,
                url: sharedUrl,
                mimeType,
            },
            mode: detectInsertMode({
                id: uploadData.id,
                name: uploadData.name,
                url: sharedUrl,
                mimeType,
            }),
        };

        console.log("[Dropbox] Returning upload result:", result);
        return result;
    } catch (error) {
        console.error("[Dropbox] Upload error:", error);
        throw error;
    }
};

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

        console.log("[Dropbox] upload() called for file:", file.name);

        return await uploadFile(config, file);
    },
});
