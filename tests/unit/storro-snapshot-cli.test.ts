import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectSnapshot,
  detectLocalSecrets,
  saveProjectMapping,
  readSnapshotConfig,
  sendSnapshot,
} from "@/bin/storro.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("storro snapshot cli", () => {
  it("collects git snapshot output and sends it to Storro", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => ({
      stdout: outputs[args.join(" ")] ?? "",
      stderr: "",
    }));
    const snapshot = await collectSnapshot({
      note: "Implemented local snapshot.",
      execFile,
    });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 201,
      async json() {
        return { data: { source: { id: "source-1" } }, init };
      },
    }));
    const result = await sendSnapshot({
      apiUrl: "https://storro.local",
      token: "token-1",
      projectId: "project-1",
      snapshot,
      fetchImpl,
    });

    expect(snapshot).toMatchObject({
      note: "Implemented local snapshot.",
      status: " M file.ts",
      diffStat: "1 file changed",
      branchInfo: "main",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://storro.local/api/ingest/local-snapshot");
    expect(result.data.source.id).toBe("source-1");
  });

  it("refuses full diff when local secret scan finds sensitive values", async () => {
    const execFile = vi.fn(async (_cmd: string, args: string[]) => ({
      stdout: args.join(" ") === "diff" ? `const key = "sk-${"a".repeat(24)}"` : "",
      stderr: "",
    }));

    await expect(collectSnapshot({ note: "Check secrets.", fullDiff: true, execFile })).rejects.toThrow(
      "Full diff blocked by local secret scan",
    );
    expect(detectLocalSecrets(`token=${"a".repeat(16)}`)).toContain("secret_assignment");
  });

  it("persists project mapping in local config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "storro-cli-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");

    await saveProjectMapping("/repo", "project-123", configPath);

    const config = await readSnapshotConfig(configPath);
    const rawConfig = await readFile(configPath, "utf8");

    expect(config.projects["/repo"]).toBe("project-123");
    expect(rawConfig).toContain("project-123");
  });
});

const outputs: Record<string, string> = {
  "status --short": " M file.ts\n",
  "diff --stat": "1 file changed\n",
  "diff --staged": "staged diff\n",
  "log --oneline -n 10": "abc123 commit\n",
  "branch --show-current": "main\n",
  "diff -- package.json package-lock.json pnpm-lock.yaml yarn.lock": "package diff\n",
};
