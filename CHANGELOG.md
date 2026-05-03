# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- `registerProvider(provider)` and `unregisterProvider(id)` exported from the plugin bundle, allowing integrators to add custom cloud providers without forking the plugin ([`src/index.ts`](src/index.ts)).
- Origin pinning in `awaitPickerMessage`: the `postMessage` listener now validates `event.origin` against the known picker popup origin, preventing cross-origin message injection ([`src/providers/popupProvider.ts`](src/providers/popupProvider.ts)).
- Full CSP directive reference for all four built-in providers in [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md) (sections for `script-src`, `frame-src`, `connect-src`, `img-src`, and a minimal example header).
- TinyMCE 7 validated and adopted as the default dev/demo version; `devDependencies` updated to `tinymce@^7`. `peerDependencies` range remains `>=6`.

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
