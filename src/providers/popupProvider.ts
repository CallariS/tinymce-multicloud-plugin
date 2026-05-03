import type {
    CloudProvider,
    CloudProviderId,
    PickerMessage,
    PickerResult,
} from "../types";

/** Default `window.open` features string for picker popups. */
const DEFAULT_POPUP_FEATURES = "popup=yes,width=1120,height=760,resizable=yes,scrollbars=yes";

/**
 * Opens a popup window at the given URL.
 *
 * @param url - Absolute URL to open in the popup.
 * @param features - `window.open` features string controlling popup size and chrome.
 * @returns The `Window` object for the opened popup.
 * @throws {Error} If the browser blocked the popup (e.g. no prior user gesture).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const openPopup = (url: string, features: string): Window => {
    const popup = window.open(url, "tinymce_multicloud_picker", features);

    if (!popup) {
        throw new Error("Popup could not be opened. Allow popups for this site.");
    }

    return popup;
};

/**
 * Returns a promise that resolves (or rejects) when the popup picker page sends a
 * {@link PickerMessage} via `window.postMessage`.
 *
 * Messages are filtered by both `source === "tinymce-multicloud-plugin"` and the
 * expected `providerId` to prevent cross-provider or unrelated message interference.
 *
 * @param providerId - The provider ID to wait for. Messages from other providers are ignored.
 * @param timeoutMs - Maximum wait time in milliseconds. Rejects with a timeout error if no
 *   valid message arrives within this window.
 * @returns A promise resolving to the {@link PickerResult} on success, or `null` on cancellation.
 * @throws {Error} If the picker timed out or returned a message without a file URL.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

/**
 * Creates a {@link CloudProvider} that delegates all file selection to an external popup page
 * communicating via the {@link PickerMessage} `postMessage` protocol.
 *
 * This is both the fallback mechanism for every built-in provider (when `pickerUrl` is set
 * in the runtime config) and the sole mechanism for providers that have no built-in SDK mode.
 *
 * URL resolution order for the picker page:
 * 1. Absolute `http(s)://...` URL — used as-is.
 * 2. Relative `./` or `../` URL — resolved against the current page (`window.location.href`).
 * 3. Other relative path — resolved against `context.pluginUrl` (the plugin bundle directory).
 * 4. No `pickerUrl` in config — `defaultPickerPath` appended to `context.pluginUrl`.
 *
 * @param id - Provider ID for this popup provider.
 * @param label - Human-readable label shown in the picker dialog.
 * @param defaultPickerPath - Path appended to `context.pluginUrl` when no `pickerUrl` override is configured
 *   (e.g. `"/pickers/dropbox.html"`).
 * @returns A {@link CloudProvider} whose `pick` method opens a popup and awaits a `postMessage` result.
 *
 * @throws {Error} If the popup is blocked by the browser.
 * @throws {Error} If the picker times out or returns a message without a file URL.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
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

        // Resolve picker URL
        let pickerUrl: string;
        if (context.providerConfig.pickerUrl) {
            const configUrl = context.providerConfig.pickerUrl;
            if (configUrl.startsWith("http")) {
                // Absolute URL
                pickerUrl = configUrl;
            } else if (configUrl.startsWith("./") || configUrl.startsWith("../")) {
                // Relative to current page
                pickerUrl = new URL(configUrl, window.location.href).toString();
            } else {
                // Relative to plugin URL
                pickerUrl = new URL(configUrl, context.pluginUrl).toString();
            }
        } else {
            // Use default picker path relative to plugin URL
            pickerUrl = `${context.pluginUrl.replace(/\/$/, "")}${defaultPickerPath}`;
        }

        openPopup(pickerUrl, popupFeatures);

        return await awaitPickerMessage(id, timeoutMs);
    },
});
