"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ApiResponse<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: { message: string } };

type RepositoryOption = {
  id: number;
  name: string;
  fullName: string;
  private?: boolean;
  htmlUrl?: string;
  connected?: boolean;
};

type InstallationOption = {
  installationId: string;
  accountLogin: string;
  repositories: RepositoryOption[];
};

type PullRequestSummary = {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  baseRef: string;
  headRef: string;
  htmlUrl: string;
  updatedAt?: string;
};

async function readJson<TData>(response: Response) {
  const payload = (await response.json()) as ApiResponse<TData>;

  if (!payload.ok) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export function GitHubPullRequestSelector({ projectId }: { projectId: string }) {
  const [installations, setInstallations] = useState<InstallationOption[]>([]);
  const [selectedRepositoryKey, setSelectedRepositoryKey] = useState("");
  const [branch, setBranch] = useState("");
  const [state, setState] = useState("all");
  const [updatedSince, setUpdatedSince] = useState("");
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<Set<number>>(new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const repositoryOptions = useMemo(
    () => installations.flatMap((installation) => installation.repositories.map((repository) => ({
      installation,
      repository,
      key: `${installation.installationId}:${repository.fullName}`,
    }))),
    [installations],
  );
  const selectedOption = repositoryOptions.find((option) => option.key === selectedRepositoryKey) ?? repositoryOptions[0];

  const loadRepositories = useCallback(async () => {
    setPendingAction("load-repositories");
    setStatus("Loading GitHub repositories...");

    try {
      const data = await readJson<{ installations: InstallationOption[] }>(
        await fetch(`/api/projects/${projectId}/integrations/github/repositories`),
      );

      setInstallations(data.installations);
      setSelectedRepositoryKey((current) => current || firstRepositoryKey(data.installations));
      setStatus(data.installations.length ? "GitHub repositories loaded." : "Connect the GitHub App to import repository data.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "GitHub repository load failed.");
    } finally {
      setPendingAction(null);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRepositories();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadRepositories]);

  async function openGitHubInstall() {
    setPendingAction("install-github");
    setStatus("Preparing GitHub install...");

    try {
      const data = await readJson<{ installUrl: string }>(
        await fetch(`/api/integrations/github/install-url?state=${encodeURIComponent(projectId)}`),
      );

      window.location.assign(data.installUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "GitHub install failed.");
      setPendingAction(null);
    }
  }

  async function connectSelectedRepository() {
    if (!selectedOption) {
      return false;
    }

    setPendingAction("connect-repository");
    setStatus("Connecting repository to project...");

    try {
      await readJson<{ connections: unknown[] }>(
        await fetch(`/api/projects/${projectId}/integrations/github/repositories`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            installationId: selectedOption.installation.installationId,
            repositories: [stripConnectionState(selectedOption.repository)],
          }),
        }),
      );

      setInstallations((current) => current.map((installation) => ({
        ...installation,
        repositories: installation.repositories.map((repository) => (
          installation.installationId === selectedOption.installation.installationId
            && repository.fullName === selectedOption.repository.fullName
            ? { ...repository, connected: true }
            : repository
        )),
      })));
      setStatus("Repository connected.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Repository connection failed.");
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function listPullRequests() {
    if (!selectedOption) {
      return;
    }

    const connected = selectedOption.repository.connected || await connectSelectedRepository();

    if (!connected) {
      return;
    }

    setPendingAction("list-pull-requests");
    setStatus("Loading pull requests...");

    try {
      const { owner, repo } = splitRepository(selectedOption.repository.fullName);
      const query = new URLSearchParams({
        installationId: selectedOption.installation.installationId,
        owner,
        repo,
        state,
      });

      if (branch.trim()) {
        query.set("branch", branch.trim());
      }

      if (updatedSince.trim()) {
        query.set("updatedSince", updatedSince.trim());
      }

      const data = await readJson<{ pullRequests: PullRequestSummary[] }>(
        await fetch(`/api/projects/${projectId}/integrations/github/pull-requests?${query.toString()}`),
      );

      setPullRequests(data.pullRequests);
      setSelectedNumbers(new Set());
      setStatus(`${data.pullRequests.length} pull requests loaded.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pull request load failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function importSelected() {
    if (!selectedOption || selectedNumbers.size === 0) {
      return;
    }

    setPendingAction("import-pull-requests");
    setStatus("Importing selected pull requests...");

    try {
      const { owner, repo } = splitRepository(selectedOption.repository.fullName);
      const data = await readJson<{ imported: unknown[] }>(
        await fetch(`/api/projects/${projectId}/integrations/github/pull-requests`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            installationId: selectedOption.installation.installationId,
            owner,
            repo,
            pullRequestNumbers: Array.from(selectedNumbers),
          }),
        }),
      );

      setStatus(`Imported ${data.imported.length} pull request sources.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pull request import failed.");
    } finally {
      setPendingAction(null);
    }
  }

  function togglePullRequest(number: number, checked: boolean) {
    setSelectedNumbers((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(number);
      } else {
        next.delete(number);
      }

      return next;
    });
  }

  return (
    <section className="grid gap-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold">GitHub App connection</h2>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Import pull requests from repositories available to the installed GitHub App.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pendingAction === "load-repositories"} onClick={loadRepositories} type="button" variant="secondary">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button disabled={pendingAction === "install-github"} onClick={openGitHubInstall} type="button" variant="secondary">
            <ExternalLink className="size-4" aria-hidden="true" />
            Install GitHub App
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px_180px]">
        <select
          className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
          disabled={repositoryOptions.length === 0}
          onChange={(event) => {
            setSelectedRepositoryKey(event.target.value);
            setPullRequests([]);
            setSelectedNumbers(new Set());
          }}
          value={selectedOption?.key ?? ""}
        >
          {installations.map((installation) => (
            <optgroup key={installation.installationId} label={installation.accountLogin}>
              {installation.repositories.map((repository) => (
                <option key={`${installation.installationId}:${repository.fullName}`} value={`${installation.installationId}:${repository.fullName}`}>
                  {repository.fullName}{repository.connected ? " connected" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
          onChange={(event) => setBranch(event.target.value)}
          placeholder="Base branch"
          value={branch}
        />
        <select className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setState(event.target.value)} value={state}>
          <option value="all">All PRs</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <input
          className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
          onChange={(event) => setUpdatedSince(event.target.value)}
          placeholder="Updated since"
          value={updatedSince}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!selectedOption || pendingAction !== null} onClick={listPullRequests} type="button" variant="primary">
          <Search className="size-4" aria-hidden="true" />
          Load PRs
        </Button>
        <Button disabled={selectedNumbers.size === 0 || pendingAction !== null} onClick={importSelected} type="button" variant="secondary">
          <Download className="size-4" aria-hidden="true" />
          Import selected
        </Button>
        {selectedOption?.repository.connected ? <Badge variant="success">Connected</Badge> : null}
        {status ? <span className="text-sm text-[color:var(--muted)]">{status}</span> : null}
      </div>

      {pullRequests.length ? (
        <div className="grid gap-2">
          {pullRequests.map((pullRequest) => (
            <label className="flex items-start gap-3 rounded-md border border-[color:var(--border)] p-3" key={pullRequest.number}>
              <input
                checked={selectedNumbers.has(pullRequest.number)}
                className="mt-1 size-4"
                onChange={(event) => togglePullRequest(pullRequest.number, event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={pullRequest.state === "open" ? "success" : "neutral"}>#{pullRequest.number}</Badge>
                  {pullRequest.merged ? <Badge variant="accent">Merged</Badge> : null}
                  <span className="truncate text-sm font-medium">{pullRequest.title}</span>
                </span>
                <span className="mt-1 block text-xs text-[color:var(--muted)]">
                  {pullRequest.headRef} to {pullRequest.baseRef} · {formatDate(pullRequest.updatedAt)}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function firstRepositoryKey(installations: InstallationOption[]) {
  const installation = installations.find((item) => item.repositories.length > 0);
  const repository = installation?.repositories[0];

  return installation && repository ? `${installation.installationId}:${repository.fullName}` : "";
}

function stripConnectionState(repository: RepositoryOption) {
  return {
    id: repository.id,
    name: repository.name,
    fullName: repository.fullName,
    private: repository.private,
    htmlUrl: repository.htmlUrl,
  };
}

function splitRepository(fullName: string) {
  const [owner, ...repoParts] = fullName.split("/");

  return {
    owner,
    repo: repoParts.join("/"),
  };
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : "unknown";
}
