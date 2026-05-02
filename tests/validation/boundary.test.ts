import {
    validatePickerResultBoundary,
    validateGoogleDocBoundary,
    validateOneDriveFileBoundary,
    validateDropboxFileBoundary,
    validateWebDavNodeBoundary,
    validatePluginOptionsBoundary,
} from '../../src/validation/boundary';

// ─── validatePickerResultBoundary ────────────────────────────────────────────

describe('validatePickerResultBoundary', () => {
    const validItem = {
        id: 'file-123',
        name: 'document.pdf',
        url: 'https://example.com/document.pdf',
    };

    describe('valid inputs', () => {
        it('accepts a minimal picker result', () => {
            const result = validatePickerResultBoundary('googleDrive', { item: validItem });
            expect(result.item.id).toBe('file-123');
            expect(result.item.name).toBe('document.pdf');
            expect(result.item.url).toBe('https://example.com/document.pdf');
        });

        it('accepts a picker result with a mode override', () => {
            const result = validatePickerResultBoundary('dropbox', { item: validItem, mode: 'image' });
            expect(result.mode).toBe('image');
        });

        it.each(['link', 'image', 'embed', 'audio'] as const)(
            'accepts insert mode "%s"',
            (mode) => {
                const result = validatePickerResultBoundary('oneDrive', { item: validItem, mode });
                expect(result.mode).toBe(mode);
            },
        );

        it('accepts optional CloudItem fields', () => {
            const result = validatePickerResultBoundary('googleDrive', {
                item: {
                    ...validItem,
                    mimeType: 'application/pdf',
                    thumbnailUrl: 'https://example.com/thumb.jpg',
                    embedUrl: 'https://example.com/embed',
                    downloadUrl: 'https://example.com/download',
                    type: 'file' as const,
                },
            });
            expect(result.item.mimeType).toBe('application/pdf');
            expect(result.item.thumbnailUrl).toBe('https://example.com/thumb.jpg');
        });
    });

    describe('invalid inputs', () => {
        it('throws for null input', () => {
            expect(() => validatePickerResultBoundary('googleDrive', null)).toThrow();
        });

        it('throws for a non-object input', () => {
            expect(() => validatePickerResultBoundary('googleDrive', 'string')).toThrow();
        });

        it('throws when item.id is missing', () => {
            expect(() =>
                validatePickerResultBoundary('googleDrive', {
                    item: { name: 'file.pdf', url: 'https://example.com/file.pdf' },
                }),
            ).toThrow();
        });

        it('throws when item.name is missing', () => {
            expect(() =>
                validatePickerResultBoundary('googleDrive', {
                    item: { id: '123', url: 'https://example.com/file.pdf' },
                }),
            ).toThrow();
        });

        it('throws when item.url is not a valid URL', () => {
            expect(() =>
                validatePickerResultBoundary('googleDrive', {
                    item: { id: '123', name: 'file.pdf', url: 'not-a-url' },
                }),
            ).toThrow();
        });

        it('throws for an invalid mode value', () => {
            expect(() =>
                validatePickerResultBoundary('googleDrive', {
                    item: validItem,
                    mode: 'invalid-mode',
                }),
            ).toThrow();
        });

        it('throws when item.id is an empty string', () => {
            expect(() =>
                validatePickerResultBoundary('googleDrive', {
                    item: { id: '', name: 'file.pdf', url: 'https://example.com/file.pdf' },
                }),
            ).toThrow();
        });
    });
});

// ─── validateGoogleDocBoundary ───────────────────────────────────────────────

describe('validateGoogleDocBoundary', () => {
    const validDoc = {
        id: 'doc-id-123',
        name: 'My Document',
        url: 'https://drive.google.com/file/d/doc-id-123/view',
        mimeType: 'application/vnd.google-apps.document',
    };

    describe('valid inputs', () => {
        it('accepts a complete Google doc object', () => {
            const result = validateGoogleDocBoundary(validDoc);
            expect(result.id).toBe('doc-id-123');
        });

        it('accepts a doc with only id (all other fields optional)', () => {
            const result = validateGoogleDocBoundary({ id: 'abc123' });
            expect(result.id).toBe('abc123');
        });

        it('accepts a doc with thumbnails', () => {
            const result = validateGoogleDocBoundary({
                ...validDoc,
                thumbnails: [{ url: 'https://example.com/thumb.jpg' }],
            });
            expect(result.thumbnails).toHaveLength(1);
        });

        it('accepts a doc with empty thumbnails array', () => {
            const result = validateGoogleDocBoundary({ ...validDoc, thumbnails: [] });
            expect(result.thumbnails).toEqual([]);
        });
    });

    describe('invalid inputs', () => {
        it('throws when id is missing', () => {
            expect(() => validateGoogleDocBoundary({ name: 'My Doc' })).toThrow();
        });

        it('throws when id is an empty string', () => {
            expect(() => validateGoogleDocBoundary({ id: '' })).toThrow();
        });

        it('throws for null input', () => {
            expect(() => validateGoogleDocBoundary(null)).toThrow();
        });

        it('throws for non-object input', () => {
            expect(() => validateGoogleDocBoundary('string')).toThrow();
        });
    });
});

// ─── validateOneDriveFileBoundary ────────────────────────────────────────────

describe('validateOneDriveFileBoundary', () => {
    const validFile = {
        id: 'onedrive-file-id',
        name: 'presentation.pptx',
        webUrl: 'https://onedrive.live.com/view.aspx?id=onedrive-file-id',
        '@microsoft.graph.downloadUrl': 'https://onedrive.live.com/download?id=onedrive-file-id',
        file: {
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
    };

    describe('valid inputs', () => {
        it('accepts a complete OneDrive file', () => {
            const result = validateOneDriveFileBoundary(validFile);
            expect(result.name).toBe('presentation.pptx');
        });

        it('accepts a minimal OneDrive file (only name is required)', () => {
            const result = validateOneDriveFileBoundary({ name: 'file.docx' });
            expect(result.name).toBe('file.docx');
        });

        it('accepts an optional file mimeType', () => {
            const result = validateOneDriveFileBoundary({
                name: 'file.xlsx',
                file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            });
            expect(result.file?.mimeType).toBeDefined();
        });
    });

    describe('invalid inputs', () => {
        it('throws when name is missing', () => {
            expect(() => validateOneDriveFileBoundary({ id: 'abc' })).toThrow();
        });

        it('throws when name is an empty string', () => {
            expect(() => validateOneDriveFileBoundary({ name: '' })).toThrow();
        });

        it('throws for null input', () => {
            expect(() => validateOneDriveFileBoundary(null)).toThrow();
        });
    });
});

// ─── validateDropboxFileBoundary ─────────────────────────────────────────────

describe('validateDropboxFileBoundary', () => {
    const validFile = {
        id: 'dropbox-id-123',
        name: 'photo.jpg',
        link: 'https://www.dropbox.com/s/abc123/photo.jpg',
        thumbnailLink: 'https://www.dropbox.com/s/abc123/photo.jpg?thumb=1',
    };

    describe('valid inputs', () => {
        it('accepts a complete Dropbox file', () => {
            const result = validateDropboxFileBoundary(validFile);
            expect(result.link).toBe('https://www.dropbox.com/s/abc123/photo.jpg');
        });

        it('accepts a minimal Dropbox file (only link is required)', () => {
            const result = validateDropboxFileBoundary({
                link: 'https://www.dropbox.com/s/xyz/file.pdf',
            });
            expect(result.link).toBeDefined();
        });
    });

    describe('invalid inputs', () => {
        it('throws when link is missing', () => {
            expect(() => validateDropboxFileBoundary({ name: 'file.pdf' })).toThrow();
        });

        it('throws when link is not a valid URL', () => {
            expect(() => validateDropboxFileBoundary({ link: 'not-a-url' })).toThrow();
        });

        it('throws for null input', () => {
            expect(() => validateDropboxFileBoundary(null)).toThrow();
        });

        it('throws for non-object input', () => {
            expect(() => validateDropboxFileBoundary(42)).toThrow();
        });
    });
});

// ─── validateWebDavNodeBoundary ──────────────────────────────────────────────

describe('validateWebDavNodeBoundary', () => {
    const validNode = {
        id: '/remote.php/dav/files/user/folder/file.pdf',
        name: 'file.pdf',
        url: 'https://nextcloud.example.com/remote.php/dav/files/user/folder/file.pdf',
        mimeType: 'application/pdf',
        isDirectory: false,
        webdavPath: '/files/user/folder/file.pdf',
    };

    describe('valid inputs', () => {
        it('accepts a valid file node', () => {
            const result = validateWebDavNodeBoundary(validNode);
            expect(result.name).toBe('file.pdf');
            expect(result.isDirectory).toBe(false);
        });

        it('accepts a directory node', () => {
            const result = validateWebDavNodeBoundary({
                ...validNode,
                name: 'folder',
                isDirectory: true,
            });
            expect(result.isDirectory).toBe(true);
        });

        it('accepts a node without optional mimeType', () => {
            const { mimeType: _, ...withoutMime } = validNode;
            const result = validateWebDavNodeBoundary(withoutMime);
            expect(result.name).toBe('file.pdf');
        });
    });

    describe('invalid inputs', () => {
        it('throws when id is missing', () => {
            const { id: _, ...withoutId } = validNode;
            expect(() => validateWebDavNodeBoundary(withoutId)).toThrow();
        });

        it('throws when name is missing', () => {
            const { name: _, ...withoutName } = validNode;
            expect(() => validateWebDavNodeBoundary(withoutName)).toThrow();
        });

        it('throws when isDirectory is missing', () => {
            const { isDirectory: _, ...withoutIsDir } = validNode;
            expect(() => validateWebDavNodeBoundary(withoutIsDir)).toThrow();
        });

        it('throws when webdavPath is missing', () => {
            const { webdavPath: _, ...withoutPath } = validNode;
            expect(() => validateWebDavNodeBoundary(withoutPath)).toThrow();
        });

        it('throws when url is not a valid URL', () => {
            expect(() => validateWebDavNodeBoundary({ ...validNode, url: 'not-a-url' })).toThrow();
        });

        it('throws for null input', () => {
            expect(() => validateWebDavNodeBoundary(null)).toThrow();
        });
    });
});

// ─── validatePluginOptionsBoundary ───────────────────────────────────────────

describe('validatePluginOptionsBoundary', () => {
    const baseOptions = {
        providers: {},
        defaultInsertMode: 'link' as const,
        dialogTitle: 'Insert From Cloud',
        popupTimeoutMs: 120000,
    };

    describe('invalid inputs', () => {
        it('throws for null input', () => {
            expect(() => validatePluginOptionsBoundary(null)).toThrow();
        });

        it('throws for array input', () => {
            expect(() => validatePluginOptionsBoundary([])).toThrow();
        });

        it('throws for string input', () => {
            expect(() => validatePluginOptionsBoundary('options')).toThrow();
        });
    });

    describe('valid inputs', () => {
        it('accepts minimal valid options', () => {
            const result = validatePluginOptionsBoundary(baseOptions);
            expect(result).toBeDefined();
            expect(result.providers).toEqual({});
            expect(result.defaultInsertMode).toBe('link');
        });

        it('returns options with correct shape', () => {
            const result = validatePluginOptionsBoundary({
                ...baseOptions,
                dialogTitle: 'My Picker',
                popupTimeoutMs: 60000,
            });
            expect(result.dialogTitle).toBe('My Picker');
            expect(result.popupTimeoutMs).toBe(60000);
        });
    });
});
