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

declare const tinymce: any;

const PLUGIN_NAME = "multicloud";

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const PROVIDER_LOGOS: Record<string, string> = {
    googleDrive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.3 78" width="40" height="36"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>`,
    oneDrive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 28" width="40" height="28"><ellipse cx="10" cy="18" rx="9" ry="8" fill="#0078D4"/><ellipse cx="22" cy="12" rx="11" ry="10" fill="#0078D4"/><ellipse cx="32" cy="18" rx="8" ry="7" fill="#0078D4"/><rect x="2" y="18" width="36" height="9" rx="1" fill="#0078D4"/></svg>`,
    dropbox: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 174" width="40" height="35"><polygon points="50,0 100,35 50,70 0,35" fill="#0061FF"/><polygon points="150,0 200,35 150,70 100,35" fill="#0061FF"/><polygon points="50,70 100,105 50,140 0,105" fill="#0061FF"/><polygon points="150,70 200,105 150,140 100,105" fill="#0061FF"/><polygon points="100,105 150,140 100,175 50,140" fill="#0061FF"/></svg>`,
    bayerncloud: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40"><circle cx="32" cy="32" r="32" fill="#0082C9"/><path d="M32 14c-6 0-11 3.8-13 9.1C17.7 22.4 16.4 22 15 22c-4.4 0-8 3.6-8 8s3.6 8 8 8h34c3.9 0 7-3.1 7-7s-3.1-7-7-7l-0.5 0C47.2 18.4 40 14 32 14z" fill="white"/></svg>`,
};

const getProviderLogoHtml = (id: string, label: string): string => {
    if (PROVIDER_LOGOS[id]) return PROVIDER_LOGOS[id];
    const initials = escapeHtml(label.slice(0, 2).toUpperCase());
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="20" fill="#666"/><text x="20" y="26" text-anchor="middle" font-size="16" font-weight="bold" fill="white" font-family="sans-serif">${initials}</text></svg>`;
};

const buildProviderButtonsHtml = (
    providers: CloudProvider[],
    selectedId: string,
    handlerName: string,
): string => {
    const css = `<style>.mc-provider-grid{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:6px 0 2px;}.mc-provider-btn{display:flex!important;flex-direction:column;align-items:center;padding:.5em!important;border:2px solid #d0d0d0!important;border-radius:.5em!important;background:#fff!important;cursor:pointer;box-shadow:0 0 .5em rgba(0,0,0,.5)!important;transition:border-color .25s,background .25s,box-shadow .25s;}.mc-provider-btn:hover{border-color:#1a73e8!important;background:#f0f7ff!important;box-shadow:0 0 .75em rgba(26,115,232,.5)!important;}.mc-provider-btn.mc-selected{border-color:#1a73e8!important;background:#e8f0fe!important;}</style>`;
    const buttons = providers.map((p) => {
        const sel = p.id === selectedId ? " mc-selected" : "";
        return `<button type="button" class="mc-provider-btn${sel}" data-provider="${escapeHtml(p.id)}" onclick="window.${handlerName}('${escapeHtml(p.id)}')" title="${escapeHtml(p.label)}">${getProviderLogoHtml(p.id, p.label)}</button>`;
    }).join("");
    return `${css}<div class="mc-provider-grid">${buttons}</div>`;
};

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

    if (mode === "embed") {
        const isVideo =
            item.mimeType?.startsWith("video/") ||
            /\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv)$/i.test(item.name || item.url);
        if (isVideo) {
            editor.insertContent(
                `<video src="${safeEmbed}" title="${safeName}" width="800" height="450" controls style="max-width: 100%;"></video>`,
            );
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

const resolveActiveProviders = (
    allProviders: CloudProvider[],
    providerConfigById: Partial<Record<CloudProviderId, ProviderRuntimeConfig>>,
): CloudProvider[] =>
    allProviders.filter((provider) => providerConfigById[provider.id]?.enabled !== false);

const pickAndInsert = async (
    editor: any,
    provider: CloudProvider,
    pluginUrl: string,
    forceLinkMode: boolean = false,
): Promise<void> => {
    const options = getOptions(editor);
    const providerConfig = options.providers?.[provider.id] || {};

    try {
        console.log("Calling provider.pick for:", provider.id);
        const result = await provider.pick({
            editor,
            pluginUrl,
            options,
            providerConfig,
        });

        console.log("Provider.pick returned:", result);

        if (!result) {
            console.log("No result from picker, aborting");
            return;
        }

        // Only show progress state when actually processing/inserting
        editor.setProgressState(true);

        console.log("Validating result...");
        const validatedResult = validatePickerResultBoundary(provider.id, result);
        console.log("Validated result:", validatedResult);

        // Override mode to "link" if user requested it
        if (forceLinkMode) {
            validatedResult.mode = "link";
            console.log("Forcing link mode as requested");
        }

        console.log("Inserting into editor...");
        insertResult(editor, validatedResult, options.defaultInsertMode || "link");
        console.log("Insert complete");
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Cloud picker failed unexpectedly.";

        editor.notificationManager.open({
            type: "error",
            text: message,
        });
    } finally {
        editor.setProgressState(false);
    }
};

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
            text: `${provider.label} does not support file uploads.`,
        });
        return;
    }

    const options = getOptions(editor);
    const providerConfig = options.providers?.[provider.id] || {};

    try {
        console.log("Uploading file:", file.name);
        const result = await provider.upload({
            editor,
            pluginUrl,
            options,
            providerConfig,
        }, file);

        console.log("Upload returned:", result);

        if (!result) {
            console.log("No result from upload, aborting");
            return;
        }

        // Only show progress state when actually processing/inserting
        editor.setProgressState(true);

        console.log("Validating result...");
        const validatedResult = validatePickerResultBoundary(provider.id, result);
        console.log("Validated result:", validatedResult);

        // Override mode to "link" if user requested it
        if (forceLinkMode) {
            validatedResult.mode = "link";
            console.log("Forcing link mode as requested");
        }

        console.log("Inserting into editor...");
        insertResult(editor, validatedResult, options.defaultInsertMode || "link");
        console.log("Insert complete");
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Cloud upload failed unexpectedly.";

        editor.notificationManager.open({
            type: "error",
            text: message,
        });
    } finally {
        editor.setProgressState(false);
    }
};

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
            text: "No cloud providers support file uploads.",
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
        document.querySelectorAll(".mc-provider-btn").forEach((btn) => {
            btn.classList.toggle("mc-selected", (btn as HTMLElement).dataset.provider === id);
        });
        const fileSection = document.getElementById("mc-file-section");
        if (fileSection) {
            fileSection.style.display = providerUsesPicker(id) ? "none" : "";
        }
    };

    editor.windowManager.open({
        title: "Upload to Cloud",
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
                    label: "Insert as link only (don't embed images/documents)",
                },
            ],
        },
        initialData: {
            insertAsLink: false,
        },
        buttons: [
            { type: "cancel", text: "Cancel" },
            { type: "submit", text: "Upload", primary: true },
        ],
        onSubmit: (api: any) => {
            const data = api.getData();
            const provider = uploadProviders.find((p) => p.id === selectedProvider);

            if (!provider) {
                editor.notificationManager.open({
                    type: "warning",
                    text: "No provider selected.",
                });
                return;
            }

            if (providerUsesPicker(provider.id)) {
                api.close();
                void pickAndInsert(editor, provider, pluginUrl, data.insertAsLink);
                return;
            }

            const fileInput = document.getElementById("multicloud-file-input") as HTMLInputElement;
            const file = fileInput?.files?.[0];

            if (!file) {
                editor.notificationManager.open({
                    type: "warning",
                    text: "No file selected.",
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
        document.querySelectorAll(".mc-provider-btn").forEach((btn) => {
            btn.classList.toggle("mc-selected", (btn as HTMLElement).dataset.provider === id);
        });
    };

    editor.windowManager.open({
        title: options.dialogTitle || "Insert From Cloud",
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
                    label: "Insert as link only (don't embed images/documents)",
                },
            ],
        },
        initialData: {
            insertAsLink: false,
        },
        buttons: [
            { type: "cancel", text: "Cancel" },
            { type: "submit", text: "Browse", primary: true },
        ],
        onSubmit: (api: any) => {
            const data = api.getData();
            const provider = providers.find((p) => p.id === selectedProvider);
            api.close();

            if (!provider) {
                editor.notificationManager.open({
                    type: "warning",
                    text: "No provider selected.",
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

        const providers = resolveActiveProviders(
            builtInProviders(),
            getOptions(editor).providers || {},
        );

        const runPicker = () => {
            if (providers.length === 0) {
                editor.notificationManager.open({
                    type: "warning",
                    text: "No cloud providers are enabled.",
                });
                return;
            }

            openProviderDialog(editor, providers, pluginUrl);
        };

        const runUpload = () => {
            if (providers.length === 0) {
                editor.notificationManager.open({
                    type: "warning",
                    text: "No cloud providers are enabled.",
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
                url: "https://github.com/CallariS",
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
