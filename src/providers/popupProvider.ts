import type {
    CloudProvider,
    CloudProviderId,
    PickerMessage,
    PickerResult,
} from "../types";

const DEFAULT_POPUP_FEATURES = "popup=yes,width=1120,height=760,resizable=yes,scrollbars=yes";

const openPopup = (url: string, features: string): Window => {
    const popup = window.open(url, "tinymce_multicloud_picker", features);

    if (!popup) {
        throw new Error("Popup could not be opened. Allow popups for this site.");
    }

    return popup;
};

const awaitPickerMessage = (
    providerId: CloudProviderId,
    timeoutMs: number,
): Promise<PickerResult | null> =>
    new Promise((resolve, reject) => {
        let timeoutRef: number | undefined;

        const cleanup = () => {
            window.removeEventListener("message", onMessage);
            if (typeof timeoutRef === "number") {
                window.clearTimeout(timeoutRef);
            }
        };

        const onMessage = (event: MessageEvent) => {
            const message = event.data as PickerMessage;
            if (!message || message.source !== "tinymce-multicloud-plugin") {
                return;
            }
            if (message.providerId !== providerId) {
                return;
            }

            cleanup();

            if (message.type === "cancelled") {
                resolve(null);
                return;
            }

            if (!message.payload?.item?.url) {
                reject(new Error("Picker returned no file URL."));
                return;
            }

            resolve(message.payload);
        };

        window.addEventListener("message", onMessage);

        timeoutRef = window.setTimeout(() => {
            cleanup();
            reject(new Error("Picker timed out."));
        }, timeoutMs);
    });

export const createPopupProvider = (
    id: CloudProviderId,
    label: string,
    defaultPickerPath: string,
): CloudProvider => ({
    id,
    label,
    pick: async (context) => {
        const timeoutMs =
            context.providerConfig.timeoutMs ??
            context.options.popupTimeoutMs ??
            120000;
        const popupFeatures =
            context.providerConfig.popupFeatures ?? DEFAULT_POPUP_FEATURES;
        const pickerUrl =
            context.providerConfig.pickerUrl ??
            `${context.pluginUrl.replace(/\/$/, "")}${defaultPickerPath}`;

        openPopup(pickerUrl, popupFeatures);

        return await awaitPickerMessage(id, timeoutMs);
    },
});
