import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ignoredDirectories = new Set([".git", "node_modules", ".next", "coverage", "dist", "build"]);
const ignoredFiles = new Set([".env", "package-lock.json"]);

const secretPatterns = [
  ["OpenAI API key", /sk-[A-Za-z0-9_-]{20,}/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{30,}/g],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["Credentialed database URL", /(postgres|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@/g],
  ["JWT", /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
];

const findings = [];

function scanDirectory(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;

    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      scanDirectory(path);
      continue;
    }

    if (!stats.isFile() || ignoredFiles.has(entry) || stats.size > 2_000_000) continue;

    const content = readFileSync(path, "utf8");

    for (const [name, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern);
      if (matches?.length) {
        findings.push(`${path}: ${name} (${matches.length})`);
      }
    }
  }
}

scanDirectory(process.cwd());

if (findings.length > 0) {
  console.error("Secret scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Secret scan passed.");
