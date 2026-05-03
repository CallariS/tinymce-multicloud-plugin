import type { CloudItem, InsertMode } from "../types";

/**
 * Dynamically injects a `<script>` tag into `document.head` and resolves when the script
 * has loaded. If the same URL is already present in the DOM, it waits for the existing
 * element to finish loading (or resolves immediately if it already loaded).
 *
 * A `data-mc-loaded="true"` attribute is stamped onto the element on success so that
 * repeated calls for the same URL resolve instantly without creating duplicate tags.
 *
 * @param src - Absolute URL of the script to load.
 * @param attrs - Optional additional HTML attributes to set on the `<script>` element
 *   (e.g. `{ "data-app-key": "abc123" }` for the Dropbox SDK).
 * @param integrity - Optional SRI hash (e.g. `"sha384-…"`). When provided, `integrity`
 *   and `crossorigin="anonymous"` are set on the element so the browser enforces the hash.
 * @returns A promise that resolves when the script has loaded.
 * @throws {Error} If the script fails to load (network error, 404, SRI mismatch, etc.).
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const loadScript = async (
    src: string,
    attrs: Record<string, string> = {},
    integrity?: string,
): Promise<void> =>
    new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
            if (existing.dataset.mcLoaded === "true") {
                resolve();
                return;
            }

            // Guard against a pre-existing script element that never fires load/error
            // (e.g. injected by a third party without completing). Reject after 15 s.
            const waitTimeout = window.setTimeout(() => {
                existing.removeEventListener("load", onLoad);
                existing.removeEventListener("error", onError);
                reject(new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / Utils ] Timed out waiting for ${src} ]`));
            }, 15_000);

            const onLoad = () => { window.clearTimeout(waitTimeout); resolve(); };
            const onError = () => { window.clearTimeout(waitTimeout); reject(new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / Utils ] Unable to load ${src} ]`)); };

            existing.addEventListener("load", onLoad, { once: true });
            existing.addEventListener("error", onError, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;

        if (integrity) {
            script.integrity = integrity;
            script.crossOrigin = "anonymous";
        }

        Object.entries(attrs).forEach(([key, value]) => {
            script.setAttribute(key, value);
        });

        script.addEventListener("load", () => {
            script.dataset.mcLoaded = "true";
            resolve();
        });
        script.addEventListener("error", () => reject(new Error(`[[ WaXCode / TinyMCE Multicloud Plugin / Utils ] Unable to load ${src} ]`)));

        document.head.appendChild(script);
    });

/** Matches common raster and vector image file extensions. */
const imagePattern = /\.(apng|avif|gif|jpe?g|png|svg|webp|bmp|tiff?)$/i;
/** Matches common video file extensions. */
const videoPattern = /\.(mp4|webm|ogg|mov|m4v|avi|wmv|flv|mkv)$/i;
/** Matches common audio file extensions. */
const audioPattern = /\.(mp3|wav|ogg|aac|m4a|flac|opus|oga|weba)$/i;
/** Matches PDF file extensions. */
const pdfPattern = /\.pdf$/i;
/** Matches common Office and OpenDocument file extensions. */
const officePattern = /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i;
/** Matches common archive file extensions. */
const archivePattern = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i;

// MIME types that should be embedded
const EMBEDDABLE_MIMES = [
    "application/pdf",
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
    "application/vnd.google-apps.form",
    "application/vnd.google-apps.drawing",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
    "application/msword", // .doc
    "application/vnd.ms-excel", // .xls
    "application/vnd.ms-powerpoint", // .ppt
    "application/zip", // .zip
    "application/x-zip-compressed", // .zip (alternate)
    "application/x-rar-compressed", // .rar
    "application/x-7z-compressed", // .7z
    "application/x-tar", // .tar
    "application/gzip", // .gz
    "application/x-gzip", // .gz (alternate)
];

/**
 * Inspects a {@link CloudItem}'s MIME type and file name/URL to determine the most
 * appropriate {@link InsertMode} for it.
 *
 * Resolution order:
 * 1. MIME type (checked first, most reliable).
 * 2. File name extension.
 * 3. URL pattern (fallback when name is empty).
 * 4. Defaults to `"link"` when nothing matches.
 *
 * @param item - The cloud item to inspect.
 * @returns The recommended {@link InsertMode}.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const detectInsertMode = (item: CloudItem): InsertMode => {
    const mime = item.mimeType?.toLowerCase() || "";
    const name = item.name || "";
    const url = item.url || "";

    // MIME type takes priority — check it first before falling back to filename/URL
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "embed";
    if (mime.startsWith("audio/")) return "audio";
    if (EMBEDDABLE_MIMES.includes(mime)) return "embed";

    // Fall back to filename / URL pattern detection
    if (imagePattern.test(name) || imagePattern.test(url)) return "image";
    if (videoPattern.test(name) || videoPattern.test(url)) return "embed";
    if (audioPattern.test(name) || audioPattern.test(url)) return "audio";
    if (pdfPattern.test(name) || officePattern.test(name) || archivePattern.test(name)) return "embed";

    // Default to link
    return "link";
};

/**
 * Joins a base URL and a relative path, ensuring exactly one `/` separator between them.
 * Trailing slashes on `base` and leading slashes on `path` are normalised before joining.
 *
 * @param base - Base URL or path (e.g. `"https://cloud.example.com/"`).
 * @param path - Relative path to append (e.g. `"remote.php/dav/files/user"`).
 * @returns The combined URL string.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const combineUrl = (base: string, path: string): string => {
    const normalizedBase = base.replace(/\/+$/, "");
    const normalizedPath = path.replace(/^\/+/, "");
    return `${normalizedBase}/${normalizedPath}`;
};

/**
 * Resolves `href` against `base` using the browser's `URL` constructor.
 * Falls back to returning `href` unchanged if either value is not a valid URL.
 *
 * @param base - Absolute base URL used to resolve relative references.
 * @param href - URL or relative reference to resolve.
 * @returns Absolute URL string.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const toAbsoluteUrl = (base: string, href: string): string => {
    try {
        return new URL(href, base).toString();
    } catch {
        return href;
    }
};

/**
 * Builds an HTTP Basic Authentication header value from a username and password.
 * The credentials are Base64-encoded using `btoa`.
 *
 * @param username - Plain-text username.
 * @param password - Plain-text password.
 * @returns The `Authorization` header value in `"Basic <base64>"` format.
 *
 * @author Salvatore Callari <Callari@WaXCode.net>
 */
export const basicAuthHeader = (username: string, password: string): string => {
    const encoded = btoa(`${username}:${password}`);
    return `Basic ${encoded}`;
};
