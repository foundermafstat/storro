#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCallback);

export async function collectSnapshot(options) {
  if (!options.note?.trim()) {
    throw new Error("A user note is required.");
  }

  const execFile = options.execFile ?? execFileDefault;
  const [status, diffStat, stagedDiff, recentCommits, branchInfo, packageChanges] = await Promise.all([
    runGit(execFile, ["status", "--short"]),
    runGit(execFile, ["diff", "--stat"]),
    runGit(execFile, ["diff", "--staged"]),
    runGit(execFile, ["log", "--oneline", "-n", "10"]),
    runGit(execFile, ["branch", "--show-current"]),
    runGit(execFile, ["diff", "--", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]),
  ]);
  const snapshot = {
    note: options.note,
    status,
    diffStat,
    stagedDiff,
    recentCommits,
    branchInfo,
    packageChanges,
    privacy: {
      includeFullDiff: !!options.fullDiff,
    },
  };

  if (options.fullDiff) {
    const fullDiff = await runGit(execFile, ["diff"]);
    const findings = detectLocalSecrets(fullDiff);

    if (findings.length > 0) {
      throw new Error(`Full diff blocked by local secret scan: ${findings.join(", ")}`);
    }

    snapshot.fullDiff = fullDiff;
  }

  return snapshot;
}

export function detectLocalSecrets(text) {
  const findings = [];

  if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(text)) {
    findings.push("openai_key");
  }

  if (/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/.test(text)) {
    findings.push("github_token");
  }

  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    findings.push("private_key");
  }

  if (/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[^"'\s]{12,}/i.test(text)) {
    findings.push("secret_assignment");
  }

  return findings;
}

export async function readSnapshotConfig(configPath = defaultConfigPath()) {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return { projects: {} };
  }
}

export async function saveProjectMapping(cwd, projectId, configPath = defaultConfigPath()) {
  const config = await readSnapshotConfig(configPath);
  const nextConfig = {
    ...config,
    projects: {
      ...(config.projects ?? {}),
      [cwd]: projectId,
    },
  };

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return nextConfig;
}

export async function resolveProjectId(cwd, projectId, configPath = defaultConfigPath()) {
  if (projectId) {
    return projectId;
  }

  const config = await readSnapshotConfig(configPath);
  return config.projects?.[cwd];
}

export async function sendSnapshot(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiUrl.replace(/\/$/, "")}/api/ingest/local-snapshot`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      projectId: options.projectId,
      snapshot: options.snapshot,
    }),
  });

  if (!response.ok) {
    throw new Error(`Snapshot upload failed: ${response.status}`);
  }

  return response.json();
}

async function runGit(execFile, args) {
  const result = await execFile("git", args);
  return result.stdout.trimEnd();
}

function defaultConfigPath() {
  return join(homedir(), ".storro", "config.json");
}

function parseArgs(argv) {
  const args = { command: argv[0] };

  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === "--full-diff") {
      args.fullDiff = true;
      continue;
    }

    if (item === "--save-project") {
      args.saveProject = true;
      continue;
    }

    if (item.startsWith("--")) {
      args[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command !== "snapshot") {
    throw new Error("Usage: storro snapshot --note <note> --api-url <url> --token <token> [--project <id>] [--full-diff]");
  }

  const cwd = process.cwd();
  const projectId = await resolveProjectId(cwd, args.project, args.config);

  if (!projectId) {
    throw new Error("Project id is required. Pass --project or save a project mapping.");
  }

  if (args.saveProject) {
    await saveProjectMapping(cwd, projectId, args.config);
  }

  const snapshot = await collectSnapshot({
    note: args.note,
    fullDiff: args.fullDiff,
  });
  const result = await sendSnapshot({
    apiUrl: args["api-url"] ?? process.env.STORRO_API_URL,
    token: args.token ?? process.env.STORRO_API_TOKEN,
    projectId,
    snapshot,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
