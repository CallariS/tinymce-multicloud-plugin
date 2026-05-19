/**
 * The set of built-in cloud provider identifiers shipped with this plugin.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export type BuiltInCloudProviderId = "googleDrive" | "oneDrive" | "dropbox" | "bayerncloud";

/**
 * A union type that accepts any of the built-in provider IDs or any arbitrary string
 * (for custom providers added by the integrator).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export type CloudProviderId = BuiltInCloudProviderId | (string & {});

/**
 * Determines how the picked/uploaded item will be inserted into the TinyMCE editor:
 * - `"link"` — inserts an `<a>` anchor tag.
 * - `"image"` — inserts an `<img>` tag.
 * - `"embed"` — inserts an `<iframe>` (or `<video>` when a direct download URL is available).
 * - `"audio"` — inserts an `<audio>` tag (or `<iframe>` fallback when no direct download URL is available).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export type InsertMode = "link" | "image" | "embed" | "audio";

/**
 * Represents a single file or folder item returned by a cloud provider picker or upload operation.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface CloudItem {
    /** Unique identifier for the item within the provider's system. */
    id: string;
    /** Display name of the file or folder. */
    name: string;
    /** Canonical URL used when inserting a link or image. For raster images this is typically a direct-content URL; for documents it may be a viewer URL. */
    url: string;
    /** MIME type of the item, e.g. `"image/png"` or `"application/pdf"`. May be `undefined` when the provider does not supply it. */
    mimeType?: string;
    /** URL of a thumbnail preview image for the item, if available. */
    thumbnailUrl?: string;
    /** URL used when inserting an embedded viewer iframe (e.g. a Google Drive preview URL or an Office Online embed URL). */
    embedUrl?: string;
    /** Direct binary download URL, used for `<audio>` and `<video>` elements so the browser can stream the file natively. */
    downloadUrl?: string;
    /** Whether this item is a file or a folder. Omitted when not applicable. */
    type?: "file" | "folder";
}

/**
 * The result returned by a provider's `pick` or `upload` method.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface PickerResult {
    /** The selected or uploaded cloud item. */
    item: CloudItem;
    /**
     * The suggested insert mode for this item.
     * When `undefined`, the plugin falls back to `MultiCloudPluginOptions.defaultInsertMode`.
     */
    mode?: InsertMode;
}

/**
 * Base runtime configuration accepted by every cloud provider.
 * Provider-specific config interfaces extend this type and add their required fields.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface ProviderRuntimeConfig {
    /**
     * Set to `false` to completely disable this provider.
     * Disabled providers are excluded from the picker dialog.
     * Defaults to `true`.
     */
    enabled?: boolean;
    /**
     * URL of a custom picker page that communicates back via `postMessage`
     * using the {@link PickerMessage} contract. When set, the built-in SDK flow
     * is bypassed entirely and this URL is opened in a popup window.
     */
    pickerUrl?: string;
    /** Window features string passed to `window.open` for the picker popup (e.g. `"width=1120,height=760"`). */
    popupFeatures?: string;
    /** Per-provider picker timeout in milliseconds. Overrides `MultiCloudPluginOptions.popupTimeoutMs`. */
    timeoutMs?: number;
    /** OAuth client ID, used by providers that implement their own SDK auth flow. */
    clientId?: string;
    /** API key, used by Google Drive in addition to `clientId`. */
    apiKey?: string;
    /** OAuth scopes to request. Falls back to a provider-specific default when omitted. */
    scopes?: string[];
    /** Pre-obtained access token. When supplied, the provider may skip the interactive auth step. */
    token?: string;
    /** Extra HTTP headers forwarded to provider API calls (e.g. for WebDAV requests). */
    headers?: Record<string, string>;
}

/**
 * Configuration for the Google Drive provider.
 * Requires both `clientId` (OAuth 2.0) and `apiKey` (Picker/Drive API key) from Google Cloud Console.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface GoogleDriveProviderConfig extends ProviderRuntimeConfig {
    /** Google OAuth 2.0 client ID. Must be configured in Google Cloud Console with your deployment origin. */
    clientId: string;
    /** Google API key used to initialise the Picker API and Drive REST client. */
    apiKey: string;
    /** Google Drive app ID (numeric), used for scoped Shared Drive access. Optional. */
    appId?: string;
    /** OAuth scopes to request. Defaults to `drive.readonly` + `drive.file`. */
    scopes?: string[];
    /** BCP-47 locale tag passed to the Picker UI (e.g. `"de"`, `"it"`). Defaults to `"en"`. */
    pickerLocale?: string;
    /** Comma-separated MIME type filter applied to the Picker DocsView. */
    viewMimeTypes?: string;
    /**
     * URL of a server-side token exchange endpoint (e.g. a Cloudflare Worker `/google-token` route)
     * that accepts a `POST { code: string }` and returns `{ access_token: string; expires_in?: number }`.
     *
     * When set, the plugin uses the secure **Authorization Code** flow (`initCodeClient`) instead of
     * the deprecated implicit (token) flow (`initTokenClient`). The Worker holds the `client_secret`
     * and performs the code exchange against `https://oauth2.googleapis.com/token`.
     *
     * Recommended for production. Required to satisfy Google's "Sichere Abläufe verwenden" project check.
     */
    tokenExchangeUrl?: string;
}

/**
 * Configuration for the OneDrive provider.
 * Requires a `clientId` from Microsoft Entra (Azure AD) app registration.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface OneDriveProviderConfig extends ProviderRuntimeConfig {
    /** Azure AD / Entra application (client) ID. */
    clientId: string;
    /** OneDrive picker action mode. Defaults to `"query"`. */
    action?: "query" | "share" | "download";
    /** Whether to allow selecting multiple files at once. Defaults to `false`. */
    multiSelect?: boolean;
    /** OAuth redirect URI registered in the Azure AD app. Defaults to the current page origin + pathname. */
    redirectUri?: string;
    /** Advanced configuration object forwarded directly to the OneDrive SDK. */
    advanced?: Record<string, unknown>;
}

/**
 * Configuration for the Dropbox provider.
 * Requires a `appKey` from the Dropbox App Console.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface DropboxProviderConfig extends ProviderRuntimeConfig {
    /** Dropbox application key ("App key") from the Dropbox App Console. */
    appKey: string;
    /**
     * Link type returned by the Dropbox Chooser.
     * - `"preview"` — returns a stable `www.dropbox.com/scl/fi/...` link (default, recommended).
     * - `"direct"` — returns a temporary direct-download link that expires.
     */
    linkType?: "preview" | "direct";
    /** Whether to allow multi-file selection in the Chooser. Defaults to `false`. */
    multiselect?: boolean;
    /** File extension filter for the Chooser (e.g. `[".pdf", ".docx"]`). */
    extensions?: string[];
}

/**
 * Configuration for the BayernCloud / Nextcloud provider.
 * Supports interactive picker mode (via `pickerUrl`) or pre-configured WebDAV mode.
 * Requires at minimum `baseUrl`, `username`, and either `password` or `bearerToken`.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface BayernCloudNextcloudProviderConfig extends ProviderRuntimeConfig {
    /**
     * Provider access mode. Currently only `"nextcloud-webdav"` is supported for SDK mode.
     * Defaults to `"nextcloud-webdav"` when omitted.
     */
    mode?: "nextcloud-webdav";
    /** Base URL of the Nextcloud / BayernCloud instance (e.g. `"https://cloud.example.com"`). */
    baseUrl: string;
    /** Nextcloud username for WebDAV authentication. */
    username?: string;
    /** Nextcloud password. Use `bearerToken` instead when possible to avoid embedding raw credentials. */
    password?: string;
    /** Nextcloud app password or OAuth bearer token, used as `Authorization: Bearer` instead of Basic Auth. */
    bearerToken?: string;
    /** WebDAV sub-path to browse, relative to the user's root (e.g. `"Documents/Media"`). Defaults to the user's root. */
    webdavPath?: string;
    /** When `true`, a public share link is created via the OCS Sharing API after the user selects a file. */
    createPublicShare?: boolean;
    /** OCS Sharing API path. Defaults to `"/ocs/v2.php/apps/files_sharing/api/v1/shares"`. */
    sharingApiPath?: string;
    /** Optional password applied to the generated public share link. */
    sharePassword?: string;
    /** Expiry date for the generated public share link in `YYYY-MM-DD` format. */
    shareExpireDate?: string;
}

/**
 * Top-level plugin options passed to TinyMCE via `tinymce.init()`.
 * These map to the `multicloud_*` TinyMCE option keys.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface MultiCloudPluginOptions {
    /** Map of provider ID to its runtime configuration. Providers absent from this map are enabled with defaults. */
    providers?: Partial<Record<CloudProviderId, ProviderRuntimeConfig>>;
    /** ID of the provider that should be pre-selected when the picker dialog opens. Must be a key in `providers`. */
    defaultProvider?: CloudProviderId;
    /**
     * Fallback insert mode used when the picker result does not specify one.
     * Defaults to `"link"`.
     */
    defaultInsertMode?: InsertMode;
    /** Title shown in the "Insert From Cloud" dialog. Defaults to `"Insert From Cloud"`. */
    dialogTitle?: string;
    /** Global popup timeout in milliseconds. Applied to all popup-mode pickers unless overridden per-provider. Defaults to `120000` (2 minutes). */
    popupTimeoutMs?: number;
    /**
     * Warning message shown in the upload dialog to inform users that uploaded files will be
     * made publicly accessible. Must be a non-empty string — empty or whitespace-only values
     * are rejected by the XDBC contract layer.
     *
     * The value is passed through `editor.translate()`, so it can be a translation key defined
     * in a TinyMCE language pack. When omitted, a built-in default message is used (translatable
     * via the plugin's own language files).
     */
    uploadPublicSharingWarning?: string;
}

/**
 * Execution context passed to a provider's `pick` and `upload` methods.
 * Contains everything a provider needs to operate: the editor instance, resolved plugin URL,
 * full plugin options, and the provider's own runtime configuration.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface CloudProviderContext {
    /** The TinyMCE editor instance. Typed as `any` because TinyMCE's typings are not bundled. */
    editor: any;
    /** Absolute URL of the plugin bundle directory, used to resolve default picker page paths. */
    pluginUrl: string;
    /** Resolved and validated plugin options. */
    options: MultiCloudPluginOptions;
    /** The specific runtime configuration for this provider. */
    providerConfig: ProviderRuntimeConfig;
}

/**
 * Contract that every cloud provider adapter must implement.
 * Built-in providers are in `src/providers/`. Custom providers can be added by the integrator.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface CloudProvider {
    /** Unique identifier for this provider (e.g. `"googleDrive"`). */
    id: CloudProviderId;
    /** Human-readable label shown in the picker dialog (e.g. `"Google Drive"`). */
    label: string;
    /**
     * Opens the provider's file picker and returns the user's selection, or `null` if the user cancelled.
     *
     * @param context - Execution context providing editor, options, and provider config.
     * @returns A promise resolving to the picked {@link PickerResult}, or `null` on cancellation.
     * @throws {Error} If the picker fails (popup blocked, SDK error, timeout, etc.).
     */
    pick: (context: CloudProviderContext) => Promise<PickerResult | null>;
    /**
     * Uploads a file to the provider's storage and returns the result, or `null` on cancellation.
     * Optional — providers that do not support upload should omit this method.
     *
     * @param context - Execution context providing editor, options, and provider config.
     * @param file - The `File` object to upload.
     * @returns A promise resolving to the upload {@link PickerResult}, or `null` on cancellation.
     * @throws {Error} If the upload fails.
     */
    upload?: (context: CloudProviderContext, file: File) => Promise<PickerResult | null>;
}

/**
 * Message shape used by custom picker pages to communicate results back to the host page
 * via `window.postMessage`. The host page (plugin) only accepts messages where `source` equals
 * `"tinymce-multicloud-plugin"` to prevent unrelated message injection.
 *
 * @example
 * ```js
 * // Inside a custom picker page, after the user selects a file:
 * window.opener.postMessage({
 *   source: "tinymce-multicloud-plugin",
 *   type: "picked",
 *   providerId: "myProvider",
 *   payload: { item: { id: "1", name: "file.pdf", url: "https://..." } },
 * }, "*");
 * ```
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export interface PickerMessage {
    /** Fixed discriminator. Messages without this exact value are silently ignored. */
    source: "tinymce-multicloud-plugin";
    /** `"picked"` when a file was selected; `"cancelled"` when the user dismissed the picker. */
    type: "picked" | "cancelled";
    /** The provider ID this message originated from. Used to match against the awaiting listener. */
    providerId: CloudProviderId;
    /** The picker result. Required when `type` is `"picked"`; omitted when `"cancelled"`. */
    payload?: PickerResult;
}
