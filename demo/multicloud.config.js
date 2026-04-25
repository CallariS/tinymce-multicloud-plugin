// Multi-Cloud Plugin Configuration
// This demo uses mock pickers to simulate cloud provider UIs without requiring API keys.
// 
// For local development with REAL cloud provider SDKs, see:
// https://github.com/CallariS/tinymce-multicloud-plugin#development

window.MULTICLOUD_CONFIG = {
    providers: {
        googleDrive: {
            enabled: true,
            apiKey: "AIzaSyBJl9SdoCsODgTJSrj_97qcKTPy2iYH6YQ",
            clientId: "506225751213-ukmgqs8l1rbj6qma54a0frv89cph16gs.apps.googleusercontent.com"
        },
        oneDrive: { 
            enabled: true, 
            clientId: "a50f6dc0-3dee-484b-862b-3b5010889b87"
        },
        dropbox: { enabled: true, pickerUrl: "./pickers/dropbox.html" },
        bayerncloud: { enabled: true, pickerUrl: "./pickers/bayerncloud.html" }
    },
    defaultProvider: "googleDrive",
    defaultInsertMode: "link",
    dialogTitle: "Insert From Cloud",
    popupTimeoutMs: 120000
};
