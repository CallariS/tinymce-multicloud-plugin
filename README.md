# TinyMCE MultiCloud Plugin

[![npm](https://img.shields.io/npm/v/@waxcode/tinymce-multicloud-plugin)](https://www.npmjs.com/package/@waxcode/tinymce-multicloud-plugin)
[![npm downloads](https://img.shields.io/npm/dt/@waxcode/tinymce-multicloud-plugin)](https://www.npmjs.com/package/@waxcode/tinymce-multicloud-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/demo-live-blue)](https://waxcode.net/Demos/TinyMCE-MultiCloud-Plugin/demo/tinymce-demo.html)
[![API Docs](https://img.shields.io/badge/API%20docs-GitHub%20Pages-blue)](https://callaris.github.io/tinymce-multicloud-plugin/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A TinyMCE plugin that lets users browse/pick files from multiple cloud providers and insert them into editor content as links, images, or embeds.

Built-in provider adapters:
- Google Drive
- OneDrive
- Dropbox
- BayernCloud

## Why this plugin exists

No open-source TinyMCE plugin existed that lets users pick files directly from their own Google Drive, OneDrive, or Dropbox accounts without routing files through a paid third-party service. The commercial alternatives (Filestack, Uploadcare) work by copying the selected file to their own CDN — which adds per-month costs, creates a vendor dependency, and moves file ownership away from the user.

This plugin was built to fill that gap: files stay in the user's own cloud account, the plugin just brokers the picker and returns a URL. No CDN, no per-upload quota, no vendor lock-in.

### Alternatives comparison

| | **TinyMCE MultiCloud Plugin** | **Filestack** | **Uploadcare** |
|---|---|---|---|
| **License / cost** | MIT, free | $69–$379+/month | $0–$119+/month |
| **File storage** | User's own cloud account | Filestack CDN (vendor) | Uploadcare CDN (vendor) |
| **Cloud sources** | Google Drive, OneDrive, Dropbox, Nextcloud/BayernCloud | Drive, Dropbox, OneDrive, Box, + more | Drive, Dropbox, OneDrive, + more |
| **Embed support** | ✅ link / image / iframe / audio+video | ✅ via CDN URL | ✅ via CDN URL |
| **Files stay in user's account** | ✅ Yes | ❌ Copied to vendor CDN | ❌ Copied to vendor CDN |
| **Bandwidth quota** | None (provider handles delivery) | 75–400 GB/month (plan limit) | Varies by plan |
| **Self-hostable** | ✅ Fully (drop a JS file) | ❌ SaaS only | ❌ SaaS only |
| **Open source** | ✅ MIT | ❌ | ❌ |

The trade-off: because files remain in the user's cloud storage, they must be publicly accessible for embedded content to be viewable by readers. The plugin handles this automatically — it creates the public share link via the provider's API so the user does not need to configure sharing manually. A warning is shown in the upload dialog to make clear that the file will be publicly accessible to anyone with the link.

---

## Why this architecture

Different cloud providers have different OAuth flows, SDKs, and picker UX constraints. The plugin uses a provider adapter contract and popup bridge protocol, so each provider can implement its own picker while TinyMCE integration stays consistent.

## Design-by-Contract validation ([XDBC](https://github.com/CallariS/XDBC))

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
- **Configurable behaviour** — two independent named DBC instances allow each layer to be configured separately (see [Soft logging mode](#soft-logging-mode) below):
  - `globalThis.MultiCloud.Validation.Config` — governs configuration contract checks
  - `globalThis.MultiCloud.Validation.Boundary` — governs [Zod](https://zod.dev) boundary schema checks on provider API data
- **Single error type** — all validation failures, whether from DBC contracts or [Zod](https://zod.dev) schema checks, throw `DBC.Infringement` ([XDBC](https://github.com/CallariS/XDBC)'s `ZOD.tsCheck` routes through `DBC.reportTsCheckInfringement` internally).

## [Zod](https://zod.dev) boundary validation

In addition to [XDBC](https://github.com/CallariS/XDBC) DBC contracts on configuration, the plugin validates all data that crosses provider API boundaries at runtime using **[XDBC](https://github.com/CallariS/XDBC)'s [Zod](https://zod.dev) integration** (`ZOD.tsCheck` from `xdbc/src/DBC/ZOD`). [Zod](https://zod.dev) schemas are defined with the `zod` library but validation is always run through [XDBC](https://github.com/CallariS/XDBC) — keeping the error shape and behaviour consistent with the rest of the contract layer.

Where DBC validates *input configuration* before any logic runs, [XDBC](https://github.com/CallariS/XDBC)'s [Zod](https://zod.dev) implementation validates *what providers return* before that data is trusted and used.

### What is validated

| Boundary | Schema | Validates |
|---|---|---|
| Any provider result | `pickerResultSchema` | `item.id`, `item.name`, `item.url` non-empty; all URL fields are valid URLs; `mode` is a known enum value |
| Google Picker callback | `googleDocSchema` | `id` required and non-empty; `url`, `thumbnailLink` are valid URLs when present |
| OneDrive navigable picker | `oneDriveFileSchema` | `name` required; `webUrl`, `@microsoft.graph.downloadUrl` are valid URLs when present; `file.mimeType` is a string when present |
| Dropbox Chooser callback | `dropboxFileSchema` | `link` required and a valid URL; `thumbnailLink` is a valid URL when present |
| BayernCloud WebDAV node | `webDavNodeSchema` | `id`, `name`, `url`, `webdavPath` non-empty; `url` is a valid URL; `isDirectory` is a boolean |

### Error type

Because validation runs through `ZOD.tsCheck` which calls `DBC.reportTsCheckInfringement` on failure, both DBC contract violations and [Zod](https://zod.dev) schema failures throw `DBC.Infringement`. The boundary layer uses its own DBC instance (`globalThis.MultiCloud.Validation.Boundary`) so it can be configured independently from config-layer checks.

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

## TinyMCE compatibility

| TinyMCE version | Status |
|---|---|
| 6.x | ✅ Tested and supported |
| 7.x | ✅ Tested and supported |

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

## TinyMCE usage

```html
<script src="https://cdn.tiny.cloud/1/no-api-key/tinymce/7/tinymce.min.js"></script>
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

**OneDrive**: ✅ Full upload support
- Uploads files to the user's OneDrive via the Microsoft Graph API
- Creates a public sharing link
- Embeds PDFs and Office documents

**Dropbox**: ✅ Full upload support
- Uploads files to the user's Dropbox via the Dropbox API
- Uses OAuth implicit grant flow; token is cached in `localStorage` with expiry tracking
- Creates a shared link for embedding

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

> **⚠️ Google Drive embeds require the viewer to be signed in to Google**
>
> All Google Drive embeds (`drive.google.com/file/d/.../preview`) require Google cookies inside the iframe. Modern browsers block third-party cookies by default, so any viewer who is **not already signed in to Google** in their browser will see a login prompt instead of the file.
>
> **Uploaded files** — the plugin automatically sets sharing to "Anyone with the link" after upload, so the file itself is accessible, but the embed still requires Google cookies.
>
> **Picked files** — sharing is **not changed** by the plugin. Files remain at whatever sharing setting they had in Drive (usually "Restricted" / private). Viewers who are not the file owner will not be able to see them at all.
>
> **Recommendations:**
> - For content that must be publicly visible to all readers, **use the upload button** (↑) rather than the picker (↓), or manually set the file to "Anyone with the link" in Google Drive first.
> - To set a file to "Anyone with the link" in Google Drive: right-click the file → **Share** → click **"Restricted"** dropdown → select **"Anyone with the link"** → click **Done**.
> - For truly public embeds with no sign-in requirement, prefer **Dropbox** or **OneDrive** — their embed mechanisms do not depend on the viewer having a Google account.

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

The plugin uses two independent DBC instances — one for **configuration checks** and one for **[Zod](https://zod.dev) boundary schema checks** — so each layer can be configured separately. By default both layers throw `DBC.Infringement` on violations.

Use `configureMultiCloudValidation` with `config` and/or `boundary` sub-keys to change the behaviour of either layer:

```js
import { configureMultiCloudValidation } from 'tinymce-multicloud-plugin';

// Soft-log config violations only (useful for hardened production deployments).
// Boundary checks remain strict — unexpected API shapes still throw.
configureMultiCloudValidation({
    config: { throwOnInfringement: false, logToConsole: true },
});

// Both layers in soft logging mode:
configureMultiCloudValidation({
    config:   { throwOnInfringement: false, logToConsole: true },
    boundary: { throwOnInfringement: false, logToConsole: true },
});

// Then initialize TinyMCE as usual
tinymce.init({ ... });
```

Or using the global bundle:

```html
<script src="./dist/index.global.js"></script>
<script>
  TinyMceMultiCloudPlugin.configureMultiCloudValidation({
    config: { throwOnInfringement: false, logToConsole: true },
  });

  tinymce.init({ ... });
</script>
```

| Layer | DBC path | What it covers |
|---|---|---|
| `config` | `globalThis.MultiCloud.Validation.Config` | Plugin options, provider credential shape, `defaultProvider` contract |
| `boundary` | `globalThis.MultiCloud.Validation.Boundary` | Provider API response shapes ([Zod](https://zod.dev) schemas) |

> **Note:** `configureMultiCloudValidation` must be called **before** `tinymce.init()`. Contract checks run at plugin initialization time — once the plugin is registered and your options have been validated, changing these settings has no retroactive effect.

> **Recommendation:** Keep both layers at their default `throwOnInfringement: true` during development. Soft logging mode for `config` is intended for hardened production deployments where all configuration has been verified. The `boundary` layer should generally stay strict — unexpected shapes in provider API responses indicate a real integration problem.

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
