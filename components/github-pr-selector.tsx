"use client";

import { useState, useTransition } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GitHubPullRequestSelector({ projectId }: { projectId: string }) {
  const [installationId, setInstallationId] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [state, setState] = useState("all");
  const [updatedSince, setUpdatedSince] = useState("");
  const [selectedNumbers, setSelectedNumbers] = useState("");
  const [isPending, startTransition] = useTransition();

  function importSelected() {
    startTransition(async () => {
      await fetch(`/api/projects/${projectId}/integrations/github/pull-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          installationId,
          owner,
          repo,
          pullRequestNumbers: selectedNumbers
            .split(",")
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isInteger(item)),
        }),
      });
    });
  }

  return (
    <section className="grid gap-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <input className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setInstallationId(event.target.value)} placeholder="Installation ID" value={installationId} />
        <input className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setOwner(event.target.value)} placeholder="Owner" value={owner} />
        <input className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setRepo(event.target.value)} placeholder="Repository" value={repo} />
        <input className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setBranch(event.target.value)} placeholder="Branch" value={branch} />
        <select className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setState(event.target.value)} value={state}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <input className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setUpdatedSince(event.target.value)} placeholder="Updated since" value={updatedSince} />
      </div>
      <input className="rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setSelectedNumbers(event.target.value)} placeholder="PR numbers: 12, 15, 21" value={selectedNumbers} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending} type="button" variant="secondary">
          <Search className="size-4" aria-hidden="true" />
          Filter
        </Button>
        <Button disabled={isPending} onClick={importSelected} type="button" variant="primary">
          <Download className="size-4" aria-hidden="true" />
          Import selected
        </Button>
      </div>
    </section>
  );
}
