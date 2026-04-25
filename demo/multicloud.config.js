// Multi-Cloud Plugin Configuration
// This demo uses mock pickers to simulate cloud provider UIs without requiring API keys.
// 
// For local development with REAL cloud provider SDKs, see:
// https://github.com/CallariS/tinymce-multicloud-plugin#development

window.MULTICLOUD_CONFIG = {
    providers: {
        googleDrive: {
            enabled: true,
            apiKey: "AIzaSyDQwZY5cgDsUIh490pFrlNvoROn4UAoFO8",
            clientId: "506225751213-ukmgqs8l1rbj6qma54a0frv89cph16gs.apps.googleusercontent.com"
        },
        oneDrive: { enabled: true, pickerUrl: "./pickers/onedrive.html" },
        dropbox: { enabled: true, pickerUrl: "./pickers/dropbox.html" },
        bayerncloud: { enabled: true, pickerUrl: "./pickers/bayerncloud.html" }
    },
    defaultProvider: "googleDrive",
    defaultInsertMode: "link",
    dialogTitle: "Insert From Cloud",
    popupTimeoutMs: 120000
};
