# TinyMCE MultiCloud Plugin

[![npm](https://img.shields.io/npm/v/tinymce-multicloud-plugin)](https://www.npmjs.com/package/tinymce-multicloud-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Deploy GitHub Pages](https://github.com/CallariS/tinymce-multicloud-plugin/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/CallariS/tinymce-multicloud-plugin/actions/workflows/deploy-pages.yml)
[![Demo](https://img.shields.io/badge/demo-live-blue)](https://callaris.github.io/tinymce-multicloud-plugin/demo/tinymce-demo.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A TinyMCE plugin that lets users browse/pick files from multiple cloud providers and insert them into editor content as links, images, or embeds.

Built-in provider adapters:
- Google Drive
- OneDrive
- Dropbox
- BayernCloud

## Why this architecture

Different cloud providers have different OAuth flows, SDKs, and picker UX constraints. The plugin uses a provider adapter contract and popup bridge protocol, so each provider can implement its own picker while TinyMCE integration stays consistent.

## Design-by-Contract validation (XDBC)

This plugin uses [XDBC](https://github.com/CallariS/XDBC) for Design-by-Contract (DBC) validation of all plugin options and provider configurations. Instead of scattered `if`/`throw` guards, every precondition is expressed as a typed contract that fires before any plugin logic runs.

### What is validated

- **Plugin options object** — must be a plain object (not null, not array)
- **`providers` map** — must be a plain object if provided
- **`defaultProvider`** — must be a string and must exist in the `providers` map
- **`defaultInsertMode`** — must be `"link"`, `"image"`, or `"embed"` if provided
- **`popupTimeoutMs`** — must be a positive number if provided
- **`dialogTitle` / `defaultProvider`** — must be non-empty strings if provided
- **Per-provider SDK credentials** — validated when SDK mode is active (i.e. `enabled: true` and no `pickerUrl` override):
  - Google Drive: `clientId` and `apiKey` must be defined, string, and match the API-key pattern
  - OneDrive: `clientId` must be defined, string, and match the API-key pattern
  - Dropbox: `appKey` must be defined, string, and match the API-key pattern
  - BayernCloud: `baseUrl` (valid URL), `username`, and either `password` or `bearerToken` (at least one non-empty)

### Advantages

- **Fail-fast with actionable messages** — errors are surfaced at plugin init with a clear hint (e.g. *"Did you set Google Drive clientId?"*), not as opaque SDK failures deep in an OAuth flow.
- **Contracts as documentation** — the decorator stack on each validator class is a machine-readable, always-up-to-date specification of what the configuration must look like.
- **Uniform error shape** — all validation failures throw `DBC.Infringement` (subclass of `Error`), making them easy to `catch` and distinguish from runtime errors.
- **Configurable behaviour** — the entire contract layer uses a single named DBC instance at `globalThis.MultiCloud.Validation.DBC`, which can be reconfigured at runtime (see [Soft logging mode](#soft-logging-mode) below).
- **Single error type** — all validation failures, whether from DBC contracts or Zod schema checks, throw `DBC.Infringement` (XDBC's `ZOD.tsCheck` routes through `DBC.reportTsCheckInfringement` internally).

## Zod boundary validation

In addition to XDBC DBC contracts on configuration, the plugin validates all data that crosses provider API boundaries at runtime using **XDBC's Zod integration** (`ZOD.tsCheck` from `xdbc/src/DBC/ZOD`). Zod schemas are defined with the `zod` library but validation is always run through XDBC — keeping the error shape and behaviour consistent with the rest of the contract layer.

Where DBC validates *input configuration* before any logic runs, XDBC's Zod implementation validates *what providers return* before that data is trusted and used.

### What is validated

| Boundary | Schema | Validates |
|---|---|---|
| Any provider result | `pickerResultSchema` | `item.id`, `item.name`, `item.url` non-empty; all URL fields are valid URLs; `mode` is a known enum value |
| Google Picker callback | `googleDocSchema` | `id` required and non-empty; `url`, `thumbnailLink` are valid URLs when present |
| OneDrive navigable picker | `oneDriveFileSchema` | `name` required; `webUrl`, `@microsoft.graph.downloadUrl` are valid URLs when present; `file.mimeType` is a string when present |
| Dropbox Chooser callback | `dropboxFileSchema` | `link` required and a valid URL; `thumbnailLink` is a valid URL when present |
| BayernCloud WebDAV node | `webDavNodeSchema` | `id`, `name`, `url`, `webdavPath` non-empty; `url` is a valid URL; `isDirectory` is a boolean |

### Error type

Because validation runs through `ZOD.tsCheck` which calls `DBC.reportTsCheckInfringement` on failure, both DBC contract violations and Zod schema failures throw `DBC.Infringement`.

```ts
import { DBC } from "xdbc";

try {
  tinymce.init({ plugins: "multicloud", multicloud_providers: myConfig });
} catch (e) {
  if (e instanceof DBC.Infringement) {
    // either a configuration contract or a provider boundary schema was violated
  }
}
```

## Install

```bash
npm install
npm run build
```

## Development

```bash
npm install
npm run dev       # watches src/ and rebuilds dist/ on change
```

For local development with real cloud provider SDKs:

1. Copy `demo/multicloud.config.example.js` to `demo/multicloud.config.js`.
2. Fill in your real credentials (this file is gitignored and will never be committed).
3. Open `demo/tinymce-demo.html` in a browser (via a local HTTP server, not `file://`).

## Production quickstart

1. Copy `demo/multicloud.config.example.js` to `demo/multicloud.config.js`.
2. Fill in your real cloud app IDs/keys and BayernCloud endpoint values.
3. Follow the provider console checklists in `docs/PRODUCTION_SETUP.md`.

> **Note:** `demo/multicloud.config.js` is gitignored — never commit real credentials to the repository.

## GitHub Pages demo deployment

This repository includes a Pages workflow at `.github/workflows/deploy-pages.yml`.

### Manual local check

```bash
npm run pages:build
```

This creates a static bundle in `site/`.

Note: `site/` is generated output and is intentionally not tracked in git.

### Automatic publish

1. Push to `main` or `master`.
2. In GitHub repository settings, ensure Pages is enabled and uses GitHub Actions.
3. Add the following [repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) so the build can inject credentials:

   | Secret name | Where to get it |
   |---|---|
   | `GOOGLE_BROWSER_API_KEY` | Google Cloud Console → APIs & Services → Credentials |
   | `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → OAuth 2.0 Client ID — **enter only the bare ID, without `.apps.googleusercontent.com`** (see warning below) |
   | `ONEDRIVE_CLIENT_ID` | Azure Portal → App registrations → Application (client) ID |
   | `DROPBOX_APP_KEY` | Dropbox Developer Console → App settings |

   > **⚠️ Google Client ID — copy-paste trap**
   > In the Google Cloud Console the client ID is displayed **with** the `.apps.googleusercontent.com` suffix, and the copy button on the credentials list page also copies the full string including the suffix.
   > The build script appends `.apps.googleusercontent.com` automatically, so paste **only the part before it**.
   > Example — if the console shows:
   > `506225751213-abc123.apps.googleusercontent.com`
   > enter into the secret:
   > `506225751213-abc123`

4. Wait for the `Deploy GitHub Pages` workflow to complete.

The demo URL will be:

- `https://<owner>.github.io/<repo>/demo/tinymce-demo.html`

The Pages bundle self-hosts TinyMCE from this repository output, so the demo does not require a Tiny Cloud API key.

When configuring OAuth allowlists, include exactly:

- `https://<owner>.github.io`
- `https://<owner>.github.io/<repo>`

## TinyMCE usage

```html
<script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js"></script>
<script src="./dist/index.global.js"></script>

<textarea id="editor"></textarea>
<script>
  tinymce.init({
    selector: "#editor",
    plugins: "link image media multicloud",
    toolbar: "undo redo | bold italic | link image media | multicloud multicloud_upload",

    multicloud_providers: {
      googleDrive: {
        enabled: true,
        clientId: "GOOGLE_OAUTH_CLIENT_ID",
        apiKey: "GOOGLE_BROWSER_API_KEY",
        scopes: ["https://www.googleapis.com/auth/drive.file"]
      },
      oneDrive: {
        enabled: true,
        clientId: "ONEDRIVE_CLIENT_ID",
        action: "query"
      },
      dropbox: {
        enabled: true,
        appKey: "DROPBOX_APP_KEY",
        linkType: "preview"
      },
      bayerncloud: {
        enabled: true,
        // Option 1: Use interactive picker (prompts user for credentials)
        pickerUrl: "./pickers/bayerncloud.html"

        // Option 2: Use WebDAV with pre-configured credentials
        // mode: "nextcloud-webdav",
        // baseUrl: "https://your-nextcloud.example.com",
        // username: "your-username",
        // password: "app-password",  // Use app-specific password
        // webdavPath: "",  // Optional subfolder
        // createPublicShare: true  // Creates public share links
      }
    },

    multicloud_default_provider: "googleDrive",
    multicloud_default_insert_mode: "link",
    multicloud_dialog_title: "Insert From Cloud",
    multicloud_popup_timeout_ms: 120000
  });
</script>
```

### Toolbar buttons

The plugin provides two toolbar buttons:

- **`multicloud`**: Opens a file picker to browse and select files from cloud providers
- **`multicloud_upload`**: Opens a dialog to upload local files to cloud providers

### Upload support

Some providers support uploading local files directly to the cloud:

**Google Drive**: ✅ Full upload support
- Uploads files to user's Drive
- Creates public sharing link
- Embeds PDFs and Office documents

**Nextcloud/BayernCloud**: ✅ Full upload support (both modes)
- **Picker mode** (`pickerUrl`): Opens upload UI in picker, uses OAuth authentication
- **WebDAV mode**: Uses pre-configured credentials for direct upload
- Uploads via WebDAV PUT request
- Creates public share links (if `createPublicShare: true`)
- Embeds PDFs and Office documents
- Requires CORS proxy for browser deployments (see docs)

**OneDrive**: ❌ Upload not yet implemented

**Dropbox**: ❌ Upload not yet implemented

To use upload, add `multicloud_upload` to your toolbar:

```javascript
toolbar: "undo redo | bold italic | link image media | multicloud multicloud_upload"
```

## Picker bridge contract

Each provider picker page should call `window.opener.postMessage` with this payload:

```js
{
  source: "tinymce-multicloud-plugin",
  type: "picked", // or "cancelled"
  providerId: "googleDrive",
  payload: {
    item: {
      id: "file-id",
      name: "filename.png",
      url: "https://...",
      embedUrl: "https://..." // optional
    },
    mode: "image" // "link" | "image" | "embed"
  }
}
```

A mock bridge page is available at `demo/picker-bridge-example.html`.

## Real integrations included

### Google Drive (GIS + Drive Picker)
- Uses Google Identity Services for OAuth token retrieval.
- Uses gapi client initialization and Google Picker SDK for file selection.
- Required config: `clientId`, `apiKey`.

### OneDrive
- Uses Microsoft OneDrive JavaScript picker SDK (`OneDrive.open`).
- Required config: `clientId`.

### Dropbox
- Uses Dropbox Chooser SDK (`Dropbox.choose`).
- Required config: `appKey`.

### BayernCloud (Nextcloud/WebDAV mode)
- **⚠️ Requires CORS Proxy**: Nextcloud APIs have CORS restrictions - browser deployments require a proxy (see below)
- Supports two modes:
  1. **Interactive Picker** (`pickerUrl`): Opens a popup with Nextcloud Login Flow v2 (OAuth-like), browses files via WebDAV, creates public share links
  2. **Pre-configured WebDAV** (`mode: "nextcloud-webdav"`): Uses pre-configured credentials for programmatic file access
- Uses Nextcloud Login Flow v2 for secure authentication
- Uses WebDAV `PROPFIND` to list files
- Optional OCS share creation for public links
- Works with any Nextcloud instance (BayernCloud, private Nextcloud servers, etc.)
- **CORS Proxy Setup**: See `docs/CLOUDFLARE_WORKER_SETUP.md` for free Cloudflare Worker proxy (100k requests/day free)
- **Alternative**: Deploy plugin on same domain as Nextcloud (no proxy needed)

#### Nextcloud CORS Proxy

Nextcloud instances block browser requests from different domains. To enable browser-based access:

**Option 1: Cloudflare Worker (Recommended - Free)**
1. Follow `docs/CLOUDFLARE_WORKER_SETUP.md`
2. Deploy the worker from `cloudflare-worker/nextcloud-proxy.js`
3. Update picker config with worker URL
4. ✅ Works from GitHub Pages, any domain

**Option 2: Same-Origin Deployment**
- Host plugin on same domain as Nextcloud
- No proxy needed (same-origin = no CORS)

**Option 3: Server-Side Integration**
- Use Nextcloud provider in backend/Node.js
- No CORS issues in server-to-server requests

## Popup fallback mode

Every built-in provider supports `pickerUrl`. If `pickerUrl` is set, the plugin opens that custom picker page and uses the bridge contract instead of the built-in SDK flow.

## Provider notes

### Google Drive
- Configure OAuth consent screen and allowed JS origins in Google Cloud.

### OneDrive
- Configure redirect URI and tenant restrictions in Entra/Microsoft app registration.

### Dropbox
- Ensure Chooser domain allowlist matches your deployment domain.

### BayernCloud
- For production, prefer bearer tokens or backend proxy endpoints over raw credentials in browser config.

## Security guidance

- Do not embed long-lived secrets in frontend plugin config.
- Prefer backend endpoints for OAuth code exchange and token management.
- Explicitly inform users before changing sharing permissions (public link/embed).
- Validate inserted URLs server-side if your application later renders them in high-trust contexts.

## Soft logging mode

By default, all DBC contract violations throw a `DBC.Infringement` error, which halts plugin initialization immediately. If your integration is stable and you prefer contract violations to be logged as warnings rather than hard errors — for example in a production environment where you want the plugin to degrade gracefully rather than break — you can switch to soft logging mode:

```js
import { configureMultiCloudValidation } from 'tinymce-multicloud-plugin';

configureMultiCloudValidation({
    throwOnInfringement: false,
    logToConsole: true,
});

// Then initialize TinyMCE as usual
tinymce.init({ ... });
```

Or using the global bundle:

```html
<script src="./dist/index.global.js"></script>
<script>
  TinyMceMultiCloudPlugin.configureMultiCloudValidation({
    throwOnInfringement: false,
    logToConsole: true,
  });

  tinymce.init({ ... });
</script>
```

> **Note:** `configureMultiCloudValidation` must be called **before** `tinymce.init()`. Contract checks run at plugin initialization time — once the plugin is registered and your options have been validated, changing these settings has no retroactive effect.

> **Recommendation:** Keep the default `throwOnInfringement: true` during development. Soft logging mode is intended for hardened production integrations where all configuration has been verified and you want to avoid breaking the editor if a future plugin update tightens a validation rule.

## Demo

Open `demo/tinymce-demo.html` after building. The demo includes mock pickers under `demo/pickers/` for all providers.

The demo auto-loads `demo/multicloud.config.js` if present; otherwise it falls back to local mock picker pages.

## File type support

How each provider handles different file types. Insert modes: **image** = `<img>`, **embed** = `<iframe>`, **audio** = `<audio>`, **video** = `<video>`, **link** = `<a>`.

### Google Drive

| File type | Extensions | Insert mode | Notes |
|---|---|---|---|
| Images | png, jpg, jpeg, gif, webp, bmp, svg, tiff | image | Direct `<img>` via Drive preview URL |
| Audio | mp3, wav, ogg, aac, m4a, flac, opus | audio | `<iframe>` preview (Drive transcodes audio) |
| Video | mp4, webm, mov, avi, mkv, m4v, wmv, flv | embed | `<iframe>` preview (Drive transcodes video) |
| PDF | pdf | embed | `<iframe>` via Drive preview URL |
| Office (OOXML) | docx, xlsx, pptx | embed | `<iframe>` via Drive preview URL |
| Office (legacy) | doc, xls, ppt | embed | `<iframe>` via Drive preview URL |
| OpenDocument | odt, ods, odp | embed | `<iframe>` via Drive preview URL |
| Archives | zip, rar, 7z, tar, gz, bz2, xz | link | Download link only |
| Other | anything else | link | Download link |

### Dropbox

| File type | Extensions | Insert mode | Notes |
|---|---|---|---|
| Images | png, jpg, jpeg, gif, svg, webp, bmp | image | Raw CDN URL via `dl.dropboxusercontent.com` |
| Audio | mp3, wav, ogg, aac, m4a, flac, opus, oga, weba | audio | `<audio>` with raw CDN URL |
| Video | mp4, webm, ogg, mov, m4v, avi, wmv, flv, mkv | embed | `<video>` with raw CDN URL |
| PDF | pdf | embed | `<iframe>` via Google Docs Viewer |
| Office (OOXML) | docx, xlsx, pptx, doc, xls, ppt | embed | `<iframe>` via Microsoft Office Online viewer |
| OpenDocument | odt, ods, odp | link | Google Docs Viewer cannot reliably load ODF |
| Archives | zip, rar, 7z, tar, gz, bz2, xz | link | Download link only |
| Other | anything else | link | Download link |

### OneDrive

| File type | Extensions | Insert mode | Notes |
|---|---|---|---|
| Images | png, jpg, jpeg, gif, svg, webp, bmp, tiff, apng, avif | image | Direct embed URL from OneDrive |
| Audio | mp3, wav, ogg, aac, m4a, flac, opus | audio | `<audio>` or `<iframe>` depending on download URL availability |
| Video | mp4, webm, ogg, mov, m4v, avi, wmv, flv, mkv | embed | `<video>` or `<iframe>` |
| PDF | pdf | embed | `<iframe>` |
| Office (OOXML) | docx, xlsx, pptx, doc, xls, ppt | embed | `<iframe>` |
| OpenDocument | odt, ods, odp | embed | `<iframe>` |
| Archives | zip, rar, 7z, tar, gz, bz2, xz | link | Download link only |
| Other | anything else | link | Download link |

### Nextcloud / BayernCloud

| File type | Extensions | Insert mode | Notes |
|---|---|---|---|
| Images | png, jpg, jpeg, gif, webp, bmp, tiff, apng, avif | image | `<img>` via public share URL |
| SVG | svg | link | Cross-origin SVG cannot be embedded reliably |
| Audio | mp3, wav, ogg, aac, m4a, flac, opus | link | Cross-origin streaming unreliable |
| Video | mp4, webm, ogg, mov, avi, wmv, flv, mkv | link | Cross-origin streaming unreliable |
| PDF | pdf | embed | `<iframe>` via Google Docs Viewer (requires public share) |
| Office (OOXML) | docx, xlsx, pptx | embed | `<iframe>` via Google Docs Viewer (requires public share) |
| Office (legacy) | doc, xls, ppt | link | Viewer support unreliable for legacy formats |
| OpenDocument | odt, ods, odp | link | Viewer support unreliable for ODF |
| Archives | zip, rar, 7z, tar, gz, bz2, xz | link | Download link only |
| Other | anything else | link | Download link |

> **Note on Nextcloud embedding**: Google Docs Viewer fetches files from its own servers, so the Nextcloud share link must be publicly accessible (not password-protected or on a private network). Embedding may fail intermittently due to Google's rate limiting on the viewer service.

## Scope and next steps

This repository gives you:
- production-ready TinyMCE plugin shell
- multi-provider adapter model
- real Google Drive integration (GIS + Picker)
- real OneDrive and Dropbox picker integrations
- BayernCloud Nextcloud/WebDAV adapter
- popup bridge fallback protocol

What you still need per provider:
- production credential/token strategy (server-backed where possible)
- tenant/security policy integration
