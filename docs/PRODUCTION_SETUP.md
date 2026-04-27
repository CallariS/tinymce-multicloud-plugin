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

## 6. Recommended production security model

Do this for all providers where possible:
1. Keep long-lived secrets and refresh tokens on backend only.
2. Use short-lived browser tokens issued by your backend.
3. Add strict CSP and trusted domains for scripts and frames.
4. Add explicit user confirmation before making files public.

## 7. Validation checklist before go-live

1. Picker opens for all providers in production domain.
2. Selected file is inserted as expected (link/image/embed).
3. No token or credential leaks in browser logs or HTML source.
4. Domain allowlists block untrusted origins.
5. BayerCloud public shares respect password/expiry policy.
