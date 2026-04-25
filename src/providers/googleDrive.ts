import type {
    CloudProvider,
    GoogleDriveProviderConfig,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { detectInsertMode, loadScript } from "./utils";
import { validateGoogleDocBoundary } from "../validation/boundary";

type TokenResponse = { access_token?: string; error?: string };

declare global {
    interface Window {
        gapi: any;
        google: any;
    }
}

const GAPI_SCRIPT = "https://apis.google.com/js/api.js";
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";

let gapiClientReady = false;
let tokenClient: any;

const ensureGoogleApis = async (config: GoogleDriveProviderConfig): Promise<void> => {
    if (!config.clientId || !config.apiKey) {
        throw new Error("Google Drive requires clientId and apiKey.");
    }

    await loadScript(GAPI_SCRIPT);
    await loadScript(GIS_SCRIPT);

    if (!window.gapi || !window.google?.accounts?.oauth2) {
        throw new Error("Google APIs are not available in this browser.");
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

    if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: config.clientId,
            scope: (config.scopes || [
                "https://www.googleapis.com/auth/drive.readonly",
                "https://www.googleapis.com/auth/drive.file",
            ]).join(" "),
            callback: () => undefined,
        });
    }
};

const requestToken = async (): Promise<string> =>
    new Promise((resolve, reject) => {
        tokenClient.callback = (response: TokenResponse) => {
            if (response.error || !response.access_token) {
                reject(new Error(response.error || "Unable to obtain Google access token."));
                return;
            }

            resolve(response.access_token);
        };

        const existingToken = window.gapi.client.getToken();
        tokenClient.requestAccessToken({ prompt: existingToken ? "" : "consent" });
    });

const getFileMetadata = async (fileId: string): Promise<any> => {
    try {
        const response = await window.gapi.client.drive.files.get({
            fileId,
            fields: "id,name,mimeType,webContentLink,thumbnailLink,iconLink",
        });
        return response.result;
    } catch (error) {
        console.warn("Failed to fetch file metadata:", error);
        return null;
    }
};

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
                console.log("Google Picker callback:", data);

                // Ignore intermediate events like 'loaded', only handle terminal actions
                if (data.action === window.google.picker.Action.CANCEL) {
                    console.log("Picker cancelled");
                    resolve(null);
                    return;
                }

                if (data.action !== window.google.picker.Action.PICKED) {
                    console.log("Non-terminal action, ignoring:", data.action);
                    return; // Don't resolve, wait for PICKED or CANCEL
                }

                if (!data.docs?.length) {
                    console.log("No files in picked event");
                    resolve(null);
                    return;
                }

                const doc = data.docs[0];
                console.log("Selected document:", doc);

                // Fetch file metadata asynchronously and resolve
                (async () => {
                    try {
                        const metadata = await getFileMetadata(doc.id);
                        console.log("File metadata from Drive API:", metadata);

                        const validatedDoc = validateGoogleDocBoundary(doc);
                        const fallbackUrl = `https://drive.google.com/file/d/${doc.id}/view`;

                        // For images, use high-res thumbnail; for others use direct download link
                        let directUrl: string;
                        const isImage = validatedDoc.mimeType?.startsWith("image/");

                        if (isImage && metadata?.thumbnailLink) {
                            // Replace thumbnail size parameter (e.g., =s220) with high-res (=s2000)
                            directUrl = metadata.thumbnailLink.replace(/=s\d+$/, "=s2000");
                            console.log("Using high-res thumbnail for image:", directUrl);
                        } else if (metadata?.webContentLink) {
                            directUrl = metadata.webContentLink;
                            console.log("Using webContentLink:", directUrl);
                        } else {
                            directUrl = validatedDoc.url || fallbackUrl;
                            console.log("Using fallback URL:", directUrl);
                        }

                        const result = {
                            item: {
                                id: validatedDoc.id,
                                name: validatedDoc.name || validatedDoc.id,
                                url: directUrl,
                                mimeType: validatedDoc.mimeType,
                                thumbnailUrl: metadata?.thumbnailLink || validatedDoc.thumbnails?.[0]?.url,
                                embedUrl: getEmbedUrl(validatedDoc.id, validatedDoc.mimeType),
                            },
                            mode: detectInsertMode({
                                id: validatedDoc.id,
                                name: validatedDoc.name || validatedDoc.id,
                                url: directUrl,
                                mimeType: validatedDoc.mimeType,
                            }),
                        };

                        console.log("Returning picker result:", result);
                        resolve(result);
                    } catch (error) {
                        console.error("Error processing picker result:", error);
                        resolve(null);
                    }
                })();
            })
            .build();

        picker.setVisible(true);
    });

const uploadFile = async (
    config: GoogleDriveProviderConfig,
    file: File,
): Promise<PickerResult | null> => {
    try {
        console.log("Uploading file to Google Drive:", file.name);

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
            throw new Error("No access token available");
        }

        const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webContentLink,thumbnailLink,iconLink", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            body: form,
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        const uploadedFile = await response.json();
        console.log("File uploaded successfully:", uploadedFile);

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
            console.log("File set to public sharing");
        } catch (error) {
            console.warn("Failed to set public sharing (file remains private):", error);
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
        console.error("Upload error:", error);
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
        const accessToken = await requestToken();
        return await launchPicker(config, accessToken);
    },
    upload: async (context, file) => {
        const config = context.providerConfig as GoogleDriveProviderConfig;

        await ensureGoogleApis(config);
        await requestToken(); // Ensure we have a valid token
        return await uploadFile(config, file);
    },
});
