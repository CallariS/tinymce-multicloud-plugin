# TinyMCE MultiCloud Plugin

A TinyMCE plugin that lets users browse/pick files from multiple cloud providers and insert them into editor content as links, images, or embeds.

Built-in provider adapters:
- Google Drive
- OneDrive
- Dropbox
- BayernCloud

## Why this architecture

Different cloud providers have different OAuth flows, SDKs, and picker UX constraints. The plugin uses a provider adapter contract and popup bridge protocol, so each provider can implement its own picker while TinyMCE integration stays consistent.

## Install

```bash
npm install
npm run build
```

## Production quickstart

1. Copy `demo/multicloud.config.example.js` to `demo/multicloud.config.js`.
2. Fill in your real cloud app IDs/keys and BayernCloud endpoint values.
3. Follow the provider console checklists in `docs/PRODUCTION_SETUP.md`.

## GitHub Pages demo deployment

This repository includes a Pages workflow at `.github/workflows/deploy-pages.yml`.

### Manual local check

```bash
npm run pages:build
```

This creates a static bundle in `site/`.

### Automatic publish

1. Push to `main` or `master`.
2. In GitHub repository settings, ensure Pages is enabled and uses GitHub Actions.
3. Wait for the `Deploy GitHub Pages` workflow to complete.

The demo URL will be:

- `https://<owner>.github.io/<repo>/demo/tinymce-demo.html`

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
    toolbar: "undo redo | bold italic | link image media | multicloud",

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
        mode: "nextcloud-webdav",
        baseUrl: "https://your-bayerncloud.example",
        username: "user",
        password: "app-password",
        webdavPath: ""
      }
    },

    multicloud_default_provider: "googleDrive",
    multicloud_default_insert_mode: "link",
    multicloud_dialog_title: "Insert From Cloud",
    multicloud_popup_timeout_ms: 120000
  });
</script>
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
- Uses WebDAV `PROPFIND` to list files.
- Optional OCS share creation for public links.
- Required config: `baseUrl`, `username` and either `password` or `bearerToken`.

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

## Demo

Open `demo/tinymce-demo.html` after building. The demo includes mock pickers under `demo/pickers/` for all providers.

The demo auto-loads `demo/multicloud.config.js` if present; otherwise it falls back to local mock picker pages.

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
