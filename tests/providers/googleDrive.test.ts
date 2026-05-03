/**
 * Unit tests for the Google Drive provider SDK path.
 *
 * Strategy:
 * - `loadScript` is mocked so the gapi/GIS scripts are never fetched.
 * - `window.gapi` and `window.google` are installed with minimal fakes that mirror
 *   the exact API surface the provider calls.
 * - The PickerBuilder fake saves the callback passed to `setCallback`, then calls it
 *   synchronously with a PICKED event when `picker.setVisible(true)` is invoked.
 * - `fetch` is mocked to return synthetic Drive v3 file metadata.
 *
 * Each test uses `jest.isolateModules` to get a fresh provider module with reset
 * `gapiClientReady` and `tokenClient` state.
 */

jest.mock('../../src/providers/utils', () => ({
    ...jest.requireActual('../../src/providers/utils'),
    loadScript: jest.fn().mockResolvedValue(undefined),
}));

import type { CloudProvider } from '../../src/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const FAKE_TOKEN = 'ya29.test-google-token';

/** Installs a minimal `window.gapi` + `window.google` that mimics the APIs used by the provider. */
const installGoogleMocks = (pickedDoc: Record<string, unknown>) => {
    const tokenClientMock = {
        callback: null as any,
        requestAccessToken: jest.fn().mockImplementation(() => {
            tokenClientMock.callback({ access_token: FAKE_TOKEN });
        }),
    };

    (window as any).gapi = {
        load: (_name: string, cb: () => void) => { cb(); },
        client: {
            init: jest.fn().mockResolvedValue(undefined),
            getToken: jest.fn().mockReturnValue({ access_token: FAKE_TOKEN }),
            drive: {
                files: {
                    get: jest.fn().mockResolvedValue({
                        result: {
                            id: pickedDoc['id'],
                            name: pickedDoc['name'],
                            mimeType: pickedDoc['mimeType'],
                            webContentLink: `https://drive.google.com/uc?id=${pickedDoc['id']}`,
                            thumbnailLink: `https://lh3.googleusercontent.com/thumb/${pickedDoc['id']}`,
                        },
                    }),
                },
            },
        },
    };

    (window as any).google = {
        accounts: {
            oauth2: {
                initTokenClient: jest.fn().mockReturnValue(tokenClientMock),
            },
        },
        picker: {
            DocsView: jest.fn().mockImplementation(() => ({
                setIncludeFolders: jest.fn().mockReturnThis(),
                setSelectFolderEnabled: jest.fn().mockReturnThis(),
                setMimeTypes: jest.fn().mockReturnThis(),
            })),
            ViewId: { DOCS: 'DOCS' },
            Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES', MULTISELECT_ENABLED: 'MULTISELECT_ENABLED' },
            Action: { CANCEL: 'cancel', PICKED: 'picked' },
            PickerBuilder: jest.fn().mockImplementation(() => {
                let savedCallback: ((data: any) => void) | null = null;
                const builder: any = {
                    setOAuthToken: jest.fn().mockReturnThis(),
                    setDeveloperKey: jest.fn().mockReturnThis(),
                    setLocale: jest.fn().mockReturnThis(),
                    setTitle: jest.fn().mockReturnThis(),
                    enableFeature: jest.fn().mockReturnThis(),
                    addView: jest.fn().mockReturnThis(),
                    setCallback: jest.fn().mockImplementation((cb: (data: any) => void) => {
                        savedCallback = cb;
                        return builder;
                    }),
                    build: jest.fn().mockImplementation(() => ({
                        setVisible: (visible: boolean) => {
                            if (visible && savedCallback) {
                                savedCallback({ action: 'picked', docs: [pickedDoc] });
                            }
                        },
                    })),
                };
                return builder;
            }),
        },
    };
};

const makeContext = (providerConfig: Record<string, unknown> = {}) => ({
    editor: {} as any,
    options: {} as any,
    providerConfig: {
        clientId: 'test-client-id',
        apiKey: 'test-api-key',
        ...providerConfig,
    },
    pluginUrl: 'https://example.com/',
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('googleDriveProvider — SDK pick', () => {
    let provider: CloudProvider;

    beforeEach(() => {
        jest.isolateModules(() => {
            const { builtInProviders } = require('../../src/providers');
            provider = builtInProviders().find((p: CloudProvider) => p.id === 'googleDrive')!;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete (window as any).gapi;
        delete (window as any).google;
    });

    it('happy path — raster image: thumbnail URL used, mode is "image"', async () => {
        const pickedDoc = {
            id: 'file-abc',
            name: 'photo.png',
            mimeType: 'image/png',
            url: 'https://drive.google.com/file/d/file-abc/view',
        };
        installGoogleMocks(pickedDoc);

        const result = await provider.pick(makeContext() as any);

        expect(result).not.toBeNull();
        expect(result!.item.id).toBe('file-abc');
        // Raster images use the thumbnail endpoint
        expect(result!.item.url).toContain('thumbnail?id=file-abc');
        expect(result!.mode).toBe('image');
    });

    it('happy path — Google Doc: embed URL uses docs.google.com/document/preview', async () => {
        const pickedDoc = {
            id: 'doc-xyz',
            name: 'Meeting Notes.gdoc',
            mimeType: 'application/vnd.google-apps.document',
            url: 'https://docs.google.com/document/d/doc-xyz/view',
        };
        installGoogleMocks(pickedDoc);

        const result = await provider.pick(makeContext() as any);

        expect(result).not.toBeNull();
        expect(result!.item.embedUrl).toBe('https://docs.google.com/document/d/doc-xyz/preview');
        expect(result!.mode).toBe('embed');
    });

    it('happy path — SVG: embed mode, embedUrl used as main url', async () => {
        const pickedDoc = {
            id: 'svg-id',
            name: 'diagram.svg',
            mimeType: 'image/svg+xml',
            url: 'https://drive.google.com/file/d/svg-id/view',
        };
        installGoogleMocks(pickedDoc);

        const result = await provider.pick(makeContext() as any);

        expect(result).not.toBeNull();
        expect(result!.mode).toBe('embed');
        // SVG uses the drive viewer embed URL as the main url
        expect(result!.item.url).toContain('drive.google.com/file/d/svg-id');
    });

    it('happy path — picker cancelled: resolves null', async () => {
        (window as any).gapi = {
            load: (_name: string, cb: () => void) => { cb(); },
            client: {
                init: jest.fn().mockResolvedValue(undefined),
                getToken: jest.fn().mockReturnValue({ access_token: FAKE_TOKEN }),
                drive: { files: { get: jest.fn().mockResolvedValue({ result: {} }) } },
            },
        };

        const tokenClientMock = {
            callback: null as any,
            requestAccessToken: jest.fn().mockImplementation(() => {
                tokenClientMock.callback({ access_token: FAKE_TOKEN });
            }),
        };

        (window as any).google = {
            accounts: { oauth2: { initTokenClient: jest.fn().mockReturnValue(tokenClientMock) } },
            picker: {
                DocsView: jest.fn().mockImplementation(() => ({
                    setIncludeFolders: jest.fn().mockReturnThis(),
                    setSelectFolderEnabled: jest.fn().mockReturnThis(),
                })),
                ViewId: { DOCS: 'DOCS' },
                Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES', MULTISELECT_ENABLED: 'MULTISELECT_ENABLED' },
                Action: { CANCEL: 'cancel', PICKED: 'picked' },
                PickerBuilder: jest.fn().mockImplementation(() => {
                    let savedCallback: ((data: any) => void) | null = null;
                    const builder: any = {
                        setOAuthToken: jest.fn().mockReturnThis(),
                        setDeveloperKey: jest.fn().mockReturnThis(),
                        setLocale: jest.fn().mockReturnThis(),
                        setTitle: jest.fn().mockReturnThis(),
                        enableFeature: jest.fn().mockReturnThis(),
                        addView: jest.fn().mockReturnThis(),
                        setCallback: jest.fn().mockImplementation((cb: any) => { savedCallback = cb; return builder; }),
                        build: jest.fn().mockImplementation(() => ({
                            setVisible: (visible: boolean) => {
                                if (visible && savedCallback) {
                                    savedCallback({ action: 'cancel' });
                                }
                            },
                        })),
                    };
                    return builder;
                }),
            },
        };

        const result = await provider.pick(makeContext() as any);
        expect(result).toBeNull();
    });

    it('boundary validation failure — doc without id: picker catches error and resolves null', async () => {
        // The launchPicker callback wraps everything in try/catch and calls
        // resolve(null) on any error. Boundary failures therefore manifest as a
        // null result, not a rejection. Direct schema tests cover the throwing path.
        const pickedDoc = {
            // id intentionally omitted — fails googleDocSchema (id: z.string().min(1))
            name: 'Nameless Doc',
            mimeType: 'application/vnd.google-apps.document',
            url: 'https://docs.google.com/document/d/undefined/view',
        };
        installGoogleMocks(pickedDoc);

        const result = await provider.pick(makeContext() as any);
        expect(result).toBeNull();
    });
});

// ─── boundary validation — direct schema tests ────────────────────────────────

describe('validateGoogleDocBoundary — Zod schema', () => {
    it('accepts a valid Google Drive doc object', () => {
        const { validateGoogleDocBoundary } = require('../../src/validation/boundary');
        const doc = { id: 'file-abc', name: 'photo.png', mimeType: 'image/png', url: 'https://drive.google.com/file/d/file-abc/view' };
        expect(() => validateGoogleDocBoundary(doc)).not.toThrow();
    });

    it('throws when id is an empty string', () => {
        const { validateGoogleDocBoundary } = require('../../src/validation/boundary');
        expect(() => validateGoogleDocBoundary({ id: '', name: 'file.pdf' })).toThrow();
    });

    it('throws when id is missing entirely', () => {
        const { validateGoogleDocBoundary } = require('../../src/validation/boundary');
        expect(() => validateGoogleDocBoundary({ name: 'file.pdf' })).toThrow();
    });

    it('throws when url is present but not a valid URL', () => {
        const { validateGoogleDocBoundary } = require('../../src/validation/boundary');
        expect(() => validateGoogleDocBoundary({ id: 'x', url: 'not-a-url' })).toThrow();
    });
});
