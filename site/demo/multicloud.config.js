window.MULTICLOUD_CONFIG = {
    providers: {
        googleDrive: { enabled: true, pickerUrl: "./pickers/google-drive.html" },
        oneDrive: { enabled: true, pickerUrl: "./pickers/onedrive.html" },
        dropbox: { enabled: true, pickerUrl: "./pickers/dropbox.html" },
        bayerncloud: { enabled: true, pickerUrl: "./pickers/bayerncloud.html" },
    },
    defaultProvider: "googleDrive",
    defaultInsertMode: "link",
    dialogTitle: "Insert From Cloud",
    popupTimeoutMs: 120000,
};
