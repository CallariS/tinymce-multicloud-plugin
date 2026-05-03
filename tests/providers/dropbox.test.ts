/**
 * Unit tests for the Dropbox provider SDK path.
 *
 * Strategy: `loadScript` is mocked to resolve immediately so jsdom never tries to
 * actually load the Dropbox Chooser script. `window.Dropbox.choose` is installed by
 * the mock itself, so the provider can use it without network access.
 *
 * Each test uses `jest.isolateModules` to get a fresh copy of the provider module
 * (and therefore fresh module-level state for `cachedAccessToken` etc.).
 */

// Mock loadScript before any provider module is imported.
jest.mock('../../src/providers/utils', () => ({
    ...jest.requireActual('../../src/providers/utils'),
    loadScript: jest.fn().mockResolvedValue(undefined),
}));

import type { CloudProvider } from '../../src/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeContext = (providerConfig: Record<string, unknown> = {}) => ({
    editor: {} as any,
    options: {} as any,
    providerConfig: { appKey: 'test-app-key', ...providerConfig },
    pluginUrl: 'https://example.com/',
});

// ─── happy path ───────────────────────────────────────────────────────────────

describe('dropboxProvider — SDK pick', () => {
    let provider: CloudProvider;

    beforeEach(() => {
        jest.isolateModules(() => {
            const { builtInProviders } = require('../../src/providers');
            provider = builtInProviders().find((p: CloudProvider) => p.id === 'dropbox')!;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete (window as any).Dropbox;
    });

    it('happy path — image file: raw=1 appended, mode is "image"', async () => {
        (window as any).Dropbox = {
            choose: ({ success }: any) => {
                success([{
                    id: 'dbid:abc123',
                    name: 'photo.jpg',
                    link: 'https://www.dropbox.com/scl/fi/abc123/photo.jpg?rlkey=xyz',
                }]);
            },
        };

        const result = await provider.pick(makeContext() as any);

        expect(result).not.toBeNull();
        expect(result!.item.url).toContain('raw=1');
        expect(result!.item.name).toBe('photo.jpg');
        expect(result!.mode).toBe('image');
    });

    it('happy path — PDF file: raw=1 appended, embedUrl set, mode is "embed"', async () => {
        (window as any).Dropbox = {
            choose: ({ success }: any) => {
                success([{
                    id: 'dbid:def456',
                    name: 'report.pdf',
                    link: 'https://www.dropbox.com/scl/fi/def456/report.pdf?rlkey=abc',
                }]);
            },
        };

        const result = await provider.pick(makeContext() as any);

        expect(result).not.toBeNull();
        expect(result!.item.url).toContain('raw=1');
        expect(result!.item.embedUrl).toBe(result!.item.url);
        expect(result!.mode).toBe('embed');
    });

    it('happy path — archive file: mode is "link" (no embed)', async () => {
        (window as any).Dropbox = {
            choose: ({ success }: any) => {
                success([{
                    id: 'dbid:ghi789',
                    name: 'backup.zip',
                    link: 'https://www.dropbox.com/scl/fi/ghi789/backup.zip?rlkey=def',
                }]);
            },
        };

        const result = await provider.pick(makeContext() as any);

        expect(result).not.toBeNull();
        expect(result!.mode).toBe('link');
        expect(result!.item.embedUrl).toBeUndefined();
    });

    it('happy path — cancel: resolves null', async () => {
        (window as any).Dropbox = {
            choose: ({ cancel }: any) => cancel(),
        };

        const result = await provider.pick(makeContext() as any);
        expect(result).toBeNull();
    });

    it('boundary validation failure — link present but invalid URL triggers Zod error', async () => {
        (window as any).Dropbox = {
            choose: ({ success }: any) => {
                // 'link' must be a valid URL per dropboxFileSchema — passing a non-URL
                // string passes the !first?.link check but fails ZOD.tsCheck
                success([{ id: 'dbid:bad', name: 'nodlink.pdf', link: 'not-a-url' }]);
            },
        };

        await expect(provider.pick(makeContext() as any)).rejects.toThrow();
    });
});
