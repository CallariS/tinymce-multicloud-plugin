import { defineConfig } from "tsup";

export default defineConfig([
    {
        entry: ["src/index.ts"],
        format: ["esm", "cjs"],
        outDir: "dist",
        clean: true,
        minify: true,
        sourcemap: true,
        dts: true,
    },
    {
        entry: ["src/index.ts"],
        format: ["iife"],
        globalName: "TinyMceMultiCloudPlugin",
        outDir: "dist",
        clean: false,
        minify: true,
        sourcemap: true,
    },
]);
