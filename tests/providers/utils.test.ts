import { detectInsertMode, combineUrl, toAbsoluteUrl, basicAuthHeader } from '../../src/providers/utils';
import type { CloudItem } from '../../src/types';

// loadScript is intentionally not tested here — it requires a DOM environment (jsdom).

const makeItem = (overrides: Partial<CloudItem> = {}): CloudItem => ({
    id: 'test-id',
    name: 'testfile',
    url: 'http://example.com/testfile',
    ...overrides,
});

// ─── detectInsertMode ────────────────────────────────────────────────────────

describe('detectInsertMode', () => {
    describe('MIME type detection', () => {
        it.each([
            ['image/jpeg'],
            ['image/png'],
            ['image/gif'],
            ['image/svg+xml'],
            ['image/webp'],
            ['image/avif'],
        ])('returns "image" for MIME type %s', (mimeType) => {
            expect(detectInsertMode(makeItem({ mimeType }))).toBe('image');
        });

        it.each([
            ['video/mp4'],
            ['video/webm'],
            ['video/ogg'],
        ])('returns "embed" for MIME type %s', (mimeType) => {
            expect(detectInsertMode(makeItem({ mimeType }))).toBe('embed');
        });

        it.each([
            ['audio/mpeg'],
            ['audio/wav'],
            ['audio/ogg'],
            ['audio/aac'],
        ])('returns "audio" for MIME type %s', (mimeType) => {
            expect(detectInsertMode(makeItem({ mimeType }))).toBe('audio');
        });

        it.each([
            ['application/pdf'],
            ['application/vnd.google-apps.document'],
            ['application/vnd.google-apps.spreadsheet'],
            ['application/vnd.google-apps.presentation'],
            ['application/vnd.google-apps.form'],
            ['application/vnd.google-apps.drawing'],
            ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
            ['application/msword'],
            ['application/vnd.ms-excel'],
            ['application/vnd.ms-powerpoint'],
            ['application/zip'],
            ['application/x-zip-compressed'],
            ['application/x-rar-compressed'],
            ['application/gzip'],
        ])('returns "embed" for embeddable MIME type %s', (mimeType) => {
            expect(detectInsertMode(makeItem({ mimeType }))).toBe('embed');
        });

        it('returns "link" for unrecognized MIME types', () => {
            expect(detectInsertMode(makeItem({ mimeType: 'text/plain' }))).toBe('link');
            expect(detectInsertMode(makeItem({ mimeType: 'application/octet-stream' }))).toBe('link');
            expect(detectInsertMode(makeItem({ mimeType: 'application/json' }))).toBe('link');
        });

        it('is case-insensitive for MIME types', () => {
            expect(detectInsertMode(makeItem({ mimeType: 'IMAGE/JPEG' }))).toBe('image');
            expect(detectInsertMode(makeItem({ mimeType: 'Video/MP4' }))).toBe('embed');
        });
    });

    describe('filename-based detection (no MIME type)', () => {
        it.each([
            ['photo.jpg'],
            ['photo.jpeg'],
            ['photo.PNG'],
            ['photo.gif'],
            ['photo.svg'],
            ['photo.webp'],
            ['photo.avif'],
            ['photo.bmp'],
            ['photo.tiff'],
        ])('returns "image" for filename %s', (name) => {
            expect(detectInsertMode(makeItem({ name, mimeType: undefined }))).toBe('image');
        });

        it.each([
            ['clip.mp4'],
            ['clip.webm'],
            ['clip.mov'],
            ['clip.mkv'],
            ['clip.avi'],
        ])('returns "embed" for filename %s', (name) => {
            expect(detectInsertMode(makeItem({ name, mimeType: undefined }))).toBe('embed');
        });

        it.each([
            ['song.mp3'],
            ['song.wav'],
            ['song.aac'],
            ['podcast.opus'],
            ['track.flac'],
        ])('returns "audio" for filename %s', (name) => {
            expect(detectInsertMode(makeItem({ name, mimeType: undefined }))).toBe('audio');
        });

        it.each([
            ['document.pdf'],
            ['document.doc'],
            ['document.docx'],
            ['spreadsheet.xls'],
            ['spreadsheet.xlsx'],
            ['presentation.ppt'],
            ['presentation.pptx'],
            ['archive.zip'],
            ['archive.rar'],
            ['archive.7z'],
        ])('returns "embed" for filename %s', (name) => {
            expect(detectInsertMode(makeItem({ name, mimeType: undefined }))).toBe('embed');
        });

        it('returns "link" for unknown file extension', () => {
            expect(detectInsertMode(makeItem({ name: 'file.xyz', mimeType: undefined }))).toBe('link');
            expect(detectInsertMode(makeItem({ name: 'data.csv', mimeType: undefined }))).toBe('link');
        });
    });

    describe('URL-based detection (no MIME type, no matching name)', () => {
        it('detects image from URL', () => {
            expect(detectInsertMode(makeItem({ name: '', mimeType: undefined, url: 'https://cdn.example.com/photo.jpg' }))).toBe('image');
        });

        it('detects video from URL', () => {
            expect(detectInsertMode(makeItem({ name: '', mimeType: undefined, url: 'https://cdn.example.com/clip.mp4' }))).toBe('embed');
        });
    });

    it('MIME type takes priority over filename', () => {
        // MIME says audio, filename extension says image — MIME wins (checked first)
        expect(detectInsertMode(makeItem({ name: 'file.jpg', mimeType: 'audio/mpeg' }))).toBe('audio');
    });

    it('returns "link" when no detection hints are present', () => {
        expect(detectInsertMode(makeItem({ name: '', mimeType: undefined, url: 'http://example.com/file' }))).toBe('link');
    });
});

// ─── combineUrl ──────────────────────────────────────────────────────────────

describe('combineUrl', () => {
    it('joins base and path with a single slash', () => {
        expect(combineUrl('https://example.com', 'path/to/file')).toBe('https://example.com/path/to/file');
    });

    it('removes a trailing slash from the base', () => {
        expect(combineUrl('https://example.com/', 'path/to/file')).toBe('https://example.com/path/to/file');
    });

    it('removes a leading slash from the path', () => {
        expect(combineUrl('https://example.com', '/path/to/file')).toBe('https://example.com/path/to/file');
    });

    it('handles both trailing base slash and leading path slash', () => {
        expect(combineUrl('https://example.com/', '/path/to/file')).toBe('https://example.com/path/to/file');
    });

    it('collapses multiple trailing slashes on the base', () => {
        expect(combineUrl('https://example.com///', 'path')).toBe('https://example.com/path');
    });

    it('collapses multiple leading slashes on the path', () => {
        expect(combineUrl('https://example.com', '///path')).toBe('https://example.com/path');
    });

    it('handles WebDAV-style deep base paths', () => {
        expect(combineUrl('https://cloud.example.com/remote.php/dav', 'files/user/folder')).toBe(
            'https://cloud.example.com/remote.php/dav/files/user/folder',
        );
    });

    it('handles an empty path segment', () => {
        expect(combineUrl('https://example.com', '')).toBe('https://example.com/');
    });
});

// ─── toAbsoluteUrl ───────────────────────────────────────────────────────────

describe('toAbsoluteUrl', () => {
    it('returns an already-absolute URL unchanged', () => {
        expect(toAbsoluteUrl('https://base.example.com', 'https://other.example.com/file.txt')).toBe(
            'https://other.example.com/file.txt',
        );
    });

    it('resolves a relative path against the base', () => {
        expect(toAbsoluteUrl('https://example.com/dir/', 'file.txt')).toBe('https://example.com/dir/file.txt');
    });

    it('resolves a root-relative path against the base origin', () => {
        expect(toAbsoluteUrl('https://example.com/dir/sub/', '/other.txt')).toBe('https://example.com/other.txt');
    });

    it('returns href as-is when URL construction throws (invalid base)', () => {
        expect(toAbsoluteUrl('not-a-valid-base', 'relative-path')).toBe('relative-path');
    });

    it('handles protocol-relative paths correctly', () => {
        const result = toAbsoluteUrl('https://example.com/page', '//cdn.example.com/file.js');
        expect(result).toBe('https://cdn.example.com/file.js');
    });
});

// ─── basicAuthHeader ─────────────────────────────────────────────────────────

describe('basicAuthHeader', () => {
    it('returns a valid Basic auth header', () => {
        const expected = `Basic ${Buffer.from('user:password').toString('base64')}`;
        expect(basicAuthHeader('user', 'password')).toBe(expected);
    });

    it('handles special characters in credentials', () => {
        const expected = `Basic ${Buffer.from('user@domain.com:p@$$w0rd!').toString('base64')}`;
        expect(basicAuthHeader('user@domain.com', 'p@$$w0rd!')).toBe(expected);
    });

    it('handles an empty password', () => {
        const expected = `Basic ${Buffer.from('user:').toString('base64')}`;
        expect(basicAuthHeader('user', '')).toBe(expected);
    });

    it('starts with "Basic "', () => {
        expect(basicAuthHeader('user', 'pass').startsWith('Basic ')).toBe(true);
    });

    it('encodes the colon separator between username and password', () => {
        const header = basicAuthHeader('alice', 'secret');
        const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8');
        expect(decoded).toBe('alice:secret');
    });
});
