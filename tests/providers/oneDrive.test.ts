/**
 * Unit tests for the OneDrive provider SDK path.
 *
 * Strategy:
 * - `loadScript` is mocked to resolve immediately.
 * - `window.msal.PublicClientApplication` is replaced with a fake that returns a
 *   pre-configured access token without any network traffic.
 * - `fetch` is mocked to return a Graph API `/root/children` response containing
 *   one file and no folders.
 * - After `pick()` starts, we flush the microtask queue with `flushMicrotasks()`
 *   and then click the first `<li>` the picker rendered into `document.body`.
 *
 * Each test uses `jest.isolateModules` to get a fresh provider module with reset
 * `msalInstance` state.
 */

jest.mock('../../src/providers/utils', () => ({
    ...jest.requireActual('../../src/providers/utils'),
    loadScript: jest.fn().mockResolvedValue(undefined),
}));

import type { CloudProvider } from '../../src/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'eyJtest-msal-token';

/** Flush all pending microtasks (resolved Promises) so async code runs before assertions. */
const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Build a minimal Graph API `/root/children` response with a single file. */
const makeGraphResponse = (item: Record<string, unknown>) => ({
    value: [item],
});

/** Install a fake `window.msal.PublicClientApplication` that always resolves tokens. */
const installMsalMock = () => {
    (window as any).msal = {
        PublicClientApplication: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getAllAccounts: jest.fn().mockReturnValue([{ username: 'test@example.com' }]),
            acquireTokenSilent: jest.fn().mockResolvedValue({ accessToken: FAKE_TOKEN }),
            acquireTokenPopup: jest.fn().mockResolvedValue({ accessToken: FAKE_TOKEN }),
        })),
    };
};

const makeContext = (providerConfig: Record<string, unknown> = {}) => ({
    editor: {} as any,
    options: {} as any,
    providerConfig: { clientId: 'test-client-id', ...providerConfig },
    pluginUrl: 'https://example.com/',
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('oneDriveProvider — SDK pick', () => {
    let provider: CloudProvider;

    beforeEach(() => {
        jest.isolateModules(() => {
            const { builtInProviders } = require('../../src/providers');
            provider = builtInProviders().find((p: CloudProvider) => p.id === 'oneDrive')!;
        });
        installMsalMock();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete (window as any).msal;
        // Remove any overlay the picker appended
        document.querySelectorAll('div[style*="fixed"]').forEach(el => el.remove());
    });

    it('happy path — user clicks a PDF file, returns PickerResult', async () => {
        const fileItem = {
            id: 'od-file-1',
            name: 'Annual Report.pdf',
            webUrl: 'https://onedrive.live.com/view/?id=od-file-1',
            file: { mimeType: 'application/pdf' },
        };

        // Mock fetch for:
        //   1. listFolderItems (root/children)
        //   2. getThumbnailUrl (thumbnails endpoint) — returns 404 to keep test simple
        //   3. getPublicEmbedUrl (createLink) — returns a simple link
        (global as any).fetch = jest.fn().mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/root/children')) {
                return Promise.resolve({ ok: true, json: async () => makeGraphResponse(fileItem) });
            }
            if (urlStr.includes('/thumbnails')) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            if (urlStr.includes('/createLink')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ link: { webUrl: 'https://1drv.ms/b/s!abc', webHtml: '<iframe src="https://view.officeapps.live.com/op/embed.aspx?src=abc" />' } }),
                });
            }
            return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
        });

        const pickPromise = provider.pick(makeContext() as any);

        // Let the MSAL init + token acquisition + Graph API fetch settle
        await flushMicrotasks();

        // The picker overlay is now in the DOM — find the file <li> and click it
        const listItems = document.querySelectorAll('li');
        expect(listItems.length).toBeGreaterThan(0);
        // The first (only) li is the file item
        listItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const result = await pickPromise;

        expect(result).not.toBeNull();
        expect(result!.item.name).toBe('Annual Report.pdf');
    });

    it('happy path — user clicks Cancel button, resolves null', async () => {
        const fileItem = {
            id: 'od-file-2',
            name: 'Notes.docx',
            webUrl: 'https://onedrive.live.com/view/?id=od-file-2',
            file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        };

        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => makeGraphResponse(fileItem),
        });

        const pickPromise = provider.pick(makeContext() as any);

        await flushMicrotasks();

        // Find and click the Cancel button
        const buttons = document.querySelectorAll('button');
        const cancelBtn = Array.from(buttons).find(b => b.textContent === 'Cancel');
        expect(cancelBtn).toBeDefined();
        cancelBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const result = await pickPromise;
        expect(result).toBeNull();
    });

    it('boundary validation failure — Graph item with missing name throws', async () => {
        const badItem = {
            id: 'od-bad',
            // name intentionally omitted — required by oneDriveFileSchema
            webUrl: 'https://onedrive.live.com/view/?id=od-bad',
            file: { mimeType: 'application/pdf' },
        };

        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => makeGraphResponse(badItem),
        });

        const pickPromise = provider.pick(makeContext() as any);

        await flushMicrotasks();

        // Click the first li to trigger validation
        const listItems = document.querySelectorAll('li');
        if (listItems.length > 0) {
            listItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }

        await expect(pickPromise).rejects.toThrow();
    });
});

// ─── boundary validation — direct schema tests ────────────────────────────────

describe('validateOneDriveFileBoundary — Zod schema', () => {
    it('accepts a valid OneDrive file item', () => {
        const { validateOneDriveFileBoundary } = require('../../src/validation/boundary');
        const item = {
            id: 'od-file-1',
            name: 'document.pdf',
            webUrl: 'https://onedrive.live.com/view/?id=od-file-1',
            file: { mimeType: 'application/pdf' },
        };
        expect(() => validateOneDriveFileBoundary(item)).not.toThrow();
    });

    it('throws when name is missing', () => {
        const { validateOneDriveFileBoundary } = require('../../src/validation/boundary');
        const bad = { id: 'od-x', webUrl: 'https://onedrive.live.com/view/?id=od-x' };
        expect(() => validateOneDriveFileBoundary(bad)).toThrow();
    });

    it('throws when webUrl is not a valid URL', () => {
        const { validateOneDriveFileBoundary } = require('../../src/validation/boundary');
        const bad = { id: 'od-x', name: 'file.pdf', webUrl: 'not-a-url' };
        expect(() => validateOneDriveFileBoundary(bad)).toThrow();
    });
});
