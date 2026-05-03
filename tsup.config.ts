import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "TinyMceMultiCloudPlugin",
    outDir: "dist",
    clean: true,
    minify: true,
    sourcemap: true,
    dts: true,
});
