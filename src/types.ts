export type BuiltInCloudProviderId = "googleDrive" | "oneDrive" | "dropbox" | "bayerncloud";
export type CloudProviderId = BuiltInCloudProviderId | (string & {});

export type InsertMode = "link" | "image" | "embed" | "audio";

export interface CloudItem {
    id: string;
    name: string;
    url: string;
    mimeType?: string;
    thumbnailUrl?: string;
    embedUrl?: string;
    downloadUrl?: string;
    type?: "file" | "folder";
}

export interface PickerResult {
    item: CloudItem;
    mode?: InsertMode;
}

export interface ProviderRuntimeConfig {
    enabled?: boolean;
    pickerUrl?: string;
    popupFeatures?: string;
    timeoutMs?: number;
    clientId?: string;
    apiKey?: string;
    scopes?: string[];
    token?: string;
    headers?: Record<string, string>;
}

export interface GoogleDriveProviderConfig extends ProviderRuntimeConfig {
    clientId: string;
    apiKey: string;
    appId?: string;
    scopes?: string[];
    pickerLocale?: string;
    viewMimeTypes?: string;
}

export interface OneDriveProviderConfig extends ProviderRuntimeConfig {
    clientId: string;
    action?: "query" | "share" | "download";
    multiSelect?: boolean;
    redirectUri?: string;
    advanced?: Record<string, unknown>;
}

export interface DropboxProviderConfig extends ProviderRuntimeConfig {
    appKey: string;
    linkType?: "preview" | "direct";
    multiselect?: boolean;
    extensions?: string[];
}

export interface BayernCloudNextcloudProviderConfig extends ProviderRuntimeConfig {
    mode?: "nextcloud-webdav";
    baseUrl: string;
    username?: string;
    password?: string;
    bearerToken?: string;
    webdavPath?: string;
    createPublicShare?: boolean;
    sharingApiPath?: string;
    sharePassword?: string;
    shareExpireDate?: string;
}

export interface MultiCloudPluginOptions {
    providers?: Partial<Record<CloudProviderId, ProviderRuntimeConfig>>;
    defaultProvider?: CloudProviderId;
    defaultInsertMode?: InsertMode;
    dialogTitle?: string;
    popupTimeoutMs?: number;
}

export interface CloudProviderContext {
    editor: any;
    pluginUrl: string;
    options: MultiCloudPluginOptions;
    providerConfig: ProviderRuntimeConfig;
}

export interface CloudProvider {
    id: CloudProviderId;
    label: string;
    pick: (context: CloudProviderContext) => Promise<PickerResult | null>;
    upload?: (context: CloudProviderContext, file: File) => Promise<PickerResult | null>;
}

export interface PickerMessage {
    source: "tinymce-multicloud-plugin";
    type: "picked" | "cancelled";
    providerId: CloudProviderId;
    payload?: PickerResult;
}
