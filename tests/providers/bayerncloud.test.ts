/**
 * Unit tests for the BayernCloud/Nextcloud provider SDK path.
 *
 * Strategy: `fetch` is mocked to return a pre-built WebDAV PROPFIND XML response.
 * The TinyMCE `windowManager.open` is mocked to immediately call `onSubmit`,
 * simulating the user selecting the first file from the dialog.
 *
 * Each test uses `jest.isolateModules` to get a fresh provider module.
 */

// Mock loadScript (not used by BayernCloud, but imported by the providers/index barrel)
jest.mock('../../src/providers/utils', () => ({
    ...jest.requireActual('../../src/providers/utils'),
    loadScript: jest.fn().mockResolvedValue(undefined),
}));

import type { CloudProvider } from '../../src/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Minimal WebDAV PROPFIND response containing one file and one directory. */
const makePropfindXml = (baseUrl: string, username: string) => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/${username}/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${username}</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/${username}/Documents/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Documents</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/${username}/report.pdf</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>report.pdf</d:displayname>
        <d:getcontenttype>application/pdf</d:getcontenttype>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const BASE_URL = 'https://cloud.example.com';
const USERNAME = 'testuser';

const makeContext = (providerConfig: Record<string, unknown> = {}) => ({
    editor: {
        windowManager: {
            open: jest.fn().mockImplementation(({ onSubmit, initialData }: any) => {
                // Simulate user immediately clicking "Insert" with the first (default) selection
                const dialogApi = {
                    getData: () => initialData,
                    close: jest.fn(),
                };
                onSubmit(dialogApi);
                return { focus: jest.fn() };
            }),
        },
    } as any,
    options: {} as any,
    providerConfig: {
        baseUrl: BASE_URL,
        username: USERNAME,
        password: 'test-password',
        ...providerConfig,
    },
    pluginUrl: 'https://example.com/',
});

// ─── happy path ───────────────────────────────────────────────────────────────

describe('bayerncloudProvider — SDK pick', () => {
    let provider: CloudProvider;

    beforeEach(() => {
        jest.isolateModules(() => {
            const { builtInProviders } = require('../../src/providers');
            provider = builtInProviders().find((p: CloudProvider) => p.id === 'bayerncloud')!;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('happy path — selects a PDF file, returns PickerResult with embed mode', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => makePropfindXml(BASE_URL, USERNAME),
        });
        (global as any).fetch = fetchMock;

        const result = await provider.pick(makeContext() as any);

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('remote.php/dav/files'),
            expect.objectContaining({ method: 'PROPFIND' }),
        );
        expect(result).not.toBeNull();
        expect(result!.item.name).toBe('report.pdf');
        expect(result!.item.mimeType).toBe('application/pdf');
        expect(result!.mode).toBe('embed');
    });

    it('happy path — cancel (dialog onCancel) resolves null', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => makePropfindXml(BASE_URL, USERNAME),
        });

        const ctx = makeContext();
        // Override windowManager to call onCancel instead
        (ctx.editor.windowManager.open as jest.Mock).mockImplementation(({ onCancel }: any) => {
            onCancel();
            return { focus: jest.fn() };
        });

        const result = await provider.pick(ctx as any);
        expect(result).toBeNull();
    });

    it('PROPFIND failure — fetch returns non-OK status, pick throws', async () => {
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
        });

        await expect(provider.pick(makeContext() as any)).rejects.toThrow(/401/);
    });

    it('boundary validation failure — empty file listing resolves null', async () => {
        // PROPFIND response that contains only the root collection entry.
        // parseWebDavListing filters out the root href, leaving no child nodes.
        // selectBayernCloudNode receives an empty selectable list and resolves null.
        const emptyXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/${USERNAME}/</d:href>
    <d:propstat>
      <d:prop><d:displayname>${USERNAME}</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => emptyXml,
        });

        const result = await provider.pick(makeContext() as any);
        expect(result).toBeNull();
    });
});

// ─── boundary validation — direct schema tests ───────────────────────────────

describe('validateWebDavNodeBoundary — Zod schema', () => {
    it('accepts a valid WebDAV node', () => {
        const { validateWebDavNodeBoundary } = require('../../src/validation/boundary');
        const node = {
            id: '/remote.php/dav/files/user/doc.pdf',
            name: 'doc.pdf',
            url: 'https://cloud.example.com/remote.php/dav/files/user/doc.pdf',
            webdavPath: '/remote.php/dav/files/user/doc.pdf',
            mimeType: 'application/pdf',
            isDirectory: false,
        };
        expect(() => validateWebDavNodeBoundary(node)).not.toThrow();
    });

    it('throws when name is an empty string', () => {
        const { validateWebDavNodeBoundary } = require('../../src/validation/boundary');
        const bad = {
            id: '/remote.php/dav/files/user/doc.pdf',
            name: '',
            url: 'https://cloud.example.com/remote.php/dav/files/user/doc.pdf',
            webdavPath: '/remote.php/dav/files/user/doc.pdf',
            isDirectory: false,
        };
        expect(() => validateWebDavNodeBoundary(bad)).toThrow();
    });

    it('throws when url is not a valid URL', () => {
        const { validateWebDavNodeBoundary } = require('../../src/validation/boundary');
        const bad = {
            id: '/remote.php/dav/files/user/doc.pdf',
            name: 'doc.pdf',
            url: 'not-a-url',
            webdavPath: '/remote.php/dav/files/user/doc.pdf',
            isDirectory: false,
        };
        expect(() => validateWebDavNodeBoundary(bad)).toThrow();
    });
});
