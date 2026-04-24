// Multi-Cloud Plugin Configuration
// 
// INSTRUCTIONS FOR REAL CLOUD BROWSING:
// 1. Get domain-restricted API credentials from each provider
// 2. Replace "YOUR_XXX" placeholders below with actual credentials
// 3. Remove pickerUrl properties to use real SDKs (not mocks)
// 4. Commit and push to deploy
//
// API Credential Sources:
// - Google Drive: https://console.cloud.google.com/ (restrict to callaris.github.io)
// - OneDrive: https://portal.azure.com/ → App Registrations
// - Dropbox: https://www.dropbox.com/developers/apps
//
// FOR MOCK DEMO (current): Uncomment pickerUrl lines to use local mock pickers

window.MULTICLOUD_CONFIG = {
    providers: {
        googleDrive: {
            enabled: true,
            // clientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
            // apiKey: "YOUR_GOOGLE_API_KEY",
            pickerUrl: "./pickers/google-drive.html"  // Remove this line to use real SDK
        },
        oneDrive: {
            enabled: true,
            // clientId: "YOUR_ONEDRIVE_CLIENT_ID",
            pickerUrl: "./pickers/onedrive.html"  // Remove this line to use real SDK
        },
        dropbox: {
            enabled: true,
            // appKey: "YOUR_DROPBOX_APP_KEY",
            pickerUrl: "./pickers/dropbox.html"  // Remove this line to use real SDK
        },
        bayerncloud: {
            enabled: true,
            // username: "your.email@example.com",
            // password: "your-password-or-app-token",
            // baseUrl: "https://your-nextcloud-instance.com",
            pickerUrl: "./pickers/bayerncloud.html"  // Remove this line to use real WebDAV
        }
    },
    defaultProvider: "googleDrive",
    defaultInsertMode: "link",
    dialogTitle: "Insert From Cloud",
    popupTimeoutMs: 120000
};
