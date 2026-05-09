# Codebase Assessment — TinyMCE MultiCloud Plugin

**Repository:** `CallariS/tinymce-multicloud-plugin`  
**Assessment date:** May 2026  
**HEAD commit:** `aa5e93d`  
**Author:** Salvatore Callari &lt;Callari@WaXCode.net&gt;  
**License:** MIT

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [Technology Stack](#2-technology-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Source Code Metrics](#4-source-code-metrics)
5. [Provider Coverage and Capabilities](#5-provider-coverage-and-capabilities)
6. [Validation and Contract Strategy](#6-validation-and-contract-strategy)
7. [Security Profile](#7-security-profile)
8. [Test Suite](#8-test-suite)
9. [Build and Release Pipeline](#9-build-and-release-pipeline)
10. [Infrastructure and Deployment](#10-infrastructure-and-deployment)
11. [Documentation Quality](#11-documentation-quality)
12. [Extensibility and Integration Surface](#12-extensibility-and-integration-surface)
13. [Open Risks and Known Limitations](#13-open-risks-and-known-limitations)
14. [Maturity Rating Summary](#14-maturity-rating-summary)
15. [Hiring Signal Summary (for recruiters)](#15-hiring-signal-summary-for-recruiters)

---

## 1. Project Summary

**TinyMCE MultiCloud Plugin** is a zero-dependency (runtime) browser plugin for the [TinyMCE](https://www.tiny.cloud/) rich text editor that lets end users browse, pick, and upload files from four enterprise cloud storage providers — **Google Drive**, **Microsoft OneDrive**, **Dropbox**, and **BayernCloud (Nextcloud/WebDAV)** — and insert them into the editor as links, inline images, embedded iframes, or native audio/video elements.

The plugin ships as a single self-contained IIFE bundle (`dist/index.global.js`, ~127 KB minified) with no peer runtime dependencies. TypeScript declarations (`dist/index.d.ts`) are co-bundled so integrators get full IntelliSense.

**Intended audience:** organisations running TinyMCE 6 or 7 that need users to insert cloud-hosted content without leaving the editor, and that may have private on-premises storage (Nextcloud/BayernCloud) alongside public cloud services.

---

## 2. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | 5.6 (`strict: true`) |
| Target runtime | ES2020 + DOM | — |
| Bundler | tsup (esbuild) | 8.5.1 |
| Output format | IIFE (`TinyMceMultiCloudPlugin`) | — |
| Test framework | Jest | 29.7 |
| Test environments | Node (unit), jsdom (provider) | — |
| Contract validation | XDBC (Design-by-Contract) | 1.0.217 |
| Schema validation | Zod | 3.25 |
| API documentation | TypeDoc | 0.28 |
| CORS proxy | Cloudflare Worker (plain JS) | — |
| CI/CD | GitHub Actions (Pages workflow) | — |
| Package manager | npm | 10+ |

**Runtime dependencies:** 2 (`xdbc`, `zod`). Both are used only for configuration validation and API boundary checking; neither is needed in the hot path.

**Peer dependency:** `tinymce >= 6` (optional — the plugin can be loaded before TinyMCE without failure).

---

## 3. Architecture Overview

### 3.1 Provider adapter pattern

Every cloud integration is expressed as a `CloudProvider` object implementing a two-method contract:

```ts
interface CloudProvider {
  id: CloudProviderId;
  label: string;
  pick(context: PickerContext): Promise<PickerResult | null>;
  upload?(context: PickerContext, file: File): Promise<PickerResult | null>;
}
```

The `pick` method is responsible for authenticating the user, opening a file picker (native SDK or popup bridge), and returning a normalised `PickerResult`. The optional `upload` method accepts a browser `File` and returns the same result shape after uploading. This symmetry means `insertResult` in `index.ts` handles both flows identically — there is no separate insertion code path per operation type.

### 3.2 Dual picker strategies

Each provider supports two mutually exclusive picker strategies:

1. **SDK mode** (no `pickerUrl` in config): uses the provider's own JavaScript SDK loaded lazily via `loadScript`. The SDK is initialised at first use; subsequent calls reuse the loaded instance. Google Drive uses GIS + gapi Picker API; OneDrive uses MSAL 2.x + a navigable file browser overlay; Dropbox uses the official Dropins chooser; BayernCloud uses direct WebDAV PROPFIND + OCS sharing.

2. **Popup bridge mode** (`pickerUrl` set): opens a host-controlled popup window and communicates results via `window.postMessage`. This allows any custom file picker to integrate with the plugin without touching plugin code. The popup protocol is documented and a reference implementation is included.

### 3.3 Insert mode resolution

Once a provider returns a `PickerResult`, the plugin determines how to insert the file using a layered resolution:

```
result.mode → plugin defaultInsertMode → detectInsertMode(item)
```

`detectInsertMode` inspects MIME type first, then file extension, then URL pattern. This produces one of four modes: `link`, `image`, `embed`, `audio`. The insertion code in `insertResult` handles each mode, including fallbacks (e.g. audio with no direct download URL falls back to an iframe embed of the provider's preview page).

### 3.4 Dialog system

The picker and upload dialogs are both implemented entirely through TinyMCE's built-in `windowManager.open` API. Provider selection uses an `htmlpanel` item containing a dynamically generated CSS grid of provider buttons. All HTML values injected into panels go through `escapeHtml` before string concatenation, preventing XSS.

Per-dialog random handler keys (`window['__mc_<random>']`) are generated on dialog open and deleted on close, replacing the previous fixed global names that were predictable from other page scripts.

### 3.5 Directory map

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
  CLOUDFLARE_WORKER_SETUP.md
scripts/
  prepare-pages.mjs
  prepare-pages-selfhost.mjs
demo/
  tinymce-demo.html     Live demo (self-hosts TinyMCE, no API key required)
  pickers/              Reference picker bridge pages for all four providers
```

---

## 4. Source Code Metrics

| Metric | Value |
|---|---|
| Source lines (TypeScript, `src/`) | 4,392 |
| Test lines (TypeScript, `tests/`) | 1,885 |
| Test-to-source ratio | ~0.43 |
| Test suites | 10 |
| Test cases | 224 (all passing) |
| Production bundle size (minified IIFE) | 140 KB |
| Source map size | 598 KB |
| TypeScript declaration file | 10.75 KB |
| Total commits (HEAD) | 231 |
| Runtime dependencies | 2 |
| `any` escapes in production code | < 10 (editor API + provider SDK boundaries; all localised) |

---

## 5. Provider Coverage and Capabilities

| Provider | Pick | Upload | Embed PDF | Embed Office Doc | Embed Image | Audio/Video | Notes |
|---|---|---|---|---|---|---|---|
| **Google Drive** | ✅ | ✅ | ✅ Drive viewer | ✅ Drive viewer | ✅ thumbnail | ✅ Drive viewer | GIS OAuth, Picker API, Drive v3 |
| **OneDrive** | ✅ | ✅ | ✅ OD embed viewer | ✅ Office Online | ✅ OD embed | ✅ OD embed | MSAL 2.x, Graph API, `createLink` |
| **Dropbox** | ✅ | ✅ | ✅ raw=1 on www.dropbox.com | ✅ Office Online | ✅ raw=1 | ✅ raw=1 | Chooser SDK + Upload API |
| **BayernCloud** | ✅ | ✅ | ✅ Google Docs Viewer | ✅ Google Docs Viewer | ✅ direct | ✅ direct | WebDAV + OCS sharing |

**Pick** = user selects an existing file from the cloud.  
**Upload** = user uploads a local file to the cloud then inserts it.  
`raw=1` = Dropbox raw content URL (must stay on `www.dropbox.com`; `dl.dropboxusercontent.com` returns 403 for `rlkey` links — fixed `db1a935`).

### Popup bridge

All four providers can alternatively be driven by a custom popup URL, giving integrators full control over the picker UI without modifying the plugin. The bridge protocol is stable and documented.

---

## 6. Validation and Contract Strategy

The plugin uses a two-layer validation architecture to catch configuration errors early and provider API shape violations at runtime.

### 6.1 Configuration layer — XDBC Design-by-Contract

All `tinymce.init()` option values are validated before any plugin logic runs. Validators are decorator-driven XDBC classes registered under `globalThis.MultiCloud.Validation.Config`. Each precondition expresses a typed contract with an actionable hint message (e.g. *"Did you set Google Drive clientId?"*). Violations throw `DBC.Infringement` rather than silent no-ops or cryptic SDK errors.

SDK-mode field validation (checking for `clientId`, `appKey`, etc.) is skipped when a provider has `pickerUrl` set or `enabled: false`, avoiding false positives for partially-configured deployments.

The DBC instance is configurable at runtime via `configureMultiCloudValidation`, allowing it to be switched to a soft-logging mode (warnings instead of throws) in integration tests.

### 6.2 Boundary layer — Zod schemas via XDBC

Every response from a provider API or picker callback is validated against a Zod schema before any of its fields are used. Schemas cover:

| Schema | Validates |
|---|---|
| `pickerResultSchema` | Final result shape (all `url` fields are valid URLs; known enum `mode` values) |
| `googleDocSchema` | Google Picker callback payload |
| `oneDriveFileSchema` | OneDrive Graph API drive item |
| `dropboxFileSchema` | Dropbox Chooser callback file object |
| `webDavNodeSchema` | BayernCloud WebDAV PROPFIND node |

Validation is routed through `XDBC.ZOD.tsCheck` so that both contract violations and schema failures produce the same `DBC.Infringement` type and use the same DBC instance (`globalThis.MultiCloud.Validation.Boundary`), independently configurable from the config layer.

### 6.3 HTML injection safety

Values injected into TinyMCE `htmlpanel` markup go through `escapeHtml` (escapes `&`, `<`, `>`, `"`, `'`). Provider IDs used in `data-provider` attributes and `onclick` strings are escaped. This prevents XSS if a provider ID or label contains HTML metacharacters.

---

## 7. Security Profile

### 7.1 Addressed findings

The following risks were identified in an internal security assessment and subsequently resolved:

| Ref | Severity | Finding | Resolution | Commit |
|---|---|---|---|---|
| ~~M1~~ | ~~Medium~~ | ~~OAuth tokens and diagnostic data visible in browser console in production~~ | Finding withdrawn: no credential values are passed to `console.*` anywhere in the codebase — only state-transition messages (e.g. "OAuth successful", "Using cached token"). Applying `drop: ["console"]` to a library bundle is incorrect practice: it silences operator-visible errors, breaks XDBC soft-log mode silently, and is the integrator's responsibility. Reverted. | — |
| M2 | Medium | Global dialog handler names (`__mcSelectProvider`) were fixed strings predictable from other scripts on the page | Handler keys randomised per dialog open (`__mc_<random>`) and deleted on close | `d058c43` |
| L1 | Low | `loadScript` could stall indefinitely if a pre-existing `<script>` element never fired `load`/`error` | 15-second timeout added to the existing-element wait path | `d058c43` |
| L3 | Low | `redirectUri` from `OneDriveProviderConfig` was silently ignored; MSAL always used `window.location.origin + pathname` | `redirectUri` threaded from config through all `getAccessToken` call sites | `d058c43` |
| H1 | High | Third-party SDK scripts (Google, Dropbox) loaded without Subresource Integrity | Documented as unresolvable without self-hosting (CDN performs content negotiation — hash cannot be pinned); mitigations listed in `PRODUCTION_SETUP.md` | — |

### 7.2 Retained controls

| Control | Where implemented |
|---|---|
| SRI enforcement for version-pinned SDK | MSAL 2.38.0 loaded with `sha384-…` integrity attribute via `loadScript` |
| `postMessage` origin validation | `popupProvider.ts` — `event.origin !== expectedOrigin` check before accepting any message |
| Zod API boundary validation | All provider API responses validated before field access |
| `escapeHtml` on all panel HTML | `index.ts` — prevents XSS from injected provider labels or IDs |
| No credentials in repository | `demo/multicloud.config.js` is gitignored; CI injects secrets at build time only |
| Token not stored in DOM | Dropbox OAuth token in `localStorage` (industry-standard for SPA implicit grant; no DOM exposure) |

### 7.3 Accepted / informational

| Ref | Classification | Rationale |
|---|---|---|
| I1 | Informational | Source maps published intentionally — OSS project, maps aid community debugging |
| I2 | Informational | Residual `any` types in OneDrive provider are bounded to SDK boundary points; not a contract surface |
| I3 | Informational | No retry on Graph API transient failures — out of scope for v0.1 |

### 7.4 Cloudflare Worker security posture

The CORS proxy (`cloudflare-worker/nextcloud-proxy.js`) enforces HTTPS-only targets and validates the `target` query parameter as a well-formed URL before forwarding. `origin` and `referer` headers are stripped from proxied requests. The Worker does not persist state, log credentials, or accept wildcard target domains.

---

## 8. Test Suite

### 8.1 Configuration

Two Jest projects run in the same invocation:

| Project | Environment | Covers |
|---|---|---|
| `unit` | Node | DBC contract validators, Zod boundary schemas |
| `providers` | jsdom | All four provider adapters, popup bridge, `loadScript`, `registerProvider`/`unregisterProvider` |

### 8.2 Current results

```
Test Suites: 10 passed, 10 total
Tests:       224 passed, 224 total
```

### 8.3 Coverage areas

| Area | What is tested |
|---|---|
| Config validators | Valid options, each invalid field individually, SDK-mode skip when `pickerUrl` set, soft logging mode |
| Boundary schemas | Valid and malformed payloads for all five schemas; URL field rejection on non-URLs |
| Google Drive | `launchPicker` happy path, boundary validation, error propagation |
| OneDrive | `openOneDrivePicker` happy path, boundary validation, Graph API failure |
| Dropbox | Chooser happy path, upload flow, `raw=1` URL construction, OAuth token caching |
| BayernCloud | WebDAV listing, file selection, public share creation, upload flow |
| `loadScript` | Fresh load, cached load (idempotent), SRI attribute stamping, timeout on stalled script |
| `popupProvider` | Message acceptance, origin rejection, timeout, cancellation |
| `registerProvider` / `unregisterProvider` | Registry CRUD, provider override semantics |

### 8.4 Tooling notes

- `jest.isolateModules` is used for provider tests to reset module-level singletons (e.g. MSAL instance, Dropbox token cache) between test cases.
- `(global as any).fetch = jest.fn()` is used instead of `jest.spyOn(globalThis, 'fetch')` because jsdom does not set `fetch` as an own property on `globalThis`, causing `spyOn` to fail after `restoreAllMocks`.
- `ts-jest` with `warnOnly: true` diagnostics is used to allow tests to run despite pre-existing TypeScript errors in `oneDrive.ts` (SDK boundary types).

---

## 9. Build and Release Pipeline

### 9.1 Build

```bash
npm run build   # tsup → dist/index.global.js + .map + .d.ts
npm run dev     # tsup --watch (console retained, no minification)
```

- esbuild target: ES2020
- Output format: IIFE, global name `TinyMceMultiCloudPlugin`
- Minification: enabled in production only
- Source maps: always emitted (`.map` adjacent to bundle)
- `console.*` calls: dropped by esbuild in production via `drop: ["console"]`; retained in watch/dev mode
- TypeScript declarations: emitted to `dist/index.d.ts`

### 9.2 CI/CD

GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) triggers on push to `master`/`main`:

1. Runs `npm run build` — produces `dist/`
2. Runs `npm run docs:api` — produces `docs/api/` (TypeDoc)

**Secrets required:**

| Secret | Provider |
|---|---|
| `GOOGLE_BROWSER_API_KEY` | Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console (bare ID only, without `.apps.googleusercontent.com`) |
| `ONEDRIVE_CLIENT_ID` | Microsoft Entra / Azure Portal |
| `DROPBOX_APP_KEY` | Dropbox App Console |

Credentials are injected into `demo/multicloud.config.js` at build time and are never committed to the repository.

### 9.3 TypeDoc API reference

`typedoc.json` points at `src/` and generates a full HTML API reference to `docs/api/` (gitignored). All public types, interfaces, and exported functions carry JSDoc including `@param`, `@returns`, `@throws`, and `@author` annotations. The `skipErrorChecking: true` flag is set to allow doc generation despite pre-existing TS errors in the OneDrive SDK boundary types.

---

## 10. Infrastructure and Deployment

### 10.1 Deployment options

| Mode | Description |
|---|---|
| CDN / self-hosted | Drop `dist/index.global.js` into any static hosting. No server-side component needed for Google Drive, OneDrive, and Dropbox. |
| npm package | `npm install tinymce-multicloud-plugin` — TypeScript consumers can import `registerProvider`, `unregisterProvider`, and all config types. |
| GitHub Pages demo | Automatic deployment via CI. Self-hosts TinyMCE — no Tiny Cloud API key required. |

### 10.2 BayernCloud CORS proxy requirement

BayernCloud/Nextcloud is the only provider that requires server-side infrastructure: a CORS proxy is needed for browser deployments because Nextcloud instances enforce same-origin policy on WebDAV and OCS endpoints.

A production-ready Cloudflare Worker (`cloudflare-worker/nextcloud-proxy.js`) is included and deployed via `wrangler.toml`. The Cloudflare free tier (100,000 requests/day) is sufficient for most editorial workloads. Self-hosted alternatives (nginx, Caddy reverse proxy) are also possible but not scripted.

### 10.3 Content Security Policy requirements

A full per-provider CSP directive reference is maintained in `docs/PRODUCTION_SETUP.md`. The four main directive families are:

| Directive | Notes |
|---|---|
| `script-src` | Google GIS/gapi, MSAL, Dropbox Dropins; no external scripts for BayernCloud |
| `frame-src` | Provider picker popups and document viewer iframes (Office Online, Google Docs Viewer) |
| `connect-src` | REST API endpoints (Google, Graph, Dropbox API, Nextcloud origin) |
| `img-src` | Provider thumbnail endpoints |

---

## 11. Documentation Quality

| Document | Contents |
|---|---|
| `README.md` | Architecture rationale, validation strategy (DBC + Zod), full `tinymce.init()` usage example, upload capability matrix, picker bridge contract, per-provider setup notes, GitHub Pages deployment guide |
| `docs/PRODUCTION_SETUP.md` | Per-provider cloud console checklists, OAuth registration steps, CSP directive tables, SRI risk section with mitigations |
| `docs/CLOUDFLARE_WORKER_SETUP.md` | Step-by-step Cloudflare Worker deployment for the Nextcloud CORS proxy |
| `CONTRIBUTING.md` | Prerequisites, setup, development workflow table, project layout, testing conventions, provider addition guide, code style conventions |
| TypeDoc API reference | All exported types, interfaces, and functions; full `@param`/`@returns`/`@throws` coverage; auto-deployed to GitHub Pages |
| In-source JSDoc | All functions and classes carry JSDoc regardless of whether they are exported |

---

## 12. Extensibility and Integration Surface

### 12.1 Public API

```ts
// Register a custom provider before tinymce.init()
registerProvider(provider: CloudProvider): void

// Remove a previously registered custom provider
unregisterProvider(id: string): void

// All configuration interfaces are exported as TypeScript types
import type { CloudProvider, PickerResult, CloudItem, ... } from 'tinymce-multicloud-plugin';
```

### 12.2 Custom provider interface

Integrators implement one interface:

```ts
interface CloudProvider {
  id: string;
  label: string;
  pick(context: PickerContext): Promise<PickerResult | null>;
  upload?(context: PickerContext, file: File): Promise<PickerResult | null>;
}
```

A provider with the same `id` as a built-in overrides the built-in. No rebuild is required; registration happens at runtime before `tinymce.init()`.

### 12.3 Popup bridge contract

Integrators who want to build a custom picker page without implementing a JavaScript SDK adapter can use the popup bridge. The page calls:

```js
window.opener.postMessage({
  source: "tinymce-multicloud-plugin",
  type: "picked",          // or "cancelled"
  providerId: "<id>",
  payload: { item: { id, name, url, embedUrl? }, mode? }
}, targetOrigin);
```

Reference implementations for all four built-in providers are included under `demo/pickers/`.

### 12.4 Validation configurability

Both DBC instances (`globalThis.MultiCloud.Validation.Config` and `.Boundary`) are exposed for runtime configuration via `configureMultiCloudValidation`, enabling soft-logging mode in test harnesses without mocking the validation internals.

---

## 13. Open Risks and Known Limitations

| Ref | Severity | Item | Impact |
|---|---|---|---|
| H1 | High | Google Drive (gapi/GIS) and Dropbox (Dropins) SDK scripts are not SRI-hashed | Supply-chain compromise of these CDN scripts could execute arbitrary code in the editor context. No resolution without self-hosting the SDKs. Documented in `PRODUCTION_SETUP.md`. |
| O1 | Medium | MSAL module-level singleton in `oneDrive.ts` | If `redirectUri` changes between plugin registrations on the same page, the singleton retains the first-call value. Affects edge-case multi-tenant SPA scenarios only. |
| O2 | Low | No retry on transient Graph API or Dropbox API failures | A single 500 from the API surfaces as a plugin error with no automatic recovery. Manual re-open is required. |
| O3 | Low | Dropbox OAuth token stored in `localStorage` | Standard for SPA implicit grant flows. The token is cleared on 401 and on detected expiry. Admins with strict storage policies may prefer alternative grant flows not yet implemented. |
| O4 | Low | Residual TypeScript `any` types in `oneDrive.ts` SDK boundary | SDK callback payloads cannot be fully typed from the SDK's own declarations. Bounded to the Graph API response surface; does not propagate into plugin logic after boundary validation. |
| O5 | Low | BayernCloud CORS proxy is a single Cloudflare Worker without authentication | The Worker accepts `target` URLs pointing at any HTTPS host. Operators with sensitive Nextcloud instances should restrict the Worker to a known-good target domain allowlist. |
| O6 | Informational | Source maps published alongside the bundle | Intentional for open-source; review if the plugin is used in a commercial closed-source context where implementation details are sensitive. |

---

## 14. Maturity Rating Summary

| Dimension | Rating | Notes |
|---|---|---|
| **Code quality** | ★★★★☆ | TypeScript strict mode throughout; bounded `any` use; consistent code style; all hot paths have JSDoc |
| **Test coverage** | ★★★★☆ | 224 tests across 10 suites; happy paths and validation edge cases; no integration tests against live APIs (expected for this type of library) |
| **Security** | ★★★★☆ | Randomised dialog handler keys, SRI on MSAL, origin-pinned postMessage, Zod boundary validation, `escapeHtml` on all injected HTML; documented residual risk on unversionable CDN scripts |
| **Documentation** | ★★★★★ | README, production guide, CONTRIBUTING, TypeDoc API reference, Cloudflare setup guide — all current and accurate |
| **Architecture** | ★★★★☆ | Clean provider adapter pattern; dual picker strategy (SDK + popup bridge); consistent insert-mode resolution; some SDK coupling in provider files |
| **Extensibility** | ★★★★★ | `registerProvider`/`unregisterProvider` API; popup bridge protocol; config type exports; provider override semantics |
| **Operations** | ★★★☆☆ | Automated CI/CD to GitHub Pages; CORS proxy for BayernCloud; no health monitoring, no versioned changelogs post-setup |
| **Overall maturity** | ★★★★☆ | Production-ready for deployment in TinyMCE 6/7 environments with appropriate CSP and OAuth app registration. Recommended for enterprise editorial platforms with multi-cloud storage requirements.