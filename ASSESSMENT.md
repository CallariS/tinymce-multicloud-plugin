# Codebase Assessment — TinyMCE MultiCloud Plugin

**Repository:** `CallariS/tinymce-multicloud-plugin`  
**Assessment date:** May 2026  
**HEAD commit:** `bc38884`  
**Author:** Salvatore Callari &lt;Callari@WaXCode.net&gt;  
**License:** MIT

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [Market Context](#2-market-context)
3. [Technology Stack](#3-technology-stack)
4. [Architecture Overview](#4-architecture-overview)
5. [Source Code Metrics](#5-source-code-metrics)
6. [Provider Coverage and Capabilities](#6-provider-coverage-and-capabilities)
7. [Validation and Contract Strategy](#7-validation-and-contract-strategy)
8. [Security Profile](#8-security-profile)
9. [Test Suite](#9-test-suite)
10. [Build and Release Pipeline](#10-build-and-release-pipeline)
11. [Infrastructure and Deployment](#11-infrastructure-and-deployment)
12. [Documentation Quality](#12-documentation-quality)
13. [Extensibility and Integration Surface](#13-extensibility-and-integration-surface)
14. [Open Risks and Known Limitations](#14-open-risks-and-known-limitations)
15. [Maturity Rating Summary](#15-maturity-rating-summary)
16. [Hiring Signal Summary (for recruiters)](#16-hiring-signal-summary-for-recruiters)

---

## 1. Project Summary

**TinyMCE MultiCloud Plugin** is a zero-dependency (runtime) browser plugin for the [TinyMCE](https://www.tiny.cloud/) rich text editor that lets end users browse, pick, and upload files from four enterprise cloud storage providers — **Google Drive**, **Microsoft OneDrive**, **Dropbox**, and **BayernCloud (Nextcloud/WebDAV)** — and insert them into editor content as links, inline images, embedded iframes, or native audio/video elements.

The plugin ships as a single self-contained IIFE bundle (`dist/index.global.js`, ~140 KB minified) with no peer runtime dependencies beyond TinyMCE itself. TypeScript declarations (`dist/index.d.ts`) are co-bundled so integrators get full IntelliSense. It is also published as an ESM and CJS package for TypeScript consumers who want to import types and the registration API directly.

**Intended audience:** organisations running TinyMCE 6 or 7 that need users to insert cloud-hosted content without leaving the editor, and that may operate private on-premises storage (Nextcloud/BayernCloud) alongside public cloud services.

---

## 2. Market Context

No open-source TinyMCE plugin existed that allows users to pick files directly from their own Google Drive, OneDrive, or Dropbox accounts without routing files through a paid third-party service. Commercial alternatives (Filestack at $69–$379+/month, Uploadcare at $0–$119+/month) copy files to their own CDN on pick — which introduces per-month costs, vendor lock-in, and transfers file ownership away from the user.

This plugin fills that gap: files remain in the user's own cloud account; the plugin brokers the picker and returns a URL. No CDN, no per-upload quota, no vendor.

| | **TinyMCE MultiCloud Plugin** | **Filestack** | **Uploadcare** |
|---|---|---|---|
| **Cost** | Free (MIT) | $69–$379+/month | $0–$119+/month |
| **File storage** | User's own cloud account | Filestack CDN (vendor) | Uploadcare CDN (vendor) |
| **Cloud sources** | Drive, OneDrive, Dropbox, Nextcloud | Drive, Dropbox, OneDrive, Box, + more | Drive, Dropbox, OneDrive, + more |
| **Files stay in user's account** | ✅ | ❌ Copied to vendor CDN | ❌ Copied to vendor CDN |
| **Bandwidth quota** | None | 75–400 GB/month | Varies by plan |
| **Self-hostable** | ✅ Fully | ❌ SaaS only | ❌ SaaS only |
| **Open source** | ✅ MIT | ❌ | ❌ |

The trade-off: because files remain in the user's cloud storage, they must be publicly accessible for embedded content to be viewable by readers. The plugin handles public share link creation automatically via each provider's API, and shows a warning in the upload dialog to make the public accessibility explicit.

---

## 3. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | 5.6 (`strict: true`) |
| Target runtime | ES2020 + DOM | — |
| Bundler | tsup (esbuild) | 8.5 |
| Output formats | IIFE, ESM, CJS | — |
| Test framework | Jest | 29.7 |
| Test environments | Node (unit), jsdom (provider) | — |
| Contract validation | XDBC (Design-by-Contract) | 1.0.217 |
| Schema validation | Zod | 3.25 |
| API documentation | TypeDoc | 0.28 |
| CORS proxy | Cloudflare Worker (plain JS) | — |
| CI/CD | GitHub Actions | — |
| Package manager | npm | 10+ |
| Node version (prescribed) | 20 (`.nvmrc`) | — |

**Runtime dependencies:** 2 (`xdbc`, `zod`). Both are used only for configuration validation and API boundary checking; neither is in the hot path.

**Peer dependency:** `tinymce >= 6` (optional — the plugin can be loaded before TinyMCE without failure).

---

## 4. Architecture Overview

### 4.1 Provider adapter pattern

Every cloud integration is expressed as a `CloudProvider` object implementing a two-method contract:

```ts
interface CloudProvider {
  id: CloudProviderId;
  label: string;
  pick(context: PickerContext): Promise<PickerResult | null>;
  upload?(context: PickerContext, file: File): Promise<PickerResult | null>;
}
```

The `pick` method authenticates the user, opens a file picker (native SDK or popup bridge), and returns a normalised `PickerResult`. The optional `upload` method accepts a browser `File` and returns the same result shape after uploading. This symmetry means `insertResult` in `index.ts` handles both flows identically — there is no separate insertion code path per operation type.

### 4.2 Dual picker strategies

Each provider supports two mutually exclusive picker strategies:

1. **SDK mode** (no `pickerUrl` in config): uses the provider's own JavaScript SDK loaded lazily via `loadScript`. The SDK is initialised at first use; subsequent calls reuse the loaded instance. Google Drive uses GIS + gapi Picker API; OneDrive uses MSAL 2.x + a navigable file browser overlay; Dropbox uses the official Dropins chooser; BayernCloud uses direct WebDAV PROPFIND + OCS sharing.

2. **Popup bridge mode** (`pickerUrl` set): opens a host-controlled popup window and communicates results via `window.postMessage`. This allows any custom file picker to integrate with the plugin without touching plugin code. The popup protocol is documented and reference implementations are included for all four providers.

### 4.3 Insert mode resolution

Once a provider returns a `PickerResult`, the plugin determines how to insert the file using a layered resolution:

```
result.mode → plugin defaultInsertMode → detectInsertMode(item)
```

`detectInsertMode` inspects MIME type first, then file extension, then URL pattern, producing one of four modes: `link`, `image`, `embed`, `audio`. The insertion code handles each mode, including fallbacks (e.g. audio with no direct download URL falls back to an iframe embed of the provider's preview page).

### 4.4 Dialog system

Both the picker and upload dialogs are implemented through TinyMCE's built-in `windowManager.open` API. Provider selection uses an `htmlpanel` containing a dynamically generated CSS grid of provider buttons. All HTML injected into panels passes through `escapeHtml` before string concatenation, preventing XSS.

Per-dialog random handler keys (`window['__mc_<random>']`) are generated on dialog open and deleted on close, preventing predictable global name collisions with other page scripts.

The upload dialog displays an amber public-sharing warning panel above the provider list, informing users that uploaded files will be publicly accessible. The warning text is passed through `editor.translate()` for i18n and can be overridden via the `uploadPublicSharingWarning` plugin option.

### 4.5 Directory map

```
src/
  index.ts              Plugin entry, dialog management, insertResult
  types.ts              All exported TypeScript interfaces and types
  providers/
    index.ts            builtInProviders() factory
    popupProvider.ts    Origin-validated postMessage bridge
    bayerncloud.ts      Nextcloud WebDAV + OCS provider
    dropbox.ts          Dropbox Chooser + Upload API provider
    googleDrive.ts      GIS + Picker API + Drive v3 provider
    oneDrive.ts         MSAL 2.x + Graph API provider
    utils.ts            loadScript (SRI-capable, timeout-guarded), detectInsertMode
  validation/
    boundary.ts         Zod schemas for all provider API response shapes
    config/
      validators.ts     XDBC DBC contract validators for plugin configuration
tests/
  providers/            10 test files, jsdom environment
  validation/           2 test files, Node environment
cloudflare-worker/
  nextcloud-proxy.js    CORS proxy Worker for Nextcloud deployments
docs/
  PRODUCTION_SETUP.md   Per-provider integration guide with CSP directives
  CLOUDFLARE_WORKER_SETUP.md  Cloudflare Worker setup and security guide
scripts/
  prepare-pages.mjs           GitHub-hosted CDN site assembler (legacy)
  prepare-pages-selfhost.mjs  Self-hosted site assembler (waxcode.net)
  prepare-docs-pages.mjs      API-docs-only GitHub Pages assembler
  generate-changelog.mjs      Conventional-changelog automation script
demo/
  tinymce-demo.html     Live demo with light/dark toggle and lang switcher
  pickers/              Reference picker bridge pages for all four providers
langs/
  de.js                 German TinyMCE i18n strings
  it.js                 Italian TinyMCE i18n strings
```

---

## 5. Source Code Metrics

| Metric | Value |
|---|---|
| Source lines (TypeScript, `src/`) | ~4,400 |
| Test lines (TypeScript, `tests/`) | ~1,885 |
| Test-to-source ratio | ~0.43 |
| Test suites | 10 |
| Test cases | 224 (all passing) |
| Production bundle size (minified IIFE) | ~140 KB |
| TypeScript declaration file | ~11 KB |
| Total commits | 246 |
| Runtime dependencies | 2 |
| `any` escapes in production code | < 10 (editor API + provider SDK boundaries; all localised) |

---

## 6. Provider Coverage and Capabilities

| Provider | Pick | Upload | Embed PDF | Embed Office Doc | Embed Image | Audio/Video | Notes |
|---|---|---|---|---|---|---|---|
| **Google Drive** | ✅ | ✅ | ✅ Drive viewer | ✅ Drive viewer | ✅ thumbnail | ✅ Drive viewer | GIS OAuth, Picker API, Drive v3 |
| **OneDrive** | ✅ | ✅ | ✅ OD embed viewer | ✅ Office Online | ✅ OD embed | ✅ OD embed | MSAL 2.x, Graph API, `createLink` |
| **Dropbox** | ✅ | ✅ | ✅ `raw=1` | ✅ Office Online | ✅ `raw=1` | ✅ `raw=1` | Chooser SDK + Upload API |
| **BayernCloud** | ✅ | ✅ | ✅ Google Docs Viewer | ✅ Google Docs Viewer | ✅ direct | ✅ direct | WebDAV + OCS sharing |

**Pick** = user selects an existing file from the cloud.  
**Upload** = user uploads a local file to the cloud, then inserts it.  
`raw=1` = Dropbox raw content URL (must remain on `www.dropbox.com`; `dl.dropboxusercontent.com` returns 403 for `rlkey` links).

Public share links are created automatically by the plugin via each provider's API — users do not need to configure sharing manually.

### Popup bridge

All four providers can be driven by a custom popup URL, giving integrators full control over picker UI without modifying plugin code. The bridge protocol is stable and documented; reference implementations for all four providers are included under `demo/pickers/`.

---

## 7. Validation and Contract Strategy

The plugin uses a two-layer validation architecture to catch configuration errors early and provider API shape violations at runtime.

### 7.1 Configuration layer — XDBC Design-by-Contract

All `tinymce.init()` option values are validated before any plugin logic runs. Validators are decorator-driven XDBC classes registered under `globalThis.MultiCloud.Validation.Config`. Each precondition expresses a typed contract with an actionable hint message (e.g. *"Did you set Google Drive clientId?"*). Violations throw `DBC.Infringement` rather than silent no-ops or cryptic SDK errors.

SDK-mode field validation is skipped when a provider has `pickerUrl` set or `enabled: false`, avoiding false positives for partially-configured deployments.

The DBC instance is configurable at runtime via `configureMultiCloudValidation`, allowing switch to soft-logging mode (warnings instead of throws) in integration tests.

Validated plugin options include: `providers` (plain object), `defaultProvider` (string, must exist in map), `defaultInsertMode` (enum), `popupTimeoutMs` (positive number), `dialogTitle` (non-empty string), `uploadPublicSharingWarning` (non-empty string when set), and per-provider SDK credentials when SDK mode is active.

### 7.2 Boundary layer — Zod schemas via XDBC

Every response from a provider API or picker callback is validated against a Zod schema before any of its fields are used:

| Schema | Validates |
|---|---|
| `pickerResultSchema` | Final result shape (all URL fields are valid URLs; known enum `mode` values) |
| `googleDocSchema` | Google Picker callback payload |
| `oneDriveFileSchema` | OneDrive Graph API drive item |
| `dropboxFileSchema` | Dropbox Chooser callback file object |
| `webDavNodeSchema` | BayernCloud WebDAV PROPFIND node |

Validation is routed through `XDBC.ZOD.tsCheck` so contract violations and schema failures produce the same `DBC.Infringement` type using the `globalThis.MultiCloud.Validation.Boundary` instance, independently configurable from the config layer.

### 7.3 HTML injection safety

Values injected into TinyMCE `htmlpanel` markup pass through `escapeHtml` (escapes `&`, `<`, `>`, `"`, `'`). Provider IDs used in `data-provider` attributes and `onclick` strings are also escaped, preventing XSS if a provider ID or label contains HTML metacharacters.

---

## 8. Security Profile

### 8.1 Security controls in place

| Control | Implementation |
|---|---|
| Randomised dialog handler keys | Per-dialog `__mc_<random>` keys generated on open, deleted on close — prevents predictable global name collisions |
| SRI on MSAL | MSAL 2.38.0 loaded with `sha384-…` integrity attribute via `loadScript` |
| `postMessage` origin validation | `popupProvider.ts` validates `event.origin` against the expected picker popup origin before accepting any message |
| Zod API boundary validation | All provider API responses validated before field access |
| `escapeHtml` on all panel HTML | Prevents XSS from injected provider labels, IDs, or translated strings |
| `loadScript` timeout | 15-second timeout prevents stalled script elements from hanging the picker indefinitely |
| No credentials in repository | `demo/multicloud.config.js` is gitignored; CI injects secrets at build time only |
| OAuth token hygiene | Dropbox token stored in `localStorage` (industry-standard for SPA implicit grant); cleared on 401 and expiry |
| CORS proxy security | HTTPS-only targets; CORS allowlist; configurable target host allowlist (`ALLOWED_TARGET_HOSTS`); per-IP rate limiting (60 req/min, in-code sliding window); `origin`/`referer` headers stripped |
| `redirectUri` respected | OneDrive `redirectUri` threaded from config through all MSAL `getAccessToken` call sites |

### 8.2 Informational notes

| Ref | Classification | Notes |
|---|---|---|
| I0 | Informational | Google Drive (gapi/GIS) and Dropbox (Dropins) SDK scripts are delivered from vendor CDNs that silently update their content — SRI hash pinning is architecturally incompatible with this delivery model and is not possible for any application using these SDKs in the browser. This is the standard, documented consumption pattern for both SDKs; self-hosting is the only alternative (separate maintenance burden). Mitigations documented in `PRODUCTION_SETUP.md`. |
| I1 | Informational | Source maps published intentionally — OSS project; maps aid community debugging |
| I2 | Informational | Residual `any` types in `oneDrive.ts` are bounded to SDK boundary points; do not propagate into plugin logic after Zod validation |
| I3 | Informational | No retry on transient API failures — out of scope for v0.1; manual re-open is the recovery path |

### 8.3 Cloudflare Worker security posture

The CORS proxy (`cloudflare-worker/nextcloud-proxy.js`) is a self-contained plain-JS Worker requiring no external bindings or dashboard configuration. Its security controls are all implemented in code so they are active from a paste-and-deploy workflow:

- HTTPS-only target validation
- URL well-formedness check on the `target` parameter
- CORS `Origin` allowlist (configurable)
- Target host allowlist via `ALLOWED_TARGET_HOSTS` environment variable
- Per-IP rate limiting: 60 requests per minute, sliding window, in-memory per-isolate
- `/health` endpoint for external monitoring
- `origin` and `referer` request headers stripped before forwarding

---

## 9. Test Suite

### 9.1 Configuration

Two Jest projects run in a single invocation:

| Project | Environment | Covers |
|---|---|---|
| `unit` | Node | XDBC DBC contract validators, Zod boundary schemas |
| `providers` | jsdom | All four provider adapters, popup bridge, `loadScript`, `registerProvider`/`unregisterProvider` |

### 9.2 Current results

```
Test Suites: 10 passed, 10 total
Tests:       224 passed, 224 total
```

### 9.3 Coverage areas

| Area | What is tested |
|---|---|
| Config validators | Valid options, each invalid field individually, SDK-mode skip when `pickerUrl` set, soft-logging mode |
| Boundary schemas | Valid and malformed payloads for all five schemas; URL field rejection on non-URLs |
| Google Drive | `launchPicker` happy path, boundary validation, error propagation |
| OneDrive | `openOneDrivePicker` happy path, boundary validation, Graph API failure |
| Dropbox | Chooser happy path, upload flow, `raw=1` URL construction, OAuth token caching |
| BayernCloud | WebDAV listing, file selection, public share creation, upload flow |
| `loadScript` | Fresh load, cached load (idempotent), SRI attribute stamping, timeout on stalled script |
| `popupProvider` | Message acceptance, origin rejection, timeout, cancellation |
| `registerProvider` / `unregisterProvider` | Registry CRUD, provider override semantics |

### 9.4 Tooling notes

- `jest.isolateModules` resets module-level singletons (MSAL instance, Dropbox token cache) between test cases.
- `(global as any).fetch = jest.fn()` is used instead of `jest.spyOn(globalThis, 'fetch')` because jsdom does not set `fetch` as an own property on `globalThis`.
- `ts-jest` with `warnOnly: true` allows tests to run despite pre-existing TypeScript errors in `oneDrive.ts` at the SDK boundary.

---

## 10. Build and Release Pipeline

### 10.1 Build scripts

| Script | Output |
|---|---|
| `npm run build` | `dist/` — IIFE + ESM + CJS bundles, source maps, `.d.ts` |
| `npm run dev` | tsup `--watch` — unminified, console retained |
| `npm run typecheck` | TypeScript `--noEmit` check |
| `npm run test` | Jest — all 224 tests |
| `npm run docs:api` | TypeDoc → `docs/api/` |
| `npm run docs:pages` | Build + API docs → `site/` (GitHub Pages target) |
| `npm run pages:build` | Build + API docs + demo → `site/` (waxcode.net target) |
| `npm run changelog` | Append unreleased conventional commits to `CHANGELOG.md` |
| `npm run changelog:full` | Regenerate full `CHANGELOG.md` from git history |

Build configuration:
- esbuild target: ES2020
- IIFE global name: `TinyMceMultiCloudPlugin`
- Minification: production only
- `console.*` calls: dropped by esbuild in production, retained in dev/watch

### 10.2 CI/CD workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy-pages.yml` | Push to `master`/`main` | Build plugin + TypeDoc → deploy API reference to GitHub Pages. No provider secrets required. |
| `worker-health.yml` | Daily 06:00 UTC + manual | Ping Worker `/health` endpoint; fail loudly on non-200. Reads `CLOUDFLARE_WORKER_URL` repository variable. |
| `check-demo-links.yml` | Daily + manual | Crawl demo page URLs; fail on broken links. |
| `guard-generated-site.yml` | Push | Prevent accidental commit of generated `site/` output. |

### 10.3 Dependency management

Dependabot is configured (`.github/dependabot.yml`) to open weekly PRs every Monday:
- **npm**: runtime dependencies (`xdbc`, `zod`) get individual PRs; all dev dependencies are grouped into a single PR.
- **GitHub Actions**: action version pins updated automatically.

### 10.4 TypeDoc API reference

Auto-deployed to `https://callaris.github.io/tinymce-multicloud-plugin/` on every push to master. All exported types, interfaces, and functions carry full `@param`/`@returns`/`@throws` JSDoc.

---

## 11. Infrastructure and Deployment

### 11.1 Deployment options

| Mode | Description |
|---|---|
| CDN / self-hosted | Drop `dist/index.global.js` into any static host. No server component needed for Google Drive, OneDrive, or Dropbox. |
| npm package | `npm install @waxcode/tinymce-multicloud-plugin` — TypeScript consumers import `registerProvider`, `unregisterProvider`, and all config types. |
| GitHub Pages | API docs auto-deployed via CI. No API keys required. |
| Demo (waxcode.net) | Full live demo at `https://waxcode.net/Demos/TinyMCE-MultiCloud-Plugin/demo/tinymce-demo.html`. Self-hosts TinyMCE. Manual theme toggle (light/dark) with `localStorage` persistence. Language switcher (EN/DE/IT). |

### 11.2 BayernCloud CORS proxy

BayernCloud/Nextcloud is the only provider requiring server-side infrastructure — Nextcloud enforces same-origin policy on WebDAV and OCS endpoints.

A production-ready Cloudflare Worker (`cloudflare-worker/nextcloud-proxy.js`) is included and deployed via `npx wrangler deploy`. The Cloudflare free tier (100,000 requests/day) covers typical editorial workloads. All security controls are in the Worker code — no Cloudflare dashboard configuration needed.

### 11.3 Content Security Policy

A full per-provider CSP directive reference is maintained in `docs/PRODUCTION_SETUP.md`:

| Directive | Scope |
|---|---|
| `script-src` | Google GIS/gapi, MSAL CDN, Dropbox Dropins (no external scripts for BayernCloud) |
| `frame-src` | Provider picker popups, Office Online, Google Docs Viewer |
| `connect-src` | Google APIs, Microsoft Graph, Dropbox API, Nextcloud origin |
| `img-src` | Provider thumbnail endpoints |

---

## 12. Documentation Quality

| Document | Contents |
|---|---|
| `README.md` | Market gap context, alternatives comparison, architecture rationale, validation strategy, full `tinymce.init()` usage example, capability matrix, popup bridge contract, per-provider setup, API docs badge |
| `docs/PRODUCTION_SETUP.md` | Per-provider cloud console checklists, OAuth registration steps, CSP directive tables, SRI risk section with mitigations |
| `docs/CLOUDFLARE_WORKER_SETUP.md` | Step-by-step Worker deployment, target host allowlist guide, monitoring setup with GitHub Actions health-check workflow |
| `CONTRIBUTING.md` | Prerequisites, setup, development workflow, project layout, testing conventions, provider addition guide, code style |
| `CHANGELOG.md` | Full change history since v0.1.0; automatable via `npm run changelog` |
| TypeDoc API reference | All exported types, interfaces, functions; auto-deployed to GitHub Pages |
| In-source JSDoc | All functions and classes carry JSDoc regardless of export status |

---

## 13. Extensibility and Integration Surface

### 13.1 Public API

```ts
registerProvider(provider: CloudProvider): void
unregisterProvider(id: string): void

// All configuration interfaces are exported
import type { CloudProvider, PickerResult, CloudItem, MultiCloudPluginOptions } from '@waxcode/tinymce-multicloud-plugin';
```

### 13.2 Custom provider interface

```ts
interface CloudProvider {
  id: string;
  label: string;
  pick(context: PickerContext): Promise<PickerResult | null>;
  upload?(context: PickerContext, file: File): Promise<PickerResult | null>;
}
```

A provider with the same `id` as a built-in overrides it. Registration happens at runtime before `tinymce.init()` — no rebuild required.

### 13.3 Popup bridge contract

```js
window.opener.postMessage({
  source: "tinymce-multicloud-plugin",
  type: "picked",        // or "cancelled"
  providerId: "<id>",
  payload: { item: { id, name, url, embedUrl? }, mode? }
}, targetOrigin);
```

### 13.4 Plugin options (selected)

| Option | Type | Purpose |
|---|---|---|
| `multicloud_providers` | object | Per-provider SDK credentials and feature flags |
| `multicloud_default_provider` | string | Pre-selected provider in the picker dialog |
| `multicloud_default_insert_mode` | `link\|image\|embed` | Fallback insert mode when auto-detection yields no result |
| `multicloud_dialog_title` | string | Localised picker dialog title |
| `multicloud_popup_timeout_ms` | number | Milliseconds before a popup picker times out |
| `multicloud_upload_public_sharing_warning` | string | Custom warning text in the upload dialog (passed through `editor.translate()`) |

### 13.5 Validation configurability

```ts
configureMultiCloudValidation({
  config: { mode: 'log' },     // soft-log config violations instead of throwing
  boundary: { mode: 'throw' }  // keep boundary violations as hard errors
});
```

---

## 14. Open Risks and Known Limitations

| Ref | Severity | Item | Impact |
|---|---|---|---|
| O0 | Informational | Google Drive (gapi/GIS) and Dropbox (Dropins) SDKs are loaded from vendor CDNs that silently update their content | SRI hash pinning is architecturally incompatible with this SDK delivery model — it applies to every application using these SDKs, not a choice made by this plugin. Self-hosting is the only alternative. Mitigations documented in `PRODUCTION_SETUP.md`. |
| O1 | Medium | MSAL module-level singleton in `oneDrive.ts` | If `redirectUri` changes between plugin registrations on the same page, the singleton retains the first-call value. Affects edge-case multi-tenant SPA scenarios only. |
| O2 | Low | No retry on transient API failures | A single 500 from Graph API or Dropbox API surfaces as a plugin error; manual re-open is required. |
| O3 | Low | Dropbox OAuth token in `localStorage` | Standard for SPA implicit grant. Token cleared on 401 and expiry. Admins with strict storage policies may require an alternative grant flow. |
| O4 | Low | Residual `any` in `oneDrive.ts` SDK boundary | Cannot be typed from SDK declarations; bounded to the Graph API response surface and does not propagate past Zod validation. |
| O5 | Informational | Worker rate limiter is per-isolate | Cloudflare runs the Worker across many edge nodes; the in-memory rate limit is not globally consistent. Sufficient for burst protection from a single browser session; not a global throttle. |
| O6 | Informational | Source maps published with the bundle | Intentional for OSS; review if deployed in a commercial closed-source context. |

---

## 15. Maturity Rating Summary

| Dimension | Rating | Notes |
|---|---|---|
| **Code quality** | ★★★★☆ | TypeScript strict mode; bounded `any`; consistent style; full JSDoc on all hot paths |
| **Test coverage** | ★★★★☆ | 224 tests across 10 suites; happy paths and validation edge cases covered; no live API integration tests (appropriate for a library) |
| **Security** | ★★★★☆ | Randomised handler keys; SRI on MSAL; origin-pinned postMessage; Zod boundary validation; `escapeHtml` on all injected HTML; rate-limited CORS proxy; vendor CDN SDK delivery model noted (industry-standard, not plugin-introduced) |
| **Documentation** | ★★★★★ | README with market context, CONTRIBUTING, production guide, Cloudflare setup guide, CHANGELOG, TypeDoc API reference — all current and accurate |
| **Architecture** | ★★★★☆ | Clean provider adapter pattern; dual picker strategy (SDK + popup bridge); consistent insert-mode resolution; some SDK coupling inherent to provider integration |
| **Extensibility** | ★★★★★ | `registerProvider`/`unregisterProvider`; popup bridge protocol; full type exports; runtime provider override; validation configurability |
| **Operations** | ★★★★★ | Automated CI/CD; daily health check; Dependabot; `.nvmrc`; changelog automation; zero-secrets repository; one-command deployments for all targets |
| **Overall maturity** | ★★★★☆ | Production-ready for TinyMCE 6/7 deployments with appropriate OAuth app registration and CSP. Recommended for enterprise editorial platforms with multi-cloud storage requirements. |