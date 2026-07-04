import { GitHubPullRequestSelector } from "@/components/github-pr-selector";

export default async function GitHubPullRequestsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold">GitHub pull requests</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">Select PRs by repository, branch, date, and status.</p>
      <div className="mt-8">
        <GitHubPullRequestSelector projectId={projectId} />
      </div>
    </main>
  );
}
