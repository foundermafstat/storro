import { Activity, BookOpenText, GitPullRequest, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const workflowSteps = [
  "Source ingestion",
  "Redaction",
  "Structured extraction",
  "Human review",
  "Story generation",
  "Grounding review",
];

const productionPillars = [
  {
    title: "Explicit integrations",
    description: "GitHub App, ChatGPT App/MCP, Codex evidence, CLI snapshots, and verified webhooks.",
    icon: GitPullRequest,
  },
  {
    title: "Safety before AI",
    description: "Source filtering, secret redaction, scoped authorization, and traceable fact references.",
    icon: ShieldCheck,
  },
  {
    title: "Durable memory",
    description: "Organizations, projects, source documents, extraction facts, artifacts, revisions, and audit logs.",
    icon: BookOpenText,
  },
];

export function AppShell() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-[color:var(--foreground)] text-sm font-semibold text-white">
              Sr
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Storro</p>
              <p className="mt-1 text-xs text-[color:var(--muted)]">Developer memory platform</p>
            </div>
          </div>
          <nav aria-label="Primary navigation" className="hidden items-center gap-6 text-sm text-[color:var(--muted)] md:flex">
            <a href="#workflow">Workflow</a>
            <a href="#platform">Platform</a>
            <a href="#readiness">Readiness</a>
          </nav>
          <Button>Open workspace</Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
        <div className="max-w-3xl">
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-normal md:text-6xl">
            Production memory for AI-assisted builders.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[color:var(--muted)]">
            Storro turns explicit development context from ChatGPT, Codex, GitHub, and local snapshots into reviewed,
            source-grounded publishing artifacts.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button>Start production setup</Button>
            <Button variant="secondary">Review architecture</Button>
          </div>
        </div>

        <div
          id="workflow"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4" aria-hidden="true" />
            Production pipeline
          </div>
          <ol className="mt-5 grid gap-3">
            {workflowSteps.map((step, index) => (
              <li
                className="flex items-center gap-3 rounded-md border border-[color:var(--border)] px-3 py-3 text-sm"
                key={step}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[color:var(--background)] text-xs font-semibold">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="platform" className="border-t border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto grid max-w-7xl gap-4 px-6 py-10 md:grid-cols-3">
          {productionPillars.map((pillar) => (
            <article className="rounded-lg border border-[color:var(--border)] p-5" key={pillar.title}>
              <pillar.icon className="size-5" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-semibold">{pillar.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{pillar.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="readiness" className="mx-auto max-w-7xl px-6 py-10">
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
          <h2 className="text-2xl font-semibold">Production-first foundation</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--muted)]">
            This shell is intentionally wired before feature work so every later stage can land inside stable module
            boundaries with strict TypeScript, linting, and targeted verification.
          </p>
        </div>
      </section>
    </main>
  );
}
