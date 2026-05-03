import type { TinyMCE } from "tinymce";
import { builtInProviders } from "./providers";
import type {
    CloudProvider,
    CloudProviderId,
    InsertMode,
    MultiCloudPluginOptions,
    PickerResult,
    ProviderRuntimeConfig,
} from "./types";
import {
    validatePickerResultBoundary,
    validatePluginOptionsBoundary,
} from "./validation/boundary";

declare const tinymce: TinyMCE;

/** Registered plugin name used with `tinymce.PluginManager.add`. */
const PLUGIN_NAME = "multicloud";

/**
 * Custom provider registry. Providers added here are merged with the built-in
 * providers at plugin registration time. Keys are provider IDs; last write wins
 * for a given ID (allowing built-in providers to be overridden).
 *
 * @internal
 */
const customProviders: Map<string, CloudProvider> = new Map();

/**
 * Registers a custom cloud provider with the MultiCloud Plugin.
 *
 * Must be called **before** `tinymce.init()`. The provider is merged with the
 * built-in provider list and will appear in both the picker and upload dialogs
 * (if it implements `upload`). Registering a provider with the same `id` as a
 * built-in provider overrides the built-in one.
 *
 * @param provider - A {@link CloudProvider} implementation to register.
 *
 * @example
 * ```ts
 * registerProvider({
 *   id: 'myS3',
 *   label: 'Company S3',
 *   pick: async (ctx) => { ... },
 *   upload: async (ctx, file) => { ... },
 * });
 * tinymce.init({ plugins: 'multicloud', ... });
 * ```
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const registerProvider = (provider: CloudProvider): void => {
    customProviders.set(provider.id, provider);
};

/**
 * Removes a previously registered custom provider by its ID.
 *
 * Has no effect if the ID is not in the custom registry. Built-in providers
 * cannot be removed with this function; to disable a built-in provider set
 * `enabled: false` in its runtime config instead.
 *
 * @param id - The provider ID to remove.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const unregisterProvider = (id: string): void => {
    customProviders.delete(id);
};

/**
 * Escapes HTML special characters in a string to prevent XSS when injecting
 * values into HTML markup via string concatenation.
 *
 * @param value - Raw string to escape.
 * @returns HTML-safe string with `&`, `<`, `>`, `"`, and `'` replaced by their named entities.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

/**
 * Inline SVG markup for each built-in provider's logo, keyed by provider ID.
 * Used by {@link getProviderLogoHtml} to render icons in the picker dialog.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const PROVIDER_LOGOS: Record<string, string> = {
    googleDrive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.3 78" width="40" height="36"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>`,
    oneDrive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40"><path fill="#0078D4" d="M4.92 17.562c-.499.305-1.059.457-1.68.457-.92-.029-1.68-.346-2.287-.951-.607-.601-.922-1.367-.953-2.282.016-.862.291-1.594.83-2.192.54-.601 1.225-.948 2.058-1.05-.03-.178-.042-.367-.042-.566.03-1.14.42-2.084 1.17-2.819.754-.735 1.7-1.125 2.842-1.155.719 0 1.364.165 1.934.51.48-.766 1.096-1.395 1.861-1.859.779-.465 1.65-.705 2.609-.721 1.291.03 2.385.436 3.314 1.215.93.78 1.516 1.785 1.756 3.03h-.285c-.465 0-.869.06-1.23.194-.479-.51-1.035-.898-1.664-1.169-.615-.271-1.29-.39-2.011-.39-.66 0-1.29.104-1.89.33-.6.225-1.14.539-1.62.959-.42.36-.765.766-1.05 1.23s-.48.96-.585 1.485c-.36.075-.705.179-1.021.314-.51.239-.944.569-1.289 1.005-.33.375-.586.811-.75 1.305-.165.496-.256 1.006-.256 1.545 0 .6.091 1.156.301 1.666l-.062-.091zm16.848-3.747c1.576.391 2.318 1.32 2.225 2.781-.092 1.463-.943 2.287-2.555 2.471H8.7c-2.104-.277-3.138-1.365-3.102-3.263.034-1.905 1.104-2.954 3.21-3.135.275-2.04 1.316-3.3 3.12-3.78 1.806-.494 3.342.061 4.612 1.681.436-.36.986-.511 1.65-.466.668.045 1.234.181 1.697.436.6.314 1.08.765 1.396 1.336.313.568.479 1.215.479 1.919l.006.02z"/></svg>`,
    dropbox: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 174" width="40" height="35"><polygon points="50,0 100,35 50,70 0,35" fill="#0061FF"/><polygon points="150,0 200,35 150,70 100,35" fill="#0061FF"/><polygon points="50,70 100,105 50,140 0,105" fill="#0061FF"/><polygon points="150,70 200,105 150,140 100,105" fill="#0061FF"/><polygon points="100,105 150,140 100,175 50,140" fill="#0061FF"/></svg>`,
    bayerncloud: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 150 150" width="40" height="40"><defs><linearGradient id="nc-lg" gradientUnits="userSpaceOnUse" x1="18.23" y1="150" x2="150" y2="0"><stop offset="0" stop-color="#0082c9"/><stop offset="1" stop-color="#1cafff"/></linearGradient></defs><rect width="150" height="150" fill="url(#nc-lg)"/><path fill="#fff" d="m75.09 37.29c-11.81 0-21.81 8-24.91 18.85-2.7-5.75-8.54-9.78-15.26-9.78-9.25 0-16.86 7.61-16.86 16.86 0 9.25 7.61 16.86 16.86 16.86 6.73 0 12.57-4.03 15.26-9.78 3.1 10.84 13.11 18.85 24.91 18.85 11.72 0 21.67-7.89 24.85-18.61 2.75 5.62 8.51 9.54 15.15 9.54 9.25 0 16.86-7.61 16.86-16.86 0-9.25-7.61-16.86-16.86-16.86-6.63 0-12.4 3.92-15.15 9.54-3.1-10.84-13.05-18.12-24.86-18.12zm0 9.9c8.91 0 16.03 7.12 16.03 16.03 0 8.91-7.12 16.03-16.03 16.03-8.91 0-16.03-7.12-16.03-16.03 0-8.91 7.12-16.03 16.03-16.03zm-40.18 9.07c3.9 0 6.97 3.06 6.97 6.96 0 3.9-3.07 6.97-6.97 6.97-3.9 0-6.96-3.07-6.96-6.97 0-3.9 3.06-6.96 6.96-6.96zm80.17 0c3.9 0 6.97 3.06 6.97 6.96 0 3.9-3.07 6.97-6.97 6.97-3.9 0-6.96-3.07-6.96-6.97 0-3.9 3.06-6.96 6.96-6.96z"/></svg>`,
};

/**
 * Returns the SVG logo HTML for a provider. Falls back to a generated avatar SVG
 * showing the first two letters of the provider label when no logo is registered.
 *
 * @param id - Provider ID (used to look up {@link PROVIDER_LOGOS}).
 * @param label - Human-readable provider label, used to generate the fallback initials avatar.
 * @returns Raw SVG HTML string safe for injection into a TinyMCE `htmlpanel`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getProviderLogoHtml = (id: string, label: string): string => {
    if (PROVIDER_LOGOS[id]) return PROVIDER_LOGOS[id];
    const initials = escapeHtml(label.slice(0, 2).toUpperCase());
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="20" fill="#666"/><text x="20" y="26" text-anchor="middle" font-size="16" font-weight="bold" fill="white" font-family="sans-serif">${initials}</text></svg>`;
};

/**
 * Builds the HTML panel markup for the provider selection button grid shown inside
 * the TinyMCE picker and upload dialogs.
 *
 * Injects a `<style>` block with scoped CSS for the grid, then renders one button
 * per active provider. Each button calls a global handler by name on click so that
 * TinyMCE's sandboxed dialog context can communicate selection back to the plugin.
 *
 * @param providers - The list of active {@link CloudProvider} objects to render buttons for.
 * @param selectedId - Provider ID that should receive the `mc-selected` CSS class initially.
 * @param handlerName - Name of the global `window` function to invoke when a button is clicked (e.g. `"__mcSelectProvider"`).
 * @returns Raw HTML string safe for use in a TinyMCE `htmlpanel` item.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const buildProviderButtonsHtml = (
    providers: CloudProvider[],
    selectedId: string,
    handlerName: string,
): string => {
    const css = `<style>.mc-provider-grid{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:6px 0 2px;}.mc-provider-btn{display:flex!important;flex-direction:column;align-items:center;padding:.5em!important;border:1px solid #d0d0d0!important;border-radius:.5em!important;background:#fff!important;cursor:pointer!important;box-shadow:0 0 .25em rgba(0,0,0,.5)!important;transition:border-color .25s,background .25s,box-shadow .25s;outline:none!important;}.mc-provider-btn:hover{border-color:#1a73e8!important;background:#f0f7ff!important;box-shadow:0 0 .4em rgba(26,115,232,.5)!important;cursor:pointer!important;}.mc-provider-btn.mc-selected{border-color:#1a73e8!important;background:#e8f0fe!important;}@media(prefers-color-scheme:dark){.mc-provider-btn{border-color:#555!important;background:#2d2d2d!important;}.mc-provider-btn:hover{border-color:#5b9dff!important;background:#1a2a3a!important;box-shadow:0 0 .4em rgba(91,157,255,.5)!important;}.mc-provider-btn.mc-selected{border-color:#5b9dff!important;background:#1a2a4a!important;}}</style>`;
    const buttons = providers.map((p) => {
        const sel = p.id === selectedId ? " mc-selected" : "";
        return `<button type="button" class="mc-provider-btn${sel}" tabindex="0" data-provider="${escapeHtml(p.id)}" onclick="window['${handlerName}']('${escapeHtml(p.id)}')" title="${escapeHtml(p.label)}">${getProviderLogoHtml(p.id, p.label)}</button>`;
    }).join("");
    return `${css}<div class="mc-provider-grid">${buttons}</div>`;
};

/**
 * Reads and validates the plugin options from the TinyMCE editor's option registry.
 *
 * Collects all `multicloud_*` option values and runs them through
 * {@link validatePluginOptionsBoundary} (Zod schema) followed by the xdbc contract stack.
 *
 * @param editor - The TinyMCE editor instance.
 * @returns Validated {@link MultiCloudPluginOptions}.
 * @throws {DBC.Infringement} If any option fails its contract (unless soft logging mode is active
 *   via {@link configureMultiCloudValidation}).
 * @throws {ZodError} If the raw options object fails the Zod boundary schema.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const getOptions = (editor: any): MultiCloudPluginOptions => {
    const raw = {
        providers: editor.options.get("multicloud_providers") || {},
        defaultProvider: editor.options.get("multicloud_default_provider"),
        defaultInsertMode: editor.options.get("multicloud_default_insert_mode") || "link",
        dialogTitle: editor.options.get("multicloud_dialog_title") || "Insert From Cloud",
        popupTimeoutMs: editor.options.get("multicloud_popup_timeout_ms") || 120000,
    };

    return validatePluginOptionsBoundary(raw);
};

/**
 * Attaches a one-time `error` event listener to the last `<audio>` or `<video>` element
 * in the editor immediately after it is inserted.
 *
 * When the media element fails to load (e.g. because a freshly uploaded or shared file is
 * still being processed), it shows a TinyMCE warning notification that instructs the user
 * to wait and reload the page.
 *
 * Runs asynchronously via `setTimeout(..., 0)` to ensure the element is in the DOM first.
 * Any DOM or editor-state errors are silently swallowed because the editor may not be fully
 * ready at the moment this runs.
 *
 * @param editor - The TinyMCE editor instance.
 * @param tag - The media element tag to attach the error handler to (`"audio"` or `"video"`).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const attachMediaErrorHandler = (editor: any, tag: "audio" | "video"): void => {
    setTimeout(() => {
        try {
            const elements = editor.dom.select(tag) as HTMLMediaElement[];
            const el = elements[elements.length - 1];
            if (!el) return;
            el.addEventListener("error", () => {
                editor.notificationManager.open({
                    type: "warning",
                    text: editor.translate("Media could not be loaded. If you just uploaded or shared the file, it may still be processing \u2014 wait a moment and reload the page."),
                    timeout: 8000,
                });
            }, { once: true });
        } catch {
            // ignore — editor may not be ready yet
        }
    }, 0);
};

/**
 * Inserts the picker result into the TinyMCE editor using the appropriate HTML element
 * determined by the resolved insert mode.
 *
 * Insert mode resolution order:
 * 1. `result.mode` (set by the provider)
 * 2. `defaultInsertMode` (from plugin options)
 *
 * Behaviour per mode:
 * - `"image"` — inserts `<img src="...">` using `item.url`.
 * - `"audio"` — inserts `<audio>` with `item.downloadUrl` if available, otherwise an `<iframe>` preview.
 * - `"embed"` — inserts `<video>` with `item.downloadUrl` for video MIME types, `<iframe>` otherwise.
 * - `"link"` (default) — inserts `<a href="...">` using any selected editor text as the link label.
 *
 * All values are HTML-escaped before injection.
 *
 * @param editor - The TinyMCE editor instance.
 * @param result - The validated {@link PickerResult} from the provider.
 * @param defaultInsertMode - Fallback {@link InsertMode} when `result.mode` is not set.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const insertResult = (
    editor: any,
    result: PickerResult,
    defaultInsertMode: InsertMode,
): void => {
    const mode = result.mode || defaultInsertMode;
    const item = result.item;
    const safeName = escapeHtml(item.name || item.url);
    const safeUrl = escapeHtml(item.url);
    const safeEmbed = escapeHtml(item.embedUrl || item.url);

    if (mode === "image") {
        editor.insertContent(`<img src="${safeUrl}" alt="${safeName}" />`);
        return;
    }

    if (mode === "audio") {
        if (item.downloadUrl) {
            const safeDownload = escapeHtml(item.downloadUrl);
            editor.insertContent(
                `<audio src="${safeDownload}" title="${safeName}" controls style="max-width: 100%;"></audio>`,
            );
            attachMediaErrorHandler(editor, "audio");
        } else {
            // No direct download URL (e.g. Google Drive) — use embed/preview iframe with built-in player
            editor.insertContent(
                `<iframe src="${safeEmbed}" title="${safeName}" width="800" height="120" frameborder="0" style="max-width: 100%;" loading="lazy" allowfullscreen></iframe>`,
            );
        }
        return;
    }

    if (mode === "embed") {
        const isVideo =
            item.mimeType?.startsWith("video/") ||
            /\.(mp4|webm|ogg|mov|m4v|avi|wmv|flv|mkv)$/i.test(item.name || item.url);
        if (isVideo) {
            if (item.downloadUrl) {
                const safeDownload = escapeHtml(item.downloadUrl);
                editor.insertContent(
                    `<video src="${safeDownload}" title="${safeName}" width="800" height="450" controls style="max-width: 100%;"></video>`,
                );
                attachMediaErrorHandler(editor, "video");
            } else {
                // No direct download URL (e.g. Google Drive) — use embed/preview iframe
                editor.insertContent(
                    `<iframe src="${safeEmbed}" title="${safeName}" width="800" height="450" frameborder="0" style="max-width: 100%;" loading="lazy" allow="autoplay" allowfullscreen></iframe>`,
                );
            }
        } else {
            editor.insertContent(
                `<iframe src="${safeEmbed}" title="${safeName}" width="800" height="500" frameborder="0" style="max-width: 100%;" loading="lazy" allowfullscreen></iframe>`,
            );
        }
        return;
    }

    const selectedText = editor.selection.getContent({ format: "text" }).trim();
    const linkText = escapeHtml(selectedText || item.name || item.url);
    editor.insertContent(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
};

/**
 * When an SVG is picked from a provider that cannot serve raw SVG (e.g. Google Drive, Dropbox),
 * presents a TinyMCE dialog asking the user to choose between a viewer iframe (vector quality)
 * or a rasterized `<img>` (lower quality, more portable).
 *
 * @param editor - The TinyMCE editor instance.
 * @param result - The original {@link PickerResult} for the SVG file.
 * @param rasterUrl - URL of a rasterized fallback image (e.g. a Google Drive thumbnail endpoint).
 * @returns A promise that resolves to the (possibly modified) {@link PickerResult} on confirm,
 *   or `null` if the user cancelled the dialog.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const promptSvgInsertMode = (
    editor: any,
    result: PickerResult,
    rasterUrl: string,
): Promise<PickerResult | null> =>
    new Promise((resolve) => {
        editor.windowManager.open({
            title: editor.translate("Insert SVG"),
            size: "normal",
            body: {
                type: "panel",
                items: [
                    {
                        type: "alertbanner",
                        level: "info",
                        text: editor.translate("SVG files cannot be served as raw vector from this provider. Choose how to insert it:"),
                        icon: "info",
                    },
                    {
                        type: "selectbox",
                        name: "svgMode",
                        label: editor.translate("Insert as"),
                        items: [
                            { value: "embed", text: editor.translate("Viewer (vector quality, requires internet)") },
                            { value: "image", text: editor.translate("Rasterized image (lower quality, more portable)") },
                        ],
                    },
                ],
            },
            initialData: { svgMode: "embed" },
            buttons: [
                { type: "cancel", text: editor.translate("Cancel") },
                { type: "submit", text: editor.translate("Insert"), primary: true },
            ],
            onSubmit(api: any) {
                const data = api.getData();
                api.close();
                if (data.svgMode === "image") {
                    resolve({
                        ...result,
                        item: { ...result.item, url: rasterUrl },
                        mode: "image" as InsertMode,
                    });
                } else {
                    resolve({ ...result, mode: "embed" as InsertMode });
                }
            },
            onCancel() {
                resolve(null);
            },
        });
    });

/**
 * Filters the full list of built-in providers down to only those that are not explicitly
 * disabled (`enabled !== false`) in the plugin configuration.
 *
 * @param allProviders - All registered {@link CloudProvider} instances.
 * @param providerConfigById - Map of provider ID to its runtime configuration from plugin options.
 * @returns The subset of providers that should be shown to the user.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const resolveActiveProviders = (
    allProviders: CloudProvider[],
    providerConfigById: Partial<Record<CloudProviderId, ProviderRuntimeConfig>>,
): CloudProvider[] =>
    allProviders.filter((provider) => providerConfigById[provider.id]?.enabled !== false);

/**
 * Invokes the given provider's `pick` method, validates the result, optionally handles
 * SVG insert-mode disambiguation, and inserts the final content into the editor.
 *
 * Progress state (`editor.setProgressState`) is shown only after the picker returns a result,
 * so the spinner does not block the interactive picker UI.
 *
 * @param editor - The TinyMCE editor instance.
 * @param provider - The {@link CloudProvider} whose picker to invoke.
 * @param pluginUrl - Absolute URL of the plugin bundle directory (used to resolve default picker pages).
 * @param forceLinkMode - When `true`, overrides the result mode to `"link"` regardless of the provider's suggestion.
 * @returns A promise that resolves when the content has been inserted (or the operation was cancelled/failed).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const pickAndInsert = async (
    editor: any,
    provider: CloudProvider,
    pluginUrl: string,
    forceLinkMode: boolean = false,
): Promise<void> => {
    const options = getOptions(editor);
    const providerConfig = options.providers?.[provider.id] || {};

    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Calling provider.pick for:", provider.id, "]");
        const result = await provider.pick({
            editor,
            pluginUrl,
            options,
            providerConfig,
        });

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Provider.pick returned:", result, "]");

        if (!result) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] No result from picker, aborting ]");
            return;
        }

        // Only show progress state when actually processing/inserting
        editor.setProgressState(true);

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Validating result... ]");
        const validatedResult = validatePickerResultBoundary(provider.id, result);
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Validated result:", validatedResult, "]");

        // Override mode to "link" if user requested it
        if (forceLinkMode) {
            validatedResult.mode = "link";
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Forcing link mode as requested ]");
        }

        // For SVG files from providers that cannot serve raw SVG, prompt the user
        const isSvg = /\.svg$/i.test(validatedResult.item.name || "") ||
            validatedResult.item.mimeType === "image/svg+xml";
        const hasViewerEmbed = !!validatedResult.item.embedUrl;
        if (!forceLinkMode && isSvg && hasViewerEmbed && validatedResult.mode !== "link") {
            editor.setProgressState(false);
            // Google Drive: use thumbnail endpoint for raster fallback
            // Other providers (e.g. Dropbox): the item URL itself is the raw file URL
            const isGoogleDrive = validatedResult.item.embedUrl?.includes("drive.google.com") ?? false;
            const rasterUrl = isGoogleDrive
                ? `https://drive.google.com/thumbnail?id=${validatedResult.item.id}&sz=w2000`
                : validatedResult.item.url;
            const chosen = await promptSvgInsertMode(editor, validatedResult, rasterUrl);
            if (!chosen) return;
            editor.setProgressState(true);
            insertResult(editor, chosen, options.defaultInsertMode || "link");
        } else {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Inserting into editor... ]");
            insertResult(editor, validatedResult, options.defaultInsertMode || "link");
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Insert complete ]");
        }
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : editor.translate("Cloud picker failed unexpectedly.");

        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] pickAndInsert error:", error, "]");
        editor.notificationManager.open({
            type: "error",
            text: message,
        });
    } finally {
        editor.setProgressState(false);
    }
};

/**
 * Invokes the given provider's `upload` method with the supplied file, validates the result,
 * and inserts the final content into the editor.
 *
 * Shows a TinyMCE warning notification if the provider does not support file uploads.
 *
 * @param editor - The TinyMCE editor instance.
 * @param provider - The {@link CloudProvider} whose upload method to invoke.
 * @param pluginUrl - Absolute URL of the plugin bundle directory.
 * @param file - The `File` object to upload. Pass an empty `new File([], "")` when the provider
 *   manages file selection via its own picker URL.
 * @param forceLinkMode - When `true`, overrides the result mode to `"link"`.
 * @returns A promise that resolves when the content has been inserted (or the operation was cancelled/failed).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const uploadAndInsert = async (
    editor: any,
    provider: CloudProvider,
    pluginUrl: string,
    file: File,
    forceLinkMode: boolean = false,
): Promise<void> => {
    if (!provider.upload) {
        editor.notificationManager.open({
            type: "warning",
            text: editor.translate(["{#} does not support file uploads.", provider.label]),
        });
        return;
    }

    const options = getOptions(editor);
    const providerConfig = options.providers?.[provider.id] || {};

    try {
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Uploading file:", file.name, "]");
        const result = await provider.upload({
            editor,
            pluginUrl,
            options,
            providerConfig,
        }, file);

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Upload returned:", result, "]");

        if (!result) {
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] No result from upload, aborting ]");
            return;
        }

        // Only show progress state when actually processing/inserting
        editor.setProgressState(true);

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Validating result... ]");
        const validatedResult = validatePickerResultBoundary(provider.id, result);
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Validated result:", validatedResult, "]");

        // Override mode to "link" if user requested it
        if (forceLinkMode) {
            validatedResult.mode = "link";
            console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Forcing link mode as requested ]");
        }

        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Inserting into editor... ]");
        insertResult(editor, validatedResult, options.defaultInsertMode || "link");
        console.info("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] Insert complete ]");
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : editor.translate("Cloud upload failed unexpectedly.");

        console.error("[[ WaXCode / TinyMCE Multicloud Plugin / Plugin ] uploadAndInsert error:", error, "]");
        editor.notificationManager.open({
            type: "error",
            text: message,
        });
    } finally {
        editor.setProgressState(false);
    }
};

/**
 * Opens the TinyMCE "Upload to Cloud" dialog.
 *
 * Renders a provider selection grid (for upload-capable providers only) and a file input.
 * When the selected provider uses a `pickerUrl`, the file input is hidden because the provider
 * handles file selection internally through its own popup page.
 *
 * The global function `window.__mcSelectUploadProvider` is registered for the duration of the
 * dialog to receive provider-switch events from the HTML panel's inline `onclick` handlers.
 *
 * @param editor - The TinyMCE editor instance.
 * @param providers - All currently active {@link CloudProvider} objects (will be filtered to upload-capable ones).
 * @param pluginUrl - Absolute URL of the plugin bundle directory.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const openUploadDialog = (
    editor: any,
    providers: CloudProvider[],
    pluginUrl: string,
): void => {
    const options = getOptions(editor);
    const uploadProviders = providers.filter((p) => p.upload);

    if (uploadProviders.length === 0) {
        editor.notificationManager.open({
            type: "warning",
            text: editor.translate("No cloud providers support file uploads."),
        });
        return;
    }

    const initialProvider =
        options.defaultProvider && uploadProviders.some((provider) => provider.id === options.defaultProvider)
            ? options.defaultProvider
            : uploadProviders[0].id;

    const providerUsesPicker = (providerId: string): boolean => {
        const providerConfig = options.providers?.[providerId];
        return !!providerConfig?.pickerUrl;
    };

    let selectedProvider = initialProvider;

    (window as any).__mcSelectUploadProvider = (id: string) => {
        selectedProvider = id;
        document.querySelectorAll<HTMLElement>(".mc-provider-btn").forEach((btn) => {
            btn.classList.toggle("mc-selected", btn.dataset.provider === id);
        });
        const fileSection = document.getElementById("mc-file-section");
        if (fileSection) {
            fileSection.style.display = providerUsesPicker(id) ? "none" : "";
        }
    };

    editor.windowManager.open({
        title: editor.translate("Upload to Cloud"),
        body: {
            type: "panel",
            items: [
                {
                    type: "htmlpanel",
                    html: buildProviderButtonsHtml(uploadProviders, initialProvider, "__mcSelectUploadProvider"),
                },
                {
                    type: "htmlpanel",
                    html: `<div id="mc-file-section"${providerUsesPicker(initialProvider) ? ' style="display:none"' : ""}><input type="file" id="multicloud-file-input" style="width:100%;padding:8px;box-sizing:border-box;margin-top:4px;" /></div>`,
                },
                {
                    type: "checkbox",
                    name: "insertAsLink",
                    label: editor.translate("Insert as link only (don't embed images/documents)"),
                },
            ],
        },
        initialData: {
            insertAsLink: false,
        },
        buttons: [
            { type: "cancel", text: editor.translate("Cancel") },
            { type: "submit", text: editor.translate("Upload"), primary: true },
        ],
        onSubmit: (api: any) => {
            const data = api.getData();
            const provider = uploadProviders.find((p) => p.id === selectedProvider);

            if (!provider) {
                editor.notificationManager.open({
                    type: "warning",
                    text: editor.translate("No provider selected."),
                });
                return;
            }

            if (providerUsesPicker(provider.id)) {
                api.close();
                // Provider handles file selection in its own popup (upload mode)
                void uploadAndInsert(editor, provider, pluginUrl, new File([], ""), data.insertAsLink);
                return;
            }

            const fileInput = document.getElementById("multicloud-file-input") as HTMLInputElement;
            const file = fileInput?.files?.[0];

            if (!file) {
                editor.notificationManager.open({
                    type: "warning",
                    text: editor.translate("No file selected."),
                });
                return;
            }

            api.close();
            void uploadAndInsert(editor, provider, pluginUrl, file, data.insertAsLink);
        },
        onClose: () => {
            delete (window as any).__mcSelectUploadProvider;
        },
    });
};

/**
 * Opens the TinyMCE "Insert From Cloud" picker dialog.
 *
 * When only one provider is active, the dialog is skipped and `pickAndInsert` is called
 * directly. Otherwise, a provider selection grid is shown.
 *
 * The global function `window.__mcSelectProvider` is registered for the duration of the
 * dialog to receive provider-switch events from the HTML panel's inline `onclick` handlers.
 *
 * @param editor - The TinyMCE editor instance.
 * @param providers - The active {@link CloudProvider} objects to present.
 * @param pluginUrl - Absolute URL of the plugin bundle directory.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const openProviderDialog = (
    editor: any,
    providers: CloudProvider[],
    pluginUrl: string,
): void => {
    const options = getOptions(editor);

    if (providers.length === 1) {
        void pickAndInsert(editor, providers[0], pluginUrl);
        return;
    }

    const initialProvider =
        options.defaultProvider && providers.some((provider) => provider.id === options.defaultProvider)
            ? options.defaultProvider
            : providers[0].id;

    let selectedProvider = initialProvider;

    (window as any).__mcSelectProvider = (id: string) => {
        selectedProvider = id;
        document.querySelectorAll<HTMLElement>(".mc-provider-btn").forEach((btn) => {
            btn.classList.toggle("mc-selected", btn.dataset.provider === id);
        });
    };

    editor.windowManager.open({
        title: editor.translate(options.dialogTitle || "Insert From Cloud"),
        body: {
            type: "panel",
            items: [
                {
                    type: "htmlpanel",
                    html: buildProviderButtonsHtml(providers, initialProvider, "__mcSelectProvider"),
                },
                {
                    type: "checkbox",
                    name: "insertAsLink",
                    label: editor.translate("Insert as link only (don't embed images/documents)"),
                },
            ],
        },
        initialData: {
            insertAsLink: false,
        },
        buttons: [
            { type: "cancel", text: editor.translate("Cancel") },
            { type: "submit", text: editor.translate("Browse"), primary: true },
        ],
        onSubmit: (api: any) => {
            const data = api.getData();
            const provider = providers.find((p) => p.id === selectedProvider);
            api.close();

            if (!provider) {
                editor.notificationManager.open({
                    type: "warning",
                    text: editor.translate("No provider selected."),
                });
                return;
            }

            void pickAndInsert(editor, provider, pluginUrl, data.insertAsLink);
        },
        onClose: () => {
            delete (window as any).__mcSelectProvider;
        },
    });
};

/**
 * Registers the plugin with TinyMCE's plugin manager and sets up all option declarations,
 * toolbar buttons, and menu items.
 *
 * Registered TinyMCE options:
 * - `multicloud_providers` (object) — map of provider ID to runtime config.
 * - `multicloud_default_provider` (string) — ID of the initially selected provider.
 * - `multicloud_default_insert_mode` (string) — fallback insert mode (`"link"` | `"image"` | `"embed"`).
 * - `multicloud_dialog_title` (string) — title of the picker dialog.
 * - `multicloud_popup_timeout_ms` (number) — global popup timeout in milliseconds.
 *
 * Registered UI elements:
 * - `multicloud` button + menu item — triggers {@link openProviderDialog}.
 * - `multicloud_upload` button + menu item — triggers {@link openUploadDialog}.
 *
 * Called once at module load time.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
const register = (): void => {
    tinymce.PluginManager.add(PLUGIN_NAME, (editor: any, pluginUrl: string) => {
        editor.options.register("multicloud_providers", {
            processor: "object",
            default: {},
        });

        editor.options.register("multicloud_default_provider", {
            processor: "string",
            default: "",
        });

        editor.options.register("multicloud_default_insert_mode", {
            processor: "string",
            default: "link",
        });

        editor.options.register("multicloud_dialog_title", {
            processor: "string",
            default: "Insert From Cloud",
        });

        editor.options.register("multicloud_popup_timeout_ms", {
            processor: "number",
            default: 120000,
        });

        const allProviders: CloudProvider[] = [
            ...builtInProviders().filter((p) => !customProviders.has(p.id)),
            ...Array.from(customProviders.values()),
        ];

        const providers = resolveActiveProviders(
            allProviders,
            getOptions(editor).providers || {},
        );

        const runPicker = () => {
            if (providers.length === 0) {
                editor.notificationManager.open({
                    type: "warning",
                    text: editor.translate("No cloud providers are enabled."),
                });
                return;
            }

            openProviderDialog(editor, providers, pluginUrl);
        };

        const runUpload = () => {
            if (providers.length === 0) {
                editor.notificationManager.open({
                    type: "warning",
                    text: editor.translate("No cloud providers are enabled."),
                });
                return;
            }

            openUploadDialog(editor, providers, pluginUrl);
        };

        editor.ui.registry.addButton("multicloud", {
            icon: "browse",
            tooltip: "Insert From Cloud",
            onAction: runPicker,
        });

        editor.ui.registry.addMenuItem("multicloud", {
            icon: "browse",
            text: "Insert From Cloud",
            onAction: runPicker,
        });

        editor.ui.registry.addButton("multicloud_upload", {
            icon: "upload",
            tooltip: "Upload to Cloud",
            onAction: runUpload,
        });

        editor.ui.registry.addMenuItem("multicloud_upload", {
            icon: "upload",
            text: "Upload to Cloud",
            onAction: runUpload,
        });

        return {
            getMetadata: () => ({
                name: "TinyMCE MultiCloud Plugin",
                url: "https://github.com/CallariS/tinymce-multicloud-plugin",
            }),
        };
    });
};

register();

export type {
    CloudProvider,
    CloudProviderId,
    InsertMode,
    MultiCloudPluginOptions,
    PickerResult,
    ProviderRuntimeConfig,
} from "./types";

export { configureMultiCloudValidation } from "./validation/config/validators";
