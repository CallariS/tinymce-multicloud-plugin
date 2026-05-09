/**
 * Generates CHANGELOG.md from git commit history using conventional-changelog.
 * Commits must follow Conventional Commits format (feat:, fix:, docs:, etc.).
 *
 * Usage:
 *   npm run changelog          # append unreleased commits
 *   npm run changelog -- --all # regenerate entire changelog from scratch
 */
import conventionalChangelog from "conventional-changelog";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const changelogPath = join(root, "CHANGELOG.md");
const all = process.argv.includes("--all");

let existing = "";
if (!all) {
    try {
        existing = readFileSync(changelogPath, "utf8");
    } catch {
        // file doesn't exist yet — start fresh
    }
}

const chunks = [];
const stream = conventionalChangelog(
    { preset: "angular", releaseCount: all ? 0 : 1 },
    undefined,
    undefined,
    undefined,
    { headerPartial: "" },
);

stream.on("data", (chunk) => chunks.push(chunk.toString()));
stream.on("end", () => {
    const generated = chunks.join("").trim();
    if (!generated) {
        console.log("No conventional commits found — changelog unchanged.");
        return;
    }
    const output = all
        ? `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).\nVersions follow [Semantic Versioning](https://semver.org/).\n\n---\n\n${generated}\n`
        : `${generated}\n\n${existing}`;
    writeFileSync(changelogPath, output, "utf8");
    console.log(`CHANGELOG.md updated.`);
});
stream.on("error", (err) => {
    console.error("Changelog generation failed:", err.message);
    process.exit(1);
});
