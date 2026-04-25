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
        msal: any;
    }
}

const MSAL_SDK = "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js";

interface GraphDriveItem {
    id: string;
    name: string;
    webUrl: string;
    "@microsoft.graph.downloadUrl"?: string;
    file?: {
        mimeType: string;
    };
    folder?: any;
}

let msalInstance: any = null;

const ensureMsal = async (): Promise<void> => {
    if (msalInstance) return;

    console.log("[OneDrive] Loading MSAL from:", MSAL_SDK);
    await loadScript(MSAL_SDK);

    if (!window.msal?.PublicClientApplication) {
        throw new Error("MSAL library failed to load");
    }
    console.log("[OneDrive] MSAL loaded successfully");
};

const getAccessToken = async (clientId: string): Promise<string> => {
    if (!msalInstance) {
        const redirectUri = window.location.origin + window.location.pathname;
        console.log("[OneDrive] Initializing MSAL with redirectUri:", redirectUri);

        msalInstance = new window.msal.PublicClientApplication({
            auth: {
                clientId: clientId,
                authority: "https://login.microsoftonline.com/common",
                redirectUri: redirectUri,
            },
            cache: {
                cacheLocation: "localStorage",
            },
        });
        await msalInstance.initialize();
    }

    const scopes = ["Files.Read", "Files.Read.All"];

    try {
        // Try silent token acquisition first
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            const response = await msalInstance.acquireTokenSilent({
                scopes,
                account: accounts[0],
            });
            console.log("[OneDrive] Got token silently");
            return response.accessToken;
        }
    } catch (err) {
        console.log("[OneDrive] Silent token acquisition failed, will use popup");
    }

    // Fall back to popup
    console.log("[OneDrive] Opening auth popup...");
    const response = await msalInstance.acquireTokenPopup({ scopes });
    console.log("[OneDrive] Auth successful");
    return response.accessToken;
};

const listFolderItems = async (accessToken: string, folderId?: string): Promise<GraphDriveItem[]> => {
    const endpoint = folderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
        : "https://graph.microsoft.com/v1.0/me/drive/root/children";
    
    console.log("[OneDrive] Fetching items from:", endpoint);
    const response = await fetch(endpoint, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[OneDrive] Graph API error:", response.status, errorText);
        throw new Error(`Graph API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("[OneDrive] API returned:", data);
    console.log("[OneDrive] Items count:", data.value?.length || 0);
    return data.value || [];
};

const showNavigablePicker = async (
    accessToken: string,
    currentPath: string[] = [],
    folderId?: string
): Promise<GraphDriveItem | null> => {
    const items = await listFolderItems(accessToken, folderId);
    
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100000;
        `;

        const dialog = document.createElement("div");
        dialog.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 24px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const title = document.createElement("h2");
        title.textContent = "Select from OneDrive";
        title.style.cssText = "margin: 0 0 8px 0; font-size: 20px; font-weight: 600;";

        // Breadcrumb
        const breadcrumb = document.createElement("div");
        breadcrumb.style.cssText = "margin-bottom: 12px; font-size: 14px; color: #666;";
        breadcrumb.textContent = currentPath.length > 0 ? currentPath.join(" / ") : "Root";

        const listContainer = document.createElement("div");
        listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 16px;
        `;

        const fileList = document.createElement("ul");
        fileList.style.cssText = "list-style: none; padding: 0; margin: 0;";

        const folders = items.filter(item => item.folder);
        const files = items.filter(item => item.file);

        console.log("[OneDrive] Folders:", folders.length, "Files:", files.length);

        // Show folders first
        folders.forEach(folder => {
            const li = document.createElement("li");
            li.style.cssText = `
                padding: 12px;
                border-bottom: 1px solid #eee;
                cursor: pointer;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            
            const icon = document.createElement("span");
            icon.textContent = "📁";
            icon.style.cssText = "font-size: 18px;";
            
            const name = document.createElement("span");
            name.textContent = folder.name;
            name.style.cssText = "font-weight: 500;";
            
            li.appendChild(icon);
            li.appendChild(name);

            li.addEventListener("mouseenter", () => li.style.background = "#f5f5f5");
            li.addEventListener("mouseleave", () => li.style.background = "white");

            li.addEventListener("click", async () => {
                document.body.removeChild(overlay);
                const newPath = [...currentPath, folder.name];
                const result = await showNavigablePicker(accessToken, newPath, folder.id);
                resolve(result);
            });

            fileList.appendChild(li);
        });

        // Show files
        files.forEach(file => {
            const li = document.createElement("li");
            li.style.cssText = `
                padding: 12px;
                border-bottom: 1px solid #eee;
                cursor: pointer;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            
            const icon = document.createElement("span");
            icon.textContent = "📄";
            icon.style.cssText = "font-size: 18px;";
            
            const name = document.createElement("span");
            name.textContent = file.name;
            
            li.appendChild(icon);
            li.appendChild(name);

            li.addEventListener("mouseenter", () => li.style.background = "#f5f5f5");
            li.addEventListener("mouseleave", () => li.style.background = "white");

            li.addEventListener("click", () => {
                document.body.removeChild(overlay);
                resolve(file);
            });

            fileList.appendChild(li);
        });

        if (folders.length === 0 && files.length === 0) {
            const emptyMsg = document.createElement("li");
            emptyMsg.textContent = "This folder is empty";
            emptyMsg.style.cssText = "padding: 20px; text-align: center; color: #666;";
            fileList.appendChild(emptyMsg);
        }

        listContainer.appendChild(fileList);

        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = "display: flex; justify-content: space-between; gap: 8px;";

        const leftButtons = document.createElement("div");
        leftButtons.style.cssText = "display: flex; gap: 8px;";

        // Back button (if not at root)
        if (currentPath.length > 0) {
            const backBtn = document.createElement("button");
            backBtn.textContent = "← Back";
            backBtn.style.cssText = `
                padding: 8px 16px;
                border: 1px solid #ddd;
                border-radius: 4px;
                background: white;
                cursor: pointer;
                font-size: 14px;
            `;
            backBtn.addEventListener("click", async () => {
                document.body.removeChild(overlay);
                const newPath = currentPath.slice(0, -1);
                // Need to get parent folder ID - for now, restart from root
                const result = await showNavigablePicker(accessToken, []);
                resolve(result);
            });
            leftButtons.appendChild(backBtn);
        }

        const rightButtons = document.createElement("div");
        rightButtons.style.cssText = "display: flex; gap: 8px;";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            font-size: 14px;
        `;
        cancelBtn.addEventListener("click", () => {
            document.body.removeChild(overlay);
            resolve(null);
        });

        rightButtons.appendChild(cancelBtn);
        buttonContainer.appendChild(leftButtons);
        buttonContainer.appendChild(rightButtons);

        dialog.appendChild(title);
        dialog.appendChild(breadcrumb);
        dialog.appendChild(listContainer);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);

        document.body.appendChild(overlay);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });
    });
};

const openOneDrivePicker = async (
    config: OneDriveProviderConfig,
): Promise<PickerResult | null> => {
    if (!config.clientId) {
        throw new Error("OneDrive requires clientId.");
    }

    console.log("[OneDrive] Getting access token...");
    const accessToken = await getAccessToken(config.clientId);

    console.log("[OneDrive] Showing navigable file picker...");
    const selected = await showNavigablePicker(accessToken);

    if (!selected) {
        console.log("[OneDrive] User cancelled");
        return null;
    }

    console.log("[OneDrive] User selected:", selected.name);

    const validated = validateOneDriveFileBoundary(selected);

    const url = validated.webUrl || validated["@microsoft.graph.downloadUrl"] || "";
    if (!url) {
        throw new Error("OneDrive file does not have a usable URL.");
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

    console.log("[OneDrive] Returning result:", result);
    return result;
};

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

        console.log("[OneDrive] Loading MSAL library...");
        await ensureMsal();
        console.log("[OneDrive] MSAL loaded, starting picker flow...");
        return await openOneDrivePicker(config);
    },
});
