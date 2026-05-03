# Production Setup Guide

This guide provides concrete setup values and checklists for Google Drive, OneDrive, Dropbox, and BayernCloud (Nextcloud/WebDAV).

## 1. Decide your runtime URLs first

Example environments:
- Local development origin: http://localhost:5173
- Staging origin: https://editor-staging.example.com
- Production origin: https://editor.example.com

Use your exact origins in all cloud app settings.

## 2. Google Drive (GIS + Picker)

### Google Cloud Console checklist
1. Create project and enable these APIs:
- Google Drive API
- Google Picker API

2. Create credentials:
- OAuth 2.0 Client ID (type: Web application)
- API Key (browser key)

> **⚠️ Google Client ID — copy-paste trap**
> The Google Cloud Console displays the client ID **with** the `.apps.googleusercontent.com` suffix, and the copy button on the credentials list page copies the full string including the suffix.
> When entering the client ID into your config or as a GitHub Actions secret, use **only the part before `.apps.googleusercontent.com`**.
> Example — if the console shows:
> `506225751213-abc123.apps.googleusercontent.com`
> enter into your config / secret:
> `506225751213-abc123`

3. OAuth client settings:
- Authorized JavaScript origins:
  - http://localhost:5173
  - https://editor-staging.example.com
  - https://editor.example.com

4. API key restrictions:
- Restrict by HTTP referrers to your editor domains.
- Restrict API key to Drive + Picker APIs.

### Plugin config
- Required fields:
  - clientId
  - apiKey
- Recommended scope:
  - https://www.googleapis.com/auth/drive.file

## 3. OneDrive (Microsoft)

### Azure/Entra app registration checklist
1. Register app in Microsoft Entra ID.
2. Platform: Single-page application.
3. Redirect URIs:
- http://localhost:5173
- https://editor-staging.example.com
- https://editor.example.com
4. Enable implicit token if required by your tenant policy.
5. API permissions:
- Files.Read (minimum)
- Files.ReadWrite (if you later add upload/write)

### Plugin config
- Required field:
  - clientId
- Recommended fields:
  - action: query
  - redirectUri: your exact origin

## 4. Dropbox Chooser

### Dropbox App Console checklist
1. Create Dropbox app.
2. Enable Chooser for the app key.
3. Add Chooser domains:
- localhost
- editor-staging.example.com
- editor.example.com

### Plugin config
- Required field:
  - appKey
- Optional fields:
  - linkType: preview
  - extensions: list of allowed extensions

## 5. BayernCloud (Nextcloud/WebDAV mode)

This adapter is implemented for Nextcloud-compatible WebDAV plus optional OCS sharing.

### Server-side checklist
1. Confirm WebDAV endpoint is reachable:
- https://your-bayerncloud.example/remote.php/dav/files/{username}/
2. Confirm OCS sharing endpoint if public links are needed:
- https://your-bayerncloud.example/ocs/v2.php/apps/files_sharing/api/v1/shares
3. Use app-password or bearer token instead of account password where possible.

### Plugin config
- Required fields:
  - mode: nextcloud-webdav
  - baseUrl
  - username
  - password or bearerToken
- Optional fields:
  - webdavPath
  - createPublicShare
  - sharingApiPath
  - sharePassword
  - shareExpireDate

## 6. Content Security Policy (CSP)

Each provider loads external scripts and opens iframes. The directives below cover all four built-in providers. Add only the rows for the providers you actually enable.

### `script-src`

| Provider | Required value |
|---|---|
| Google Drive | `https://apis.google.com` `https://accounts.google.com` |
| OneDrive | `https://alcdn.msauth.net` `https://js.monitor.azure.com` |
| Dropbox | `https://www.dropbox.com` |
| BayernCloud | *(no external scripts — WebDAV only)* |

### `frame-src` / `child-src`

| Provider | Required value |
|---|---|
| Google Drive (Picker) | `https://docs.google.com` `https://drive.google.com` |
| Google Drive (OAuth) | `https://accounts.google.com` |
| OneDrive (picker popup) | `https://onedrive.live.com` `https://*.sharepoint.com` |
| OneDrive (Office Online embed) | `https://view.officeapps.live.com` |
| Dropbox (picker popup) | `https://www.dropbox.com` |
| Dropbox (Office Online embed) | `https://view.officeapps.live.com` |
| BayernCloud picker popup | *(your Nextcloud origin)* |

### `connect-src`

| Provider | Required value |
|---|---|
| Google Drive | `https://www.googleapis.com` `https://content.googleapis.com` |
| OneDrive | `https://graph.microsoft.com` `https://login.microsoftonline.com` |
| Dropbox | `https://api.dropboxapi.com` `https://content.dropboxapi.com` |
| BayernCloud | *(your Nextcloud origin)* *(your Cloudflare Worker origin if using proxy)* |

### `img-src`

| Provider | Required value |
|---|---|
| Google Drive | `https://drive.google.com` `https://lh3.googleusercontent.com` |
| OneDrive | `https://*.1drv.ms` `https://onedrive.live.com` |
| Dropbox | `https://www.dropbox.com` `https://dl.dropboxusercontent.com` |

### Minimal example header (all four providers)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://apis.google.com https://accounts.google.com https://alcdn.msauth.net https://www.dropbox.com;
  frame-src 'self' https://docs.google.com https://drive.google.com https://accounts.google.com https://onedrive.live.com https://*.sharepoint.com https://view.officeapps.live.com https://www.dropbox.com;
  connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://graph.microsoft.com https://login.microsoftonline.com https://api.dropboxapi.com https://content.dropboxapi.com;
  img-src 'self' data: https://drive.google.com https://lh3.googleusercontent.com https://*.1drv.ms https://onedrive.live.com https://www.dropbox.com https://dl.dropboxusercontent.com;
```

> **Note:** `'unsafe-inline'` is **not** required by this plugin. All inline event handlers in the TinyMCE dialog HTML panels use the `onclick="window['handler']()"` pattern which invokes named global functions, not inline scripts. TinyMCE itself may require `'unsafe-inline'` depending on version and skin — check the TinyMCE CSP documentation for your version.

## 7. TinyMCE 7 — iframe sandbox exclusions

TinyMCE 7 introduced `sandbox_iframes: true` as a default, which adds `sandbox=""` to every `<iframe>` inserted into the editor. This blocks script execution inside embedded viewers (Google Drive, Office Online, etc.).

Add `sandbox_iframes_exclusions` to your `tinymce.init()` call with the embed domains you use:

```js
tinymce.init({
  plugins: 'multicloud',
  // Required when using embed insert mode with TinyMCE 7:
  sandbox_iframes_exclusions: [
    'https://drive.google.com',       // Google Drive file viewer
    'https://docs.google.com',        // Google Docs / Sheets / Slides preview
    'https://view.officeapps.live.com', // Office Online (OneDrive + Dropbox Office docs)
    'https://www.dropbox.com',        // Dropbox embed
    // Add your Nextcloud origin here if using BayernCloud embeds
  ],
  // ...
});
```

> **TinyMCE 6:** `sandbox_iframes` does not exist in v6 — no action needed.

## 8. Recommended production security model

Do this for all providers where possible:
1. Keep long-lived secrets and refresh tokens on backend only.
2. Use short-lived browser tokens issued by your backend.
3. Add strict CSP and trusted domains for scripts and frames (see section 6 above).
4. Add explicit user confirmation before making files public.

## 8. Validation checklist before go-live

1. Picker opens for all providers in production domain.
2. Selected file is inserted as expected (link/image/embed).
3. No token or credential leaks in browser logs or HTML source.
4. Domain allowlists block untrusted origins.
5. BayerCloud public shares respect password/expiry policy.
