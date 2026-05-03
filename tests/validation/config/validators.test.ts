import { PluginOptionsValidator, configureMultiCloudValidation } from '../../../src/validation/config/validators';

const baseOptions = {
    providers: {},
    defaultInsertMode: 'link' as const,
    dialogTitle: 'Insert From Cloud',
    popupTimeoutMs: 120000,
};

// ─── Input type validation ────────────────────────────────────────────────────

describe('PluginOptionsValidator — input type checks', () => {
    it('throws for null input', () => {
        expect(() => new PluginOptionsValidator().validate(null)).toThrow('XDBC Infringement');
    });

    it('throws for an array input', () => {
        expect(() => new PluginOptionsValidator().validate([])).toThrow('XDBC Infringement');
    });

    it('throws for a string input', () => {
        expect(() => new PluginOptionsValidator().validate('options')).toThrow('XDBC Infringement');
    });

    it('throws for a number input', () => {
        expect(() => new PluginOptionsValidator().validate(42)).toThrow('XDBC Infringement');
    });
});

// ─── defaultInsertMode validation ────────────────────────────────────────────

describe('PluginOptionsValidator — defaultInsertMode', () => {
    it.each(['link', 'image', 'embed'] as const)(
        'accepts valid insert mode "%s"',
        (mode) => {
            expect(() =>
                new PluginOptionsValidator().validate({ ...baseOptions, defaultInsertMode: mode }),
            ).not.toThrow();
        },
    );

    it('throws for "audio" as defaultInsertMode (not a valid default)', () => {
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, defaultInsertMode: 'audio' }),
        ).toThrow();
    });

    it('throws for an arbitrary invalid string', () => {
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, defaultInsertMode: 'invalid' }),
        ).toThrow();
    });
});

// ─── popupTimeoutMs validation ───────────────────────────────────────────────

describe('PluginOptionsValidator — popupTimeoutMs', () => {
    it('throws for a value of 0', () => {
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, popupTimeoutMs: 0 }),
        ).toThrow();
    });

    it('throws for a negative value', () => {
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, popupTimeoutMs: -1000 }),
        ).toThrow();
    });

    it('accepts any positive value', () => {
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, popupTimeoutMs: 30000 }),
        ).not.toThrow();
    });
});

// ─── defaultProvider validation ──────────────────────────────────────────────

describe('PluginOptionsValidator — defaultProvider', () => {
    it('throws when defaultProvider is not present in the providers map', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: {},
                defaultProvider: 'googleDrive',
            }),
        ).toThrow();
    });

    it('accepts defaultProvider when it exists in the providers map', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: {
                    dropbox: { appKey: 'valid-app-key-12345678' },
                },
                defaultProvider: 'dropbox',
            }),
        ).not.toThrow();
    });
});

// ─── Google Drive provider validation ────────────────────────────────────────

describe('PluginOptionsValidator — Google Drive provider', () => {
    it('accepts a valid config', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: {
                googleDrive: {
                    clientId: 'valid-client-id-12345',
                    apiKey: 'valid-api-key-12345',
                },
            },
        });
        expect(result.providers?.googleDrive).toBeDefined();
    });

    it('throws when clientId is missing', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { googleDrive: { apiKey: 'valid-api-key-12345' } },
            }),
        ).toThrow();
    });

    it('throws when apiKey is missing', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { googleDrive: { clientId: 'valid-client-id-12345' } },
            }),
        ).toThrow();
    });

    it('skips credential validation when the provider is disabled', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { googleDrive: false },
        });
        expect(result.providers?.googleDrive?.enabled).toBe(false);
    });

    it('skips credential validation when a popup pickerUrl is provided', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: {
                    googleDrive: { pickerUrl: 'https://example.com/picker.html' },
                },
            }),
        ).not.toThrow();
    });
});

// ─── OneDrive provider validation ────────────────────────────────────────────

describe('PluginOptionsValidator — OneDrive provider', () => {
    it('accepts a valid config', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { oneDrive: { clientId: 'valid-client-id-12345' } },
        });
        expect(result.providers?.oneDrive).toBeDefined();
    });

    it('throws when clientId is missing', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { oneDrive: {} },
            }),
        ).toThrow();
    });

    it('skips credential validation when the provider is disabled', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { oneDrive: false },
        });
        expect(result.providers?.oneDrive?.enabled).toBe(false);
    });
});

// ─── Dropbox provider validation ─────────────────────────────────────────────

describe('PluginOptionsValidator — Dropbox provider', () => {
    it('accepts a valid config', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { dropbox: { appKey: 'valid-app-key-12345678' } },
        });
        expect(result.providers?.dropbox).toBeDefined();
    });

    it('throws when appKey is missing', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { dropbox: {} },
            }),
        ).toThrow();
    });

    it('skips credential validation when the provider is disabled', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { dropbox: false },
        });
        expect(result.providers?.dropbox?.enabled).toBe(false);
    });
});

// ─── BayernCloud provider validation ─────────────────────────────────────────

describe('PluginOptionsValidator — BayernCloud provider', () => {
    const baseCloud = {
        baseUrl: 'https://cloud.example.com',
        username: 'admin',
    };

    it('accepts a valid config with password', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { bayerncloud: { ...baseCloud, password: 'secret-password' } },
        });
        expect(result.providers?.bayerncloud).toBeDefined();
    });

    it('accepts a valid config with bearerToken instead of password', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { bayerncloud: { ...baseCloud, bearerToken: 'my-bearer-token-12345' } },
        });
        expect(result.providers?.bayerncloud).toBeDefined();
    });

    it('throws when neither password nor bearerToken is provided', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { bayerncloud: baseCloud },
            }),
        ).toThrow();
    });

    it('throws when baseUrl is missing', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { bayerncloud: { username: 'admin', password: 'pass' } },
            }),
        ).toThrow();
    });

    it('throws when username is missing', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: { bayerncloud: { baseUrl: 'https://cloud.example.com', password: 'pass' } },
            }),
        ).toThrow();
    });

    it('throws when baseUrl is not a valid URL', () => {
        expect(() =>
            new PluginOptionsValidator().validate({
                ...baseOptions,
                providers: {
                    bayerncloud: { baseUrl: 'not-a-url', username: 'admin', password: 'pass' },
                },
            }),
        ).toThrow();
    });

    it('skips credential validation when the provider is disabled', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { bayerncloud: false },
        });
        expect(result.providers?.bayerncloud?.enabled).toBe(false);
    });
});

// ─── Return value shape ───────────────────────────────────────────────────────

describe('PluginOptionsValidator — return value', () => {
    it('returns a MultiCloudPluginOptions object with the correct structure', () => {
        const result = new PluginOptionsValidator().validate({
            providers: {
                dropbox: { appKey: 'my-app-key-12345678' },
            },
            defaultProvider: 'dropbox',
            defaultInsertMode: 'image',
            dialogTitle: 'Pick a File',
            popupTimeoutMs: 60000,
        });

        expect(result.defaultProvider).toBe('dropbox');
        expect(result.defaultInsertMode).toBe('image');
        expect(result.dialogTitle).toBe('Pick a File');
        expect(result.popupTimeoutMs).toBe(60000);
        expect(result.providers?.dropbox).toBeDefined();
    });

    it('normalises a boolean true provider config to an enabled object', () => {
        // boolean true is normalised to { enabled: true } but still requires credentials — so this throws
        expect(() => new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { dropbox: true },
        })).toThrow();
    });

    it('normalises a boolean false provider config to enabled:false', () => {
        const result = new PluginOptionsValidator().validate({
            ...baseOptions,
            providers: { googleDrive: false },
        });
        expect(result.providers?.googleDrive?.enabled).toBe(false);
    });
});

// ─── configureMultiCloudValidation — config layer ─────────────────────────────

describe('configureMultiCloudValidation — config layer', () => {
    afterEach(() => {
        // Restore defaults so other tests are not affected.
        configureMultiCloudValidation({ config: { throwOnInfringement: true, logToConsole: true } });
    });

    it('suppresses config violations when throwOnInfringement is false', () => {
        configureMultiCloudValidation({ config: { throwOnInfringement: false, logToConsole: false } });
        // Uses an invalid defaultInsertMode (not null) so that after the suppressed DBC check
        // the code can continue executing without a native TypeError.
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, defaultInsertMode: 'invalid' as never }),
        ).not.toThrow();
    });

    it('restores throwing when throwOnInfringement is set back to true', () => {
        configureMultiCloudValidation({ config: { throwOnInfringement: false, logToConsole: false } });
        configureMultiCloudValidation({ config: { throwOnInfringement: true } });
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, defaultInsertMode: 'invalid' as never }),
        ).toThrow('XDBC Infringement');
    });

    it('applies only the keys provided — partial update leaves other settings unchanged', () => {
        // Disable throwing; then update only logToConsole — throwOnInfringement should stay false.
        configureMultiCloudValidation({ config: { throwOnInfringement: false, logToConsole: false } });
        configureMultiCloudValidation({ config: { logToConsole: true } });
        // Still should not throw because throwOnInfringement was not changed back.
        expect(() =>
            new PluginOptionsValidator().validate({ ...baseOptions, defaultInsertMode: 'invalid' as never }),
        ).not.toThrow();
    });
});
