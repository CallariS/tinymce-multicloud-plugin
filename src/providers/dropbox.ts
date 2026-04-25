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
    // Check if we already have a token in cache or localStorage
    if (cachedAccessToken) {
        console.log("[Dropbox] Using cached access token");
        return cachedAccessToken;
    }

    // Check localStorage for persisted token
    const storedToken = localStorage.getItem('dropbox_access_token');
    if (storedToken) {
        cachedAccessToken = storedToken;
        console.log("[Dropbox] Using stored access token");
        return cachedAccessToken;
    }

    // Start OAuth flow
    console.log("[Dropbox] Starting OAuth flow...");
    const redirectUri = window.location.origin + window.location.pathname;
    const authUrl = `${DROPBOX_AUTH_URL}?client_id=${appKey}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}`;

    // Open auth popup
    const popup = window.open(authUrl, "Dropbox Auth", "width=600,height=700,scrollbars=yes");

    if (!popup) {
        throw new Error("Failed to open Dropbox auth popup. Please allow popups for this site.");
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
                    window.removeEventListener('message', messageHandler);
                    popup.close();
                    console.log("[Dropbox] OAuth successful via postMessage");
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
                            console.log("[Dropbox] OAuth successful (token found in localStorage)");
                            resolve(cachedAccessToken);
                        } else {
                            reject(new Error("Dropbox auth popup was closed without authorization"));
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
                            if (match && match[1] && !resolved) {
                                resolved = true;
                                cachedAccessToken = match[1];
                                localStorage.setItem('dropbox_access_token', cachedAccessToken);
                                clearInterval(checkInterval);
                                window.removeEventListener('message', messageHandler);
                                popup.close();
                                console.log("[Dropbox] OAuth successful (token from popup URL)");
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
                reject(new Error("Dropbox auth timeout"));
            }
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
                const baseUrl = sharingData.url;

                // For images, convert to raw content URL for proper embedding
                if (file.type.startsWith("image/")) {
                    // Convert www.dropbox.com to dl.dropboxusercontent.com and add ?raw=1
                    sharedUrl = baseUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "?raw=1");
                    console.log("[Dropbox] Created raw image URL:", sharedUrl);
                } else {
                    // For other files, use direct download link
                    sharedUrl = baseUrl.replace("?dl=0", "?dl=1");
                    console.log("[Dropbox] Created direct download link:", sharedUrl);
                }
            } else {
                const errorText = await sharingResponse.text();
                console.warn("[Dropbox] Failed to create shared link:", sharingResponse.status, errorText);

                // Check if link already exists
                if (errorText.includes("shared_link_already_exists")) {
                    console.log("[Dropbox] Shared link already exists, trying to get existing link...");
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
                                if (file.type.startsWith("image/")) {
                                    sharedUrl = existingLink.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "?raw=1");
                                } else {
                                    sharedUrl = existingLink.replace("?dl=0", "?dl=1");
                                }
                                console.log("[Dropbox] Using existing shared link:", sharedUrl);
                            }
                        }
                    } catch (e) {
                        console.error("[Dropbox] Failed to get existing link:", e);
                    }
                }

                if (!sharedUrl) {
                    sharedUrl = `https://www.dropbox.com/home${uploadData.path_display}`;
                }
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

// Handle OAuth callback when page loads
if (typeof window !== 'undefined') {
    // Check if we're returning from Dropbox OAuth
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
        const match = hash.match(/access_token=([^&]+)/);
        if (match && match[1]) {
            const token = match[1];
            console.log("[Dropbox] Captured OAuth token from URL");
            
            // Store token
            localStorage.setItem('dropbox_access_token', token);
            cachedAccessToken = token;
            
            // If we're in a popup, send token to opener
            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.postMessage({
                        type: 'dropbox_oauth_token',
                        token: token
                    }, window.location.origin);
                    console.log("[Dropbox] Sent token to opener via postMessage");
                    // Close popup after a short delay
                    setTimeout(() => window.close(), 500);
                } catch (e) {
                    console.error("[Dropbox] Failed to send token to opener:", e);
                }
            }
            
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
    }
}
