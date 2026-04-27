import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "site");

const ensureExists = (path, hint) => {
  if (!existsSync(path)) {
    throw new Error(`${hint} not found: ${path}`);
  }
};

const copyDir = (from, to) => {
  cpSync(from, to, { recursive: true });
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const distDir = join(root, "dist");
const demoDir = join(root, "demo");
const docsDir = join(root, "docs");

ensureExists(distDir, "Build output directory");
ensureExists(demoDir, "Demo directory");
ensureExists(docsDir, "Documentation directory");

copyDir(distDir, join(outDir, "dist"));
copyDir(demoDir, join(outDir, "demo"));

// multicloud.config.js is gitignored (contains real credentials).
// In CI, secrets are injected via environment variables.
// Locally, the file is copied from the working tree if it exists.
const localConfig = join(demoDir, "multicloud.config.js");
if (existsSync(localConfig)) {
  cpSync(localConfig, join(outDir, "demo", "multicloud.config.js"));
} else {
  const env = (key, fallback) => process.env[key] ?? fallback;

  // Normalize the Google OAuth client ID: strip any number of trailing
  // .apps.googleusercontent.com suffixes (handles copy-paste mistakes),
  // then append it exactly once. .trim() handles secrets with trailing whitespace.
  const rawGoogleClientId = env("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID").trim();
  const baseClientId = rawGoogleClientId.replace(/(?:\.apps\.googleusercontent\.com)+$/i, "");
  const googleClientId = baseClientId + ".apps.googleusercontent.com";

  writeFileSync(
    join(outDir, "demo", "multicloud.config.js"),
    `window.MULTICLOUD_CONFIG = {
    providers: {
        googleDrive: {
            enabled: true,
            apiKey: "${env("GOOGLE_BROWSER_API_KEY", "GOOGLE_BROWSER_API_KEY")}",
            clientId: "${googleClientId}",
            scopes: ["https://www.googleapis.com/auth/drive.file"],
        },
        oneDrive: {
            enabled: true,
            clientId: "${env("ONEDRIVE_CLIENT_ID", "ONEDRIVE_CLIENT_ID")}",
            action: "query",
            redirectUri: window.location.origin,
        },
        dropbox: {
            enabled: true,
            appKey: "${env("DROPBOX_APP_KEY", "DROPBOX_APP_KEY")}",
            linkType: "direct",
            multiselect: false,
            extensions: [],
        },
        bayerncloud: {
            enabled: true,
            pickerUrl: "./pickers/bayerncloud.html",
        },
    },
    defaultProvider: "googleDrive",
    defaultInsertMode: "link",
    dialogTitle: "Insert From Cloud",
    popupTimeoutMs: 120000,
};
`,
    "utf8",
  );
}
copyDir(docsDir, join(outDir, "docs"));

writeFileSync(
  join(outDir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TinyMCE MultiCloud Plugin</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 2rem; line-height: 1.5; }
      a { color: #0b5fff; }
      .card { border: 1px solid #d9d9d9; border-radius: 12px; padding: 1rem; max-width: 780px; }
      h1 { margin-top: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>TinyMCE MultiCloud Plugin</h1>
      <p>This site is generated for GitHub Pages demos.</p>
      <ul>
        <li><a href="./demo/tinymce-demo.html">Open demo editor</a></li>
        <li><a href="./docs/PRODUCTION_SETUP.md">Production setup guide</a></li>
      </ul>
    </div>
  </body>
</html>
`,
  "utf8",
);

writeFileSync(join(outDir, ".nojekyll"), "", "utf8");

console.log(`GitHub Pages bundle prepared in: ${outDir}`);
