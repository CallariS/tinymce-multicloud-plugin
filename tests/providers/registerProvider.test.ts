/**
 * Tests for the registerProvider / unregisterProvider API.
 *
 * The index module calls `register()` at load time which accesses `tinymce.PluginManager.add`.
 * We set up the global mock before importing so the module initialises cleanly.
 */

// ─── tinymce stub (must come before the import) ──────────────────────────────

const addMock = jest.fn();
(global as any).tinymce = {
    PluginManager: {
        add: addMock,
    },
};

// ─── import after stub ───────────────────────────────────────────────────────

import { registerProvider, unregisterProvider } from '../../src/index';
import type { CloudProvider } from '../../src/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeProvider = (id: string): CloudProvider => ({
    id,
    label: `Provider ${id}`,
    pick: jest.fn().mockResolvedValue(null),
});

// ─── registerProvider / unregisterProvider ───────────────────────────────────

describe('registerProvider', () => {
    afterEach(() => {
        // Clean up — unregister any providers added during the test
        unregisterProvider('custom-a');
        unregisterProvider('custom-b');
    });

    it('is exported from the plugin bundle', () => {
        expect(typeof registerProvider).toBe('function');
    });

    it('accepts a valid CloudProvider without throwing', () => {
        expect(() => registerProvider(makeProvider('custom-a'))).not.toThrow();
    });

    it('allows registering multiple providers', () => {
        expect(() => {
            registerProvider(makeProvider('custom-a'));
            registerProvider(makeProvider('custom-b'));
        }).not.toThrow();
    });

    it('allows overwriting a provider with the same id', () => {
        const v1 = makeProvider('custom-a');
        const v2 = { ...makeProvider('custom-a'), label: 'Updated A' };
        registerProvider(v1);
        expect(() => registerProvider(v2)).not.toThrow();
    });
});

describe('unregisterProvider', () => {
    it('is exported from the plugin bundle', () => {
        expect(typeof unregisterProvider).toBe('function');
    });

    it('removes a previously registered provider without throwing', () => {
        registerProvider(makeProvider('custom-a'));
        expect(() => unregisterProvider('custom-a')).not.toThrow();
    });

    it('has no effect when called for an unknown id', () => {
        expect(() => unregisterProvider('does-not-exist')).not.toThrow();
    });
});
