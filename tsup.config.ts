import { defineConfig } from "tsup";

export default defineConfig((options) => ({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "TinyMceMultiCloudPlugin",
    outDir: "dist",
    clean: true,
    minify: !options.watch,
    sourcemap: true,
    dts: true,
    esbuildOptions(opts) {
        // Strip all console calls from the production bundle to prevent token
        // and diagnostic data leaking via the browser console in deployed builds.
        // The dev/watch build retains console output for debugging.
        if (!options.watch) {
            opts.drop = ["console"];
        }
    },
}));
