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
        editor.insertContent(
            `<iframe src="${safeEmbed}" title="${safeName}" width="800" height="500" frameborder="0" style="max-width: 100%;" loading="lazy" allowfullscreen></iframe>`,
        );
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



    // Helper to determine if provider uses a picker for upload (e.g., Nextcloud)

    function providerUsesPicker(providerId: string) {
        // Hide file input for any provider with a pickerUrl in config
        const providerConfig = options.providers?.[providerId];
        return !!providerConfig?.pickerUrl;
    }

    // Helper to build dialog items based on provider
    function getDialogItems(selectedProviderId: string) {
        const items = [
            {
                type: "selectbox",
                name: "provider",
                label: "Provider",
                items: uploadProviders.map((provider) => ({
                    text: provider.label,
                    value: provider.id,
                })),
            },
        ];
        if (!providerUsesPicker(selectedProviderId)) {
            items.push({
                type: "htmlpanel",
                name: "multicloud-file-input-panel",
                html: '<input type="file" id="multicloud-file-input" style="width: 100%; padding: 8px; box-sizing: border-box;" />',
            });
        }
        items.push({
            type: "checkbox",
            name: "insertAsLink",
            label: "Insert as link only (don\'t embed images/documents)",
        });
        return items;
    }

    function openUploadDialogWithProvider(selectedProviderId: string, insertAsLink: boolean = false) {
        const dialogApi = editor.windowManager.open({
            title: "Upload to Cloud",
            body: {
                type: "panel",
                items: getDialogItems(selectedProviderId),
            },
            initialData: {
                provider: selectedProviderId,
                insertAsLink,
            },
            buttons: [
                { type: "cancel", text: "Cancel" },
                { type: "submit", text: "Upload", primary: true },
            ],
            onAction: (api, details) => {
                if (details.name === "provider") {
                    // Get current insertAsLink value to preserve it
                    const data = api.getData();
                    api.close();
                    openUploadDialogWithProvider(details.value, data.insertAsLink);
                }
            },
            onSubmit: (api: any) => {
                const data = api.getData();
                const selectedProvider = uploadProviders.find(
                    (provider) => provider.id === data.provider,
                );

                if (!selectedProvider) {
                    editor.notificationManager.open({
                        type: "warning",
                        text: "No provider selected.",
                    });
                    return;
                }

                // If provider uses picker, skip file input and call pickAndInsert
                if (providerUsesPicker(selectedProvider.id)) {
                    api.close();
                    void pickAndInsert(editor, selectedProvider, pluginUrl, data.insertAsLink);
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
                void uploadAndInsert(editor, selectedProvider, pluginUrl, file, data.insertAsLink);
            },
        });
        dialogApi.focus("provider");
    }

    openUploadDialogWithProvider(initialProvider);
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

    const dialogApi = editor.windowManager.open({
        title: options.dialogTitle || "Insert From Cloud",
        body: {
            type: "panel",
            items: [
                {
                    type: "selectbox",
                    name: "provider",
                    label: "Provider",
                    items: providers.map((provider) => ({
                        text: provider.label,
                        value: provider.id,
                    })),
                },
                {
                    type: "checkbox",
                    name: "insertAsLink",
                    label: "Insert as link only (don't embed images/documents)",
                },
            ],
        },
        initialData: {
            provider: initialProvider,
            insertAsLink: false,
        },
        buttons: [
            { type: "cancel", text: "Cancel" },
            { type: "submit", text: "Browse", primary: true },
        ],
        onSubmit: (api: any) => {
            const data = api.getData();
            const selectedProvider = providers.find(
                (provider) => provider.id === data.provider,
            );
            api.close();

            if (!selectedProvider) {
                editor.notificationManager.open({
                    type: "warning",
                    text: "No provider selected.",
                });
                return;
            }

            void pickAndInsert(editor, selectedProvider, pluginUrl, data.insertAsLink);
        },
    });

    dialogApi.focus("provider");
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
