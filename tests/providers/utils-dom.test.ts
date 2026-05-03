/**
 * Tests for loadScript utility — requires jsdom so document.head is available.
 */
import { loadScript } from '../../src/providers/utils';

// ─── loadScript ───────────────────────────────────────────────────────────────

describe('loadScript', () => {
    beforeEach(() => {
        // Clean up any script tags injected by previous tests
        document.querySelectorAll('script[data-test-url]').forEach(el => el.remove());
        document.querySelectorAll('script[src]').forEach(el => el.remove());
    });

    it('injects a <script> tag with the given src', async () => {
        const src = 'https://cdn.example.com/sdk.js';
        const promise = loadScript(src);

        const injected = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
        expect(injected).not.toBeNull();
        expect(injected.async).toBe(true);

        // Simulate successful load
        injected.dispatchEvent(new Event('load'));
        await expect(promise).resolves.toBeUndefined();
    });

    it('stamps data-mc-loaded="true" after successful load', async () => {
        const src = 'https://cdn.example.com/sdk2.js';
        const promise = loadScript(src);
        const injected = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
        injected.dispatchEvent(new Event('load'));
        await promise;
        expect(injected.dataset.mcLoaded).toBe('true');
    });

    it('does not inject a duplicate tag when called twice for the same URL', async () => {
        const src = 'https://cdn.example.com/sdk3.js';
        const p1 = loadScript(src);
        const injected = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
        injected.dispatchEvent(new Event('load'));
        await p1;

        // Second call — already marked as loaded
        const p2 = loadScript(src);
        await p2;

        const all = document.querySelectorAll(`script[src="${src}"]`);
        expect(all.length).toBe(1);
    });

    it('rejects on script error', async () => {
        const src = 'https://cdn.example.com/missing.js';
        const promise = loadScript(src);
        const injected = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
        injected.dispatchEvent(new Event('error'));
        await expect(promise).rejects.toThrow(`Unable to load ${src}`);
    });

    it('sets additional attributes on the script tag', async () => {
        const src = 'https://cdn.example.com/sdk4.js';
        const attrs = { 'data-app-key': 'my-key', id: 'custom-sdk' };
        const promise = loadScript(src, attrs);
        const injected = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
        injected.dispatchEvent(new Event('load'));
        await promise;
        expect(injected.getAttribute('data-app-key')).toBe('my-key');
        expect(injected.id).toBe('custom-sdk');
    });

    it('resolves immediately for a URL already present and marked as loaded', async () => {
        const src = 'https://cdn.example.com/sdk5.js';
        // Manually inject a pre-loaded script tag
        const preExisting = document.createElement('script');
        preExisting.src = src;
        preExisting.dataset.mcLoaded = 'true';
        document.head.appendChild(preExisting);

        await expect(loadScript(src)).resolves.toBeUndefined();
        // No second tag injected
        expect(document.querySelectorAll(`script[src="${src}"]`).length).toBe(1);
    });
});
