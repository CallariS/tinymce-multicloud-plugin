# Contributing to TinyMCE MultiCloud Plugin

Thank you for considering a contribution. The sections below cover everything you need to get from zero to a passing PR.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 20 LTS or later |
| npm | 10 or later (ships with Node 20) |

---

## Setup

```bash
git clone https://github.com/CallariS/tinymce-multicloud-plugin.git
cd tinymce-multicloud-plugin
npm install
```

---

## Development workflow

| Goal | Command |
|------|---------|
| Start watch build | `npm run dev` |
| Single production build | `npm run build` |
| Type-check only | `npm run typecheck` |
| Run all tests | `npm test` |
| Run tests in watch mode | `npm run test:watch` |
| Generate API reference docs | `npm run docs:api` |
| Build GitHub Pages bundle | `npm run pages:build` |

---

## Project layout

```
src/
  index.ts              Plugin entry point and public API
  types.ts              Shared TypeScript types / interfaces
  providers/
    index.ts            Provider registry helpers
    popupProvider.ts    Popup-bridge base provider
    bayerncloud.ts      BayernCloud / Nextcloud WebDAV provider
    dropbox.ts          Dropbox Chooser provider
    googleDrive.ts      Google Drive Picker provider
    oneDrive.ts         OneDrive / MSAL provider
    utils.ts            Shared utilities (loadScript, …)
  validation/
    boundary.ts         Zod boundary schemas for provider API data
    config/
      validators.ts     DBC contract validators for plugin options
tests/
  providers/            Happy-path + boundary tests for each provider
  validation/           Unit tests for Zod schemas and DBC validators
docs/
  PRODUCTION_SETUP.md   Integration guide for end-users
  CLOUDFLARE_WORKER_SETUP.md
  api/                  Generated TypeDoc output (gitignored)
```

---

## Testing

Tests are run with Jest 29 in two separate projects:

- **`unit`** (Node environment) — validation contract and schema tests in `tests/validation/`
- **`providers`** (jsdom environment) — provider SDK and happy-path tests in `tests/providers/`

Run the full suite before opening a PR:

```bash
npm test
```

To run a single suite:

```bash
npx jest --testPathPattern providers
npx jest --testPathPattern validation
```

### Writing provider tests

Provider tests mock external SDKs via `jest.mock('../../src/providers/utils', ...)` and use `jest.isolateModules` for fresh module state per test.

> **Important:** Do **not** use `jest.spyOn(globalThis, 'fetch')` in provider tests — jest-environment-jsdom may not expose `fetch` as an own property after `jest.restoreAllMocks()`. Instead assign directly:
>
> ```typescript
> (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
> ```

---

## Adding a new provider

1. Create `src/providers/myProvider.ts` implementing the `CloudProvider` interface from `src/types.ts`.
2. Register the provider in `src/providers/index.ts`.
3. Add a Zod boundary schema in `src/validation/boundary.ts` and call it after receiving data from the SDK.
4. Add a test file at `tests/providers/myProvider.test.ts` covering:
   - Happy-path pick (file selected → correct `PickerResult`)
   - Cancel (user dismisses picker → `null` returned)
   - Boundary validation failure
   - Direct schema unit tests for your Zod schema
5. Update `docs/PRODUCTION_SETUP.md` and `README.md` with any new credential requirements.

---

## Code conventions

- **TypeScript strict mode** — all new code must compile without errors (`npm run typecheck`).
- **No `any` on public surfaces** — use `unknown` + type guards, or narrower types.
- **Validation at boundaries** — all data from external APIs must pass through a Zod schema via `ZOD.tsCheck` before use. Never trust provider SDK output directly.
- **Design-by-Contract for config** — any new plugin option must have a corresponding DBC contract in `src/validation/config/validators.ts`.
- **No silent swallowing of errors** — do not catch and ignore errors unless the provider contract explicitly calls for graceful degradation (document why if so).
- **One export per provider file** — keep provider files self-contained; shared logic goes in `src/providers/utils.ts`.

---

## Opening a pull request

1. Fork the repository and create a feature branch from `main`.
2. Make your changes; ensure `npm test` and `npm run typecheck` both pass.
3. Update documentation (README, `PRODUCTION_SETUP.md`) if user-facing behaviour changes.
4. Open a PR against `main` with a clear description of the problem and how the change addresses it.

---

## Licence

By contributing you agree that your contribution will be licensed under the [MIT Licence](LICENSE).
