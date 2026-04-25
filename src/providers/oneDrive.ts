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
        OneDrive: any;
    }
}

const ONEDRIVE_SDK = "https://js.live.net/v7.2/OneDrive.js";

const ensureOneDriveSdk = async (): Promise<void> => {
    console.log("[OneDrive] ensureOneDriveSdk() loading from:", ONEDRIVE_SDK);
    await loadScript(ONEDRIVE_SDK);
    console.log("[OneDrive] Script loaded, checking window.OneDrive...");
    if (!window.OneDrive?.open) {
        console.error("[OneDrive] window.OneDrive or window.OneDrive.open is undefined!");
        throw new Error("OneDrive picker SDK is unavailable.");
    }
    console.log("[OneDrive] window.OneDrive.open available");
};

const openOneDrivePicker = async (
    config: OneDriveProviderConfig,
): Promise<PickerResult | null> =>
    new Promise((resolve, reject) => {
        if (!config.clientId) {
            reject(new Error("OneDrive requires clientId."));
            return;
        }

        console.log("[OneDrive] Opening picker with clientId:", config.clientId);
        
        try {
            window.OneDrive.open({
                clientId: config.clientId,
                action: config.action || "query",
                multiSelect: config.multiSelect || false,
                advanced: {
                    ...(config.redirectUri ? { redirectUri: config.redirectUri } : {}),
                    ...(config.advanced || {}),
                },
                success: (selection: any) => {
                    console.log("[OneDrive] Success callback fired:", selection);
                    const first = selection?.value?.[0];
                    if (!first) {
                        console.log("[OneDrive] No file selected, resolving null");
                        resolve(null);
                        return;
                    }

                    const validated = validateOneDriveFileBoundary(first);

                    const url = validated.webUrl || validated["@microsoft.graph.downloadUrl"] || "";
                    if (!url) {
                        reject(new Error("OneDrive picker did not return a usable URL."));
                        return;
                    }

                    const result: PickerResult = {
                        item: {
                            id: validated.id || validated.name,
                            name: validated.name || validated.id,
                            url,
                            mimeType: validated.file?.mimeType,
                            downloadUrl: validated["@microsoft.graph.downloadUrl"],
                        },
                        mode: detectInsertMode({
                            id: validated.id || validated.name,
                            name: validated.name || validated.id,
                            url,
                            mimeType: validated.file?.mimeType,
                        }),
                    };

                    console.log("[OneDrive] Resolving result:", result);
                    resolve(result);
                },
                cancel: () => {
                    console.log("[OneDrive] Cancel callback fired");
                    resolve(null);
                },
                error: (error: any) => {
                    console.error("[OneDrive] Error callback fired:", error);
                    reject(new Error(error?.message || "OneDrive picker failed."));
                },
            });
            console.log("[OneDrive] window.OneDrive.open() called successfully");
        } catch (err) {
            console.error("[OneDrive] Exception calling window.OneDrive.open():", err);
            reject(err);
        }
    });

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

        console.log("[OneDrive] Loading OneDrive SDK...");
        await ensureOneDriveSdk();
        console.log("[OneDrive] SDK loaded, opening picker...");
        return await openOneDrivePicker(config);
    },
});
