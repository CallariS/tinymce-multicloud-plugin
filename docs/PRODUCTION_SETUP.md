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

## 7. TinyMCE 7 — iframe sandbox

TinyMCE 7 introduced `sandbox_iframes: true` as a default, which adds `sandbox=""` to every `<iframe>` in the editor content. This blocks script execution inside embedded viewers (Google Drive, Office Online, OneDrive, Dropbox etc.) and causes hundreds of "Blocked script execution" errors in the browser console.

The MultiCloud Plugin validates all embed sources via Zod boundary checks before they are ever inserted into the editor, making TinyMCE's generic sandbox redundant. Set `sandbox_iframes: false` in your `tinymce.init()`:

```js
tinymce.init({
  plugins: 'multicloud',
  sandbox_iframes: false, // required — plugin already validates all embed URLs
  // ...
});
```

> **TinyMCE 6:** `sandbox_iframes` does not exist in v6 — no action needed.

## 8. Third-party SDK Subresource Integrity (SRI)

Three providers load external JavaScript SDKs at runtime from third-party CDNs. These scripts execute in the same page as the TinyMCE editor, so a compromised CDN would allow arbitrary code execution.

The plugin enforces SRI by setting `integrity` and `crossorigin="anonymous"` on every dynamically injected `<script>` element. The hashes below were computed on **2026-05-03**:

| Provider | Script URL | SRI hash | Stability |
|---|---|---|---|
| Google Drive | `https://apis.google.com/js/api.js` | `sha384-e1d2OhuILK70N6p1bgFnbbf9COGUl1Ac65wf4qVGjUcP3YVhqxkJQK9adCkMn0AL` | ⚠ URL not version-pinned |
| Google Drive (auth) | `https://accounts.google.com/gsi/client` | `sha384-F38eXYzO+QvUfvwrKe1SMagfhK1nSX4fg2ksgmsbgt/MR34mpxNdqX0feac3RnWy` | ⚠ URL not version-pinned |
| OneDrive | `https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js` | `sha384-mz+8Q3jA4XBFbnyAsyQegn/0LHvziH7qHLBa9GzcU3HzeWj9J16SXM5S+TsmPBy0` | ✓ Version-pinned (2.38.0) |
| Dropbox | `https://www.dropbox.com/static/api/2/dropins.js` | `sha384-FYdTk4z6haguJbp0cnzHmzw5ITlci/vX2pyfHhAOC1SkWk/JGXpCWixhBBefpyKn` | ⚠ URL not version-pinned |

### Hash stability

The **MSAL hash is stable** — the URL embeds a semantic version (`2.38.0`) so the served bytes never change. The plugin will need to be updated when MSAL is upgraded.

The **Google and Dropbox hashes are ephemeral** — those CDN paths serve whatever the vendors currently deploy, with no version in the URL. If either vendor updates their script, the browser will block loading and the affected provider will stop working. Monitor those endpoints and update the constants in `src/providers/googleDrive.ts` and `src/providers/dropbox.ts` when the hashes change. To recompute:

```bash
curl -sL https://apis.google.com/js/api.js | openssl dgst -sha384 -binary | base64
curl -sL https://accounts.google.com/gsi/client | openssl dgst -sha384 -binary | base64
curl -sL https://www.dropbox.com/static/api/2/dropins.js | openssl dgst -sha384 -binary | base64
```

### Additional mitigations available to integrators

**Option A — Self-host the SDKs** (most stable): Download pinned SDK versions, serve from your own origin, and use `pickerUrl` overrides to bypass built-in SDK loading. Your own `<script>` tags carry stable, self-managed SRI hashes.

**Option B — Strict Content Security Policy**: Restrict `script-src` to only the specific CDN origins listed above (see section 6). This complements the SRI already in place.

**Option C — Automated hash monitoring**: Use a scheduled job to fetch each un-versioned URL nightly and alert on hash changes (e.g. via Snyk, a custom CI step, or `sri-hash` npm package). Update the plugin constants on any change.

> **Practical guidance:** SRI enforcement is active for all four scripts. For environments requiring stronger guarantees on the Google and Dropbox scripts, pursue Option A (self-hosting) to eliminate reliance on CDN stability entirely.

## 9. Recommended production security model

Do this for all providers where possible:
1. Keep long-lived secrets and refresh tokens on backend only.
2. Use short-lived browser tokens issued by your backend.
3. Add strict CSP and trusted domains for scripts and frames (see section 6 above).
4. Add explicit user confirmation before making files public.

## 10. Validation checklist before go-live

1. Picker opens for all providers in production domain.
2. Selected file is inserted as expected (link/image/embed).
3. No token or credential leaks in browser logs or HTML source.
4. Domain allowlists block untrusted origins.
5. BayerCloud public shares respect password/expiry policy.
