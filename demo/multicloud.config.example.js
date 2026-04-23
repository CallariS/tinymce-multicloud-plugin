window.MULTICLOUD_CONFIG = {
  // Replace with your real values.
  providers: {
    googleDrive: {
      enabled: true,
      clientId: "GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
      apiKey: "GOOGLE_BROWSER_API_KEY",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      // Optional for custom picker pages:
      // pickerUrl: "./pickers/google-drive.html",
    },
    oneDrive: {
      enabled: true,
      clientId: "ONEDRIVE_CLIENT_ID",
      action: "query",
      redirectUri: window.location.origin,
      // Optional for custom picker pages:
      // pickerUrl: "./pickers/onedrive.html",
    },
    dropbox: {
      enabled: true,
      appKey: "DROPBOX_APP_KEY",
      linkType: "preview",
      extensions: [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".doc", ".docx"],
      // Optional for custom picker pages:
      // pickerUrl: "./pickers/dropbox.html",
    },
    bayerncloud: {
      enabled: true,
      mode: "nextcloud-webdav",
      baseUrl: "https://your-bayerncloud.example",
      username: "editor-user",
      password: "nextcloud-app-password",
      webdavPath: "",
      createPublicShare: false,
      sharingApiPath: "/ocs/v2.php/apps/files_sharing/api/v1/shares",
      // Optional for custom picker pages:
      // pickerUrl: "./pickers/bayerncloud.html",
    },
  },
  defaultProvider: "googleDrive",
  defaultInsertMode: "link",
  dialogTitle: "Insert From Cloud",
  popupTimeoutMs: 120000,
};
