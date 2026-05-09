# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- `uploadPublicSharingWarning` plugin option: shows an amber warning panel in the upload dialog informing users that the uploaded file will be publicly accessible. Accepts a custom string passed through `editor.translate()` for i18n; falls back to a built-in default message.
- German and Italian translations for the default upload public-sharing warning message.
- Manual light/dark theme toggle in the demo page; preference persisted in `localStorage` and takes precedence over the OS media query.
- GitHub Pages now publishes the TypeDoc API reference at `https://callaris.github.io/tinymce-multicloud-plugin/` — no provider secrets required in CI.
- `scripts/prepare-docs-pages.mjs` and `npm run docs:pages` script for assembling an API-docs-only GitHub Pages bundle.
- `ALLOWED_TARGET_HOSTS` environment variable support in the Cloudflare Worker: when set to a comma-separated list of hostnames, only those hosts may be proxied. Recommended for production deployments.
- `/health` endpoint on the Cloudflare Worker (returns `{"status":"ok","ts":<epoch>}`) for uptime monitoring.
- `.github/workflows/worker-health.yml`: daily CI workflow that pings the Worker `/health` endpoint and fails loudly if it is unreachable. Requires `CLOUDFLARE_WORKER_URL` repository variable to be set; skips silently otherwise.
- `.nvmrc` specifying Node 20 for consistent local development environments.
- README: market gap section with alternatives comparison table (Filestack, Uploadcare) covering cost, file storage model, embed support, and self-hosting.

### Changed
- GitHub Pages workflow (`deploy-pages.yml`) no longer requires provider credential secrets — it only builds and publishes the TypeDoc API reference.
- Cloudflare Worker landing page link for "Production setup guide" now points to the GitHub-rendered Markdown view instead of the raw `.md` file.
- Landing page card on `waxcode.net` demo site is now horizontally centered.

---

## [0.1.0] — 2025-06

### Added
- Initial plugin implementation supporting Google Drive, OneDrive, Dropbox, and BayernCloud/Nextcloud providers.
- Provider adapter contract (`CloudProvider` interface) with `pick()` and optional `upload()` methods.
- Popup bridge protocol (`PickerMessage` postMessage contract) for picker pages running in separate popup windows.
- Design-by-Contract validation via [XDBC](https://github.com/CallariS/XDBC) with two independent named DBC instances:
  - `globalThis.MultiCloud.Validation.Config` — configuration contract checks.
  - `globalThis.MultiCloud.Validation.Boundary` — [Zod](https://zod.dev) boundary schema checks on provider API responses.
- `configureMultiCloudValidation({ config?, boundary? })` exported for independent control of each DBC instance's throw/log behaviour.
- Insert modes: `link`, `image`, `embed` — auto-detected per MIME type / file extension via `detectInsertMode`.
- Upload support for Google Drive, OneDrive, and Dropbox (file upload + shared-link creation).
- Cloudflare Worker CORS proxy for BayernCloud/Nextcloud WebDAV requests.
- Demo pages and picker bridge examples under [`demo/`](demo/).
- English, German (`de`), and Italian (`it`) TinyMCE UI translation strings under [`langs/`](langs/).
- Production setup guide at [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md).
- Full Jest test suite covering DBC config/boundary layer independence (175 tests).

### Changed
- Split single DBC instance into two independent paths (`Config` / `Boundary`) to allow separate throw/log configuration per layer (commit `1af9dcf`).
- All `ZOD.tsCheck` calls in `boundary.ts` pass `BOUNDARY_DBC_PATH` so the boundary DBC instance is used consistently (commit `1af9dcf`).

### Fixed
- README: OneDrive and Dropbox upload entries now correctly show ✅ Full upload support (commit `ec36c11`).
- README: All prose mentions of Zod and XDBC are now hyperlinked to their canonical URLs (commit `bba1518`).
