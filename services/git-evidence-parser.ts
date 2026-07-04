export type GitEvidenceFile = {
  path: string;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  isBinary: boolean;
  isGenerated: boolean;
  isLockFile: boolean;
  isTestFile: boolean;
};

export type GitEvidenceCommit = {
  sha: string;
  message?: string;
  author?: string;
  date?: string;
};

export type GitEvidenceParseResult = {
  files: GitEvidenceFile[];
  commits: GitEvidenceCommit[];
  branches: string[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
    generatedFiles: number;
    lockFiles: number;
    testFiles: number;
    collapsedFiles: Record<string, string[]>;
  };
  warnings: string[];
};

type MutableFile = GitEvidenceFile;

const lockFileNames = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
]);

export function parseGitEvidence(input: string): GitEvidenceParseResult {
  const warnings: string[] = [];
  const filesByPath = new Map<string, MutableFile>();
  const commits = parseCommits(input);
  const branches = parseBranches(input);
  let currentFile: MutableFile | undefined;

  for (const line of input.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      currentFile = upsertFile(filesByPath, diffMatch[2], "modified");
      continue;
    }

    const renameMatch = line.match(/^rename to (.+)$/);
    if (renameMatch && currentFile) {
      filesByPath.delete(currentFile.path);
      currentFile.path = renameMatch[1];
      currentFile.status = "renamed";
      filesByPath.set(currentFile.path, currentFile);
      continue;
    }

    if (/^new file mode /.test(line) && currentFile) {
      currentFile.status = "added";
      continue;
    }

    if (/^deleted file mode /.test(line) && currentFile) {
      currentFile.status = "deleted";
      continue;
    }

    const numstatMatch = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (numstatMatch) {
      const file = upsertFile(filesByPath, normalizeNumstatPath(numstatMatch[3]), "modified");
      file.additions += numstatMatch[1] === "-" ? 0 : Number(numstatMatch[1]);
      file.deletions += numstatMatch[2] === "-" ? 0 : Number(numstatMatch[2]);
      file.isBinary = numstatMatch[1] === "-" || numstatMatch[2] === "-";
      decorateFile(file);
      continue;
    }

    if (/^Binary files /.test(line) && currentFile) {
      currentFile.isBinary = true;
      continue;
    }

    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      currentFile.additions += 1;
      continue;
    }

    if (currentFile && line.startsWith("-") && !line.startsWith("---")) {
      currentFile.deletions += 1;
    }
  }

  const files = Array.from(filesByPath.values()).map((file) => {
    decorateFile(file);
    return file;
  });

  if (files.length === 0 && commits.length === 0) {
    warnings.push("No git diff, git show, or git log evidence was detected.");
  }

  return {
    files,
    commits,
    branches,
    summary: buildSummary(files),
    warnings,
  };
}

export function formatGitEvidenceSummary(result: GitEvidenceParseResult) {
  const lines = [
    `Files changed: ${result.summary.filesChanged}`,
    `Additions: ${result.summary.additions}`,
    `Deletions: ${result.summary.deletions}`,
    `Commits: ${result.commits.length}`,
  ];

  for (const file of result.files.filter((item) => !item.isGenerated && !item.isLockFile)) {
    lines.push(`- ${file.path} (+${file.additions}/-${file.deletions})`);
  }

  if (result.summary.lockFiles > 0) {
    lines.push(`Collapsed lock files: ${result.summary.lockFiles}`);
  }

  if (result.summary.generatedFiles > 0) {
    lines.push(`Collapsed generated files: ${result.summary.generatedFiles}`);
  }

  return lines.join("\n");
}

function parseCommits(input: string) {
  const commits: GitEvidenceCommit[] = [];
  let current: GitEvidenceCommit | undefined;

  for (const line of input.split(/\r?\n/)) {
    const commitMatch = line.match(/^commit\s+([a-f0-9]{7,40})\b/i);
    if (commitMatch) {
      current = { sha: commitMatch[1] };
      commits.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const authorMatch = line.match(/^Author:\s+(.+)$/);
    if (authorMatch) {
      current.author = authorMatch[1].trim();
      continue;
    }

    const dateMatch = line.match(/^Date:\s+(.+)$/);
    if (dateMatch) {
      current.date = dateMatch[1].trim();
      continue;
    }

    const messageMatch = line.match(/^ {4}(.+)$/);
    if (messageMatch && !current.message) {
      current.message = messageMatch[1].trim();
    }
  }

  return commits;
}

function parseBranches(input: string) {
  const branches = new Set<string>();

  for (const line of input.split(/\r?\n/)) {
    const branchMatch = line.match(/^(?:On branch|\*|\s+remotes\/origin\/)\s+(.+)$/);
    if (branchMatch) {
      branches.add(branchMatch[1].trim());
    }
  }

  return Array.from(branches);
}

function upsertFile(filesByPath: Map<string, MutableFile>, path: string, status: MutableFile["status"]) {
  const normalizedPath = stripBraceRename(path);
  const existing = filesByPath.get(normalizedPath);

  if (existing) {
    return existing;
  }

  const file: MutableFile = {
    path: normalizedPath,
    additions: 0,
    deletions: 0,
    status,
    isBinary: false,
    isGenerated: false,
    isLockFile: false,
    isTestFile: false,
  };

  filesByPath.set(normalizedPath, file);
  return file;
}

function decorateFile(file: MutableFile) {
  const normalized = file.path.toLowerCase();
  const fileName = normalized.split("/").pop() ?? normalized;
  file.isLockFile = lockFileNames.has(fileName);
  file.isGenerated =
    normalized.includes("/generated/") ||
    normalized.startsWith("generated/") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("dist/") ||
    normalized.includes("/build/") ||
    normalized.startsWith("build/") ||
    normalized.includes("/.next/") ||
    normalized.startsWith(".next/") ||
    normalized.endsWith(".min.js") ||
    normalized.endsWith(".generated.ts") ||
    normalized.endsWith(".generated.tsx");
  file.isTestFile =
    normalized.includes("__tests__") ||
    normalized.includes("/tests/") ||
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(normalized);
}

function buildSummary(files: GitEvidenceFile[]): GitEvidenceParseResult["summary"] {
  const collapsedFiles: Record<string, string[]> = {
    generated: [],
    lock: [],
    binary: [],
  };

  for (const file of files) {
    if (file.isGenerated) {
      collapsedFiles.generated.push(file.path);
    }
    if (file.isLockFile) {
      collapsedFiles.lock.push(file.path);
    }
    if (file.isBinary) {
      collapsedFiles.binary.push(file.path);
    }
  }

  return {
    filesChanged: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    binaryFiles: collapsedFiles.binary.length,
    generatedFiles: collapsedFiles.generated.length,
    lockFiles: collapsedFiles.lock.length,
    testFiles: files.filter((file) => file.isTestFile).length,
    collapsedFiles,
  };
}

function normalizeNumstatPath(path: string) {
  return stripBraceRename(path.trim());
}

function stripBraceRename(path: string) {
  return path.replace(/\{(.+?) => (.+?)\}/, "$2");
}
