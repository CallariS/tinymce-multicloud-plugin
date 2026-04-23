import type {
    CloudProvider,
    OneDriveProviderConfig,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { detectInsertMode, loadScript } from "./utils";

declare global {
    interface Window {
        OneDrive: any;
    }
}

const ONEDRIVE_SDK = "https://js.live.net/v7.2/OneDrive.js";

const ensureOneDriveSdk = async (): Promise<void> => {
    await loadScript(ONEDRIVE_SDK);
    if (!window.OneDrive?.open) {
        throw new Error("OneDrive picker SDK is unavailable.");
    }
};

const openOneDrivePicker = async (
    config: OneDriveProviderConfig,
): Promise<PickerResult | null> =>
    new Promise((resolve, reject) => {
        if (!config.clientId) {
            reject(new Error("OneDrive requires clientId."));
            return;
        }

        window.OneDrive.open({
            clientId: config.clientId,
            action: config.action || "query",
            multiSelect: config.multiSelect || false,
            advanced: {
                ...(config.redirectUri ? { redirectUri: config.redirectUri } : {}),
                ...(config.advanced || {}),
            },
            success: (selection: any) => {
                const first = selection?.value?.[0];
                if (!first) {
                    resolve(null);
                    return;
                }

                const url = first.webUrl || first["@microsoft.graph.downloadUrl"] || "";
                if (!url) {
                    reject(new Error("OneDrive picker did not return a usable URL."));
                    return;
                }

                const result: PickerResult = {
                    item: {
                        id: first.id || first.name,
                        name: first.name || first.id,
                        url,
                        mimeType: first.file?.mimeType,
                        downloadUrl: first["@microsoft.graph.downloadUrl"],
                    },
                    mode: detectInsertMode({
                        id: first.id || first.name,
                        name: first.name || first.id,
                        url,
                        mimeType: first.file?.mimeType,
                    }),
                };

                resolve(result);
            },
            cancel: () => resolve(null),
            error: (error: any) => reject(new Error(error?.message || "OneDrive picker failed.")),
        });
    });

export const oneDriveProvider = (): CloudProvider => ({
    id: "oneDrive",
    label: "OneDrive",
    pick: async (context) => {
        const config = context.providerConfig as OneDriveProviderConfig;

        if (config.pickerUrl) {
            return await createPopupProvider("oneDrive", "OneDrive", "/pickers/onedrive.html").pick(context);
        }

        await ensureOneDriveSdk();
        return await openOneDrivePicker(config);
    },
});
