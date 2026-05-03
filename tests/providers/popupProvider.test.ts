/**
 * Tests for createPopupProvider and the awaitPickerMessage origin-pinning logic.
 *
 * These run in jsdom so `window`, `document`, and `window.open` are available.
 */
import { createPopupProvider } from '../../src/providers/popupProvider';
import type { PickerMessage } from '../../src/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const PICKER_ORIGIN = 'https://picker.example.com';
const PICKER_URL    = `${PICKER_ORIGIN}/picker.html`;
const PLUGIN_URL    = 'https://host.example.com/plugin/';
const PROVIDER_ID   = 'test-provider';

/** Minimal context passed to provider.pick() */
const makeContext = (pickerUrl?: string) => ({
    options: {} as any,
    providerConfig: pickerUrl ? { pickerUrl } : {},
    pluginUrl: PLUGIN_URL,
});

/** Dispatch a MessageEvent on window as if it came from the popup. */
const dispatchMessage = (data: PickerMessage, origin = PICKER_ORIGIN) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
};

// ─── awaitPickerMessage — origin filtering ────────────────────────────────────

describe('createPopupProvider — origin pinning', () => {
    let provider: ReturnType<typeof createPopupProvider>;
    let openSpy: jest.SpyInstance;

    beforeEach(() => {
        // Suppress "popup blocked" error by returning a fake window object
        openSpy = jest.spyOn(window, 'open').mockReturnValue({} as Window);
        provider = createPopupProvider(PROVIDER_ID, 'Test Provider', '/pickers/test.html');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('resolves with the picker result when origin matches', async () => {
        const ctx = makeContext(PICKER_URL);
        const pickPromise = provider.pick(ctx as any);

        const payload = {
            item: { id: 'f1', name: 'file.png', url: 'https://picker.example.com/file.png' },
            mode: 'image' as const,
        };

        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'picked',
            payload,
        }, PICKER_ORIGIN);

        await expect(pickPromise).resolves.toEqual(payload);
    });

    it('resolves null when the picker sends a cancelled message', async () => {
        const ctx = makeContext(PICKER_URL);
        const pickPromise = provider.pick(ctx as any);

        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'cancelled',
        }, PICKER_ORIGIN);

        await expect(pickPromise).resolves.toBeNull();
    });

    it('ignores messages from an unexpected origin (cross-origin injection)', async () => {
        const ctx = makeContext(PICKER_URL);
        const pickPromise = provider.pick(ctx as any);

        // Attacker on a different origin forges the source discriminator
        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'picked',
            payload: {
                item: { id: 'evil', name: 'evil.js', url: 'https://attacker.example.com/evil.js' },
                mode: 'link' as const,
            },
        }, 'https://attacker.example.com');

        // Then the real picker sends the legitimate message
        const legitimatePayload = {
            item: { id: 'f1', name: 'file.png', url: 'https://picker.example.com/file.png' },
            mode: 'image' as const,
        };
        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'picked',
            payload: legitimatePayload,
        }, PICKER_ORIGIN);

        await expect(pickPromise).resolves.toEqual(legitimatePayload);
    });

    it('ignores messages from a different provider ID', async () => {
        const ctx = makeContext(PICKER_URL);
        const pickPromise = provider.pick(ctx as any);

        // Message from correct origin but wrong provider
        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: 'other-provider',
            type: 'picked',
            payload: {
                item: { id: 'x', name: 'x.png', url: 'https://picker.example.com/x.png' },
                mode: 'image' as const,
            },
        }, PICKER_ORIGIN);

        // Correct message follows
        const legitimatePayload = {
            item: { id: 'f1', name: 'file.png', url: 'https://picker.example.com/file.png' },
            mode: 'image' as const,
        };
        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'picked',
            payload: legitimatePayload,
        }, PICKER_ORIGIN);

        await expect(pickPromise).resolves.toEqual(legitimatePayload);
    });

    it('ignores messages without the tinymce-multicloud-plugin source discriminator', async () => {
        const ctx = makeContext(PICKER_URL);
        const pickPromise = provider.pick(ctx as any);

        // Unrelated postMessage from the same origin (e.g. another script)
        window.dispatchEvent(new MessageEvent('message', {
            data: { foo: 'bar' },
            origin: PICKER_ORIGIN,
        }));

        // Legitimate message
        const legitimatePayload = {
            item: { id: 'f1', name: 'file.png', url: 'https://picker.example.com/file.png' },
            mode: 'image' as const,
        };
        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'picked',
            payload: legitimatePayload,
        }, PICKER_ORIGIN);

        await expect(pickPromise).resolves.toEqual(legitimatePayload);
    });

    it('rejects when the picker message has no file URL', async () => {
        const ctx = makeContext(PICKER_URL);
        const pickPromise = provider.pick(ctx as any);

        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'picked',
            payload: { item: { id: 'f1', name: 'file.png', url: '' }, mode: 'link' as const },
        }, PICKER_ORIGIN);

        await expect(pickPromise).rejects.toThrow('no file URL');
    });
});

// ─── createPopupProvider — URL resolution ─────────────────────────────────────

describe('createPopupProvider — picker URL resolution', () => {
    let openSpy: jest.SpyInstance;
    let capturedUrl: string;

    beforeEach(() => {
        capturedUrl = '';
        openSpy = jest.spyOn(window, 'open').mockImplementation((url) => {
            capturedUrl = url as string;
            return {} as Window;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses an absolute pickerUrl as-is', async () => {
        const provider = createPopupProvider(PROVIDER_ID, 'Test', '/pickers/test.html');
        const ctx = makeContext('https://cdn.example.com/picker.html');

        const pickPromise = provider.pick(ctx as any);
        // Resolve immediately to avoid timeout
        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'cancelled',
        }, 'https://cdn.example.com');

        await pickPromise;
        expect(capturedUrl).toBe('https://cdn.example.com/picker.html');
    });

    it('falls back to defaultPickerPath relative to pluginUrl when no pickerUrl', async () => {
        const provider = createPopupProvider(PROVIDER_ID, 'Test', '/pickers/test.html');
        const ctx = makeContext(undefined);

        const pickPromise = provider.pick(ctx as any);

        const expectedUrl = `${PLUGIN_URL.replace(/\/$/, '')}/pickers/test.html`;
        const expectedOrigin = new URL(expectedUrl).origin;

        dispatchMessage({
            source: 'tinymce-multicloud-plugin',
            providerId: PROVIDER_ID,
            type: 'cancelled',
        }, expectedOrigin);

        await pickPromise;
        expect(capturedUrl).toBe(expectedUrl);
    });

    it('throws when the popup is blocked', async () => {
        openSpy.mockReturnValue(null);
        const provider = createPopupProvider(PROVIDER_ID, 'Test', '/pickers/test.html');
        const ctx = makeContext(PICKER_URL);

        await expect(provider.pick(ctx as any)).rejects.toThrow('Popup could not be opened');
    });
});
