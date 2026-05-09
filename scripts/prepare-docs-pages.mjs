import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "site");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const apiDocsDir = join(root, "docs", "api");
if (!existsSync(apiDocsDir)) {
    throw new Error("API docs not found — run 'npm run docs:api' first");
}

// Copy TypeDoc output directly to site root so the GitHub Pages URL is the API docs landing page
cpSync(apiDocsDir, outDir, { recursive: true });

// Prevent Jekyll processing (required for TypeDoc asset paths that start with _)
writeFileSync(join(outDir, ".nojekyll"), "", "utf8");

console.log(`GitHub Pages API docs bundle prepared in: ${outDir}`);
