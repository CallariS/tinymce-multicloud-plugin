import type {
    CloudProvider,
    DropboxProviderConfig,
    PickerResult,
} from "../types";
import { createPopupProvider } from "./popupProvider";
import { detectInsertMode, loadScript } from "./utils";

declare global {
    interface Window {
        Dropbox: any;
    }
}

const DROPBOX_DROPINS = "https://www.dropbox.com/static/api/2/dropins.js";

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

                const result: PickerResult = {
                    item: {
                        id: first.id || first.name,
                        name: first.name || "Dropbox file",
                        url: first.link,
                        thumbnailUrl: first.thumbnailLink,
                    },
                    mode: detectInsertMode({
                        id: first.id || first.name,
                        name: first.name || "Dropbox file",
                        url: first.link,
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
});
