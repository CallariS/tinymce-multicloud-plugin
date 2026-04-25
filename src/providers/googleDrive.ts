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
            scope: (config.scopes || ["https://www.googleapis.com/auth/drive.file"]).join(" "),
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

const launchPicker = async (
    config: GoogleDriveProviderConfig,
    accessToken: string,
): Promise<PickerResult | null> =>
    new Promise((resolve) => {
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
                
                if (data.action === window.google.picker.Action.CANCEL) {
                    console.log("Picker cancelled");
                    resolve(null);
                    return;
                }

                if (data.action !== window.google.picker.Action.PICKED || !data.docs?.length) {
                    console.log("No files picked");
                    resolve(null);
                    return;
                }

                const doc = data.docs[0];
                console.log("Selected document:", doc);
                
                const validatedDoc = validateGoogleDocBoundary(doc);
                const fallbackUrl = `https://drive.google.com/file/d/${doc.id}/view`;

                const result = {
                    item: {
                        id: validatedDoc.id,
                        name: validatedDoc.name || validatedDoc.id,
                        url: validatedDoc.url || fallbackUrl,
                        mimeType: validatedDoc.mimeType,
                        thumbnailUrl: validatedDoc.thumbnails?.[0]?.url,
                        embedUrl: `https://drive.google.com/file/d/${validatedDoc.id}/preview`,
                    },
                    mode: detectInsertMode({
                        id: validatedDoc.id,
                        name: validatedDoc.name || validatedDoc.id,
                        url: validatedDoc.url || fallbackUrl,
                        mimeType: validatedDoc.mimeType,
                    }),
                };
                
                console.log("Returning picker result:", result);
                resolve(result);
            })
            .build();

        picker.setVisible(true);
    });

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
});
