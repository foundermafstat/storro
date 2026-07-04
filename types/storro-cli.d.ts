declare module "@/bin/storro.mjs" {
  export function collectSnapshot(options: {
    note: string;
    fullDiff?: boolean;
    execFile?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>;
  }): Promise<Record<string, unknown>>;
  export function detectLocalSecrets(text: string): string[];
  export function readSnapshotConfig(configPath?: string): Promise<{ projects: Record<string, string> }>;
  export function saveProjectMapping(cwd: string, projectId: string, configPath?: string): Promise<{ projects: Record<string, string> }>;
  export function sendSnapshot(options: {
    apiUrl: string;
    token: string;
    projectId: string;
    snapshot: unknown;
    fetchImpl?: any;
  }): Promise<any>;
}
