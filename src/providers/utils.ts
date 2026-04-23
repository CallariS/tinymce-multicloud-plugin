import type { CloudItem, InsertMode } from "../types";

export const loadScript = async (
    src: string,
    attrs: Record<string, string> = {},
): Promise<void> =>
    new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
            if (existing.dataset.mcLoaded === "true") {
                resolve();
                return;
            }

            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)), {
                once: true,
            });
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;

        Object.entries(attrs).forEach(([key, value]) => {
            script.setAttribute(key, value);
        });

        script.addEventListener("load", () => {
            script.dataset.mcLoaded = "true";
            resolve();
        });
        script.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)));

        document.head.appendChild(script);
    });

const imagePattern = /\.(apng|avif|gif|jpe?g|png|svg|webp|bmp|tiff?)$/i;

export const detectInsertMode = (item: CloudItem): InsertMode => {
    const mime = item.mimeType?.toLowerCase() || "";
    const source = `${item.name} ${item.url}`;

    if (mime.startsWith("image/") || imagePattern.test(source)) {
        return "image";
    }

    return "link";
};

export const combineUrl = (base: string, path: string): string => {
    const normalizedBase = base.replace(/\/+$/, "");
    const normalizedPath = path.replace(/^\/+/, "");
    return `${normalizedBase}/${normalizedPath}`;
};

export const toAbsoluteUrl = (base: string, href: string): string => {
    try {
        return new URL(href, base).toString();
    } catch {
        return href;
    }
};

export const basicAuthHeader = (username: string, password: string): string => {
    const encoded = btoa(`${username}:${password}`);
    return `Basic ${encoded}`;
};
