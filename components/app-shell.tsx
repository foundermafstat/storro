import {
  Activity,
  AlertTriangle,
  Bell,
  Cable,
  CheckCircle2,
  CircleDot,
  Command,
  CreditCard,
  FilePenLine,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const primaryNavigation = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Projects", icon: FolderKanban },
  { label: "Editor", icon: FilePenLine },
  { label: "Integrations", icon: Cable },
  { label: "Billing", icon: CreditCard },
  { label: "Settings", icon: Settings },
];

const projects = [
  { name: "Core API", status: "Live", tone: "success" as const },
  { name: "Docs pipeline", status: "Review", tone: "warning" as const },
  { name: "Customer launch", status: "Draft", tone: "neutral" as const },
];

const jobs = [
  { name: "GitHub source sync", status: "Running", icon: Loader2, tone: "accent" as const },
  { name: "Secret redaction pass", status: "Done", icon: CheckCircle2, tone: "success" as const },
  { name: "Artifact grounding", status: "Queued", icon: CircleDot, tone: "neutral" as const },
];

const commandActions = [
  { label: "New project", icon: Plus },
  { label: "Import source", icon: UploadCloud },
  { label: "Run extraction", icon: Play },
  { label: "Publish", icon: Send },
];

const integrationHealth = [
  { label: "NextAuth", value: "Ready", tone: "success" as const },
  { label: "GitHub App", value: "Needs key", tone: "warning" as const },
  { label: "OpenAI", value: "Ready", tone: "success" as const },
  { label: "Stripe", value: "Sandbox", tone: "accent" as const },
];

export function AppShell() {
  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[color:var(--surface)] focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        href="#workspace"
      >
        Skip to workspace
      </a>
      <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-[color:var(--border)] bg-[color:var(--surface)] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-6 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[color:var(--foreground)] text-sm font-semibold text-white">
                  Sr
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Storro</p>
                  <p className="truncate text-xs text-[color:var(--muted)]">Production workspace</p>
                </div>
              </div>
              <Button aria-label="Open command menu" size="icon" variant="ghost">
                <Command className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <nav aria-label="Workspace navigation" className="grid gap-1">
              {primaryNavigation.map((item) => (
                <a
                  className={
                    item.active
                      ? "flex min-h-10 items-center gap-3 rounded-md bg-[color:var(--surface-alt)] px-3 text-sm font-medium"
                      : "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-[color:var(--muted)] hover:bg-[color:var(--surface-alt)] hover:text-[color:var(--foreground)]"
                  }
                  href="#workspace"
                  key={item.label}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </a>
              ))}
            </nav>

            <section aria-labelledby="project-navigation-title" className="grid gap-3">
              <div className="flex items-center justify-between">
                <h2 id="project-navigation-title" className="text-xs font-semibold uppercase text-[color:var(--muted)]">
                  Projects
                </h2>
                <Button aria-label="Create project" size="icon" variant="ghost">
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <div className="grid gap-2">
                {projects.map((project) => (
                  <a
                    className="grid gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 hover:bg-[color:var(--surface-alt)]"
                    href="#workspace"
                    key={project.name}
                  >
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <Badge variant={project.tone}>{project.status}</Badge>
                  </a>
                ))}
              </div>
            </section>

            <div className="mt-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-[color:var(--success)]" aria-hidden="true" />
                Compliance gate
              </div>
              <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">9 checks passing</p>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--background)]/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3">
                  <Search className="size-4 shrink-0 text-[color:var(--muted)]" aria-hidden="true" />
                  <span className="truncate text-sm text-[color:var(--muted)]">Search projects, sources, artifacts</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {commandActions.map((action) => (
                  <Button key={action.label} size="sm" variant={action.label === "New project" ? "primary" : "secondary"}>
                    <action.icon className="size-4" aria-hidden="true" />
                    {action.label}
                  </Button>
                ))}
                <Button aria-label="Notifications" size="icon" variant="ghost">
                  <Bell className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </header>

          <div id="workspace" className="grid scroll-mt-32 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="grid min-w-0 gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard label="Sources processed" value="1,284" change="+18%" />
                <MetricCard label="Reviewed artifacts" value="312" change="+27%" />
                <MetricCard label="Open jobs" value="7" change="3 running" />
              </div>

              <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--muted)]">
                      <FilePenLine className="size-4" aria-hidden="true" />
                      Editor
                    </div>
                    <h1 className="mt-2 text-2xl font-semibold tracking-normal">Core API release narrative</h1>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="success">Grounded</Badge>
                    <Badge variant="accent">Draft v4</Badge>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <article className="min-w-0 rounded-md border border-[color:var(--border)] p-4">
                    <p className="text-sm leading-6 text-[color:var(--muted)]">
                      Release notes are assembled from reviewed commits, source documents, extraction facts, and audit
                      trails.
                    </p>
                    <div className="mt-5 grid gap-3">
                      <EditorLine width="w-11/12" />
                      <EditorLine width="w-full" />
                      <EditorLine width="w-9/12" />
                      <EditorLine width="w-10/12" />
                    </div>
                  </article>
                  <aside className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-4">
                    <h2 className="text-sm font-semibold">Review gates</h2>
                    <div className="mt-4 grid gap-3">
                      <Gate label="Sources attached" state="Passed" />
                      <Gate label="Secrets redacted" state="Passed" />
                      <Gate label="Human approval" state="Waiting" />
                    </div>
                  </aside>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <StatePanel
                  action="Create artifact"
                  description="Waiting for first approved export."
                  icon={FilePenLine}
                  title="No published artifacts"
                />
                <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      GitHub sync failed
                    </div>
                    <Button size="sm" variant="secondary">
                      <RefreshCw className="size-4" aria-hidden="true" />
                      Retry
                    </Button>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-red-800">Webhook signature verification blocked the import.</p>
                </section>
              </section>
            </section>

            <aside className="grid content-start gap-4">
              <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Job status</h2>
                  <Activity className="size-4 text-[color:var(--muted)]" aria-hidden="true" />
                </div>
                <div className="mt-4 grid gap-3">
                  {jobs.map((job) => (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] p-3" key={job.name}>
                      <div className="flex min-w-0 items-center gap-3">
                        <job.icon
                          className={job.status === "Running" ? "size-4 shrink-0 animate-spin" : "size-4 shrink-0"}
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm">{job.name}</span>
                      </div>
                      <Badge variant={job.tone}>{job.status}</Badge>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Integrations</h2>
                  <Cable className="size-4 text-[color:var(--muted)]" aria-hidden="true" />
                </div>
                <div className="mt-4 grid gap-3">
                  {integrationHealth.map((item) => (
                    <div className="flex items-center justify-between gap-3" key={item.label}>
                      <span className="text-sm text-[color:var(--muted)]">{item.label}</span>
                      <Badge variant={item.tone}>{item.value}</Badge>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Usage & billing</h2>
                  <Button aria-label="Open billing menu" size="icon" variant="ghost">
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-[color:var(--muted)]">Extraction credits</span>
                    <span className="font-medium">68%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--surface-alt)]">
                    <div className="h-full w-[68%] rounded-full bg-[color:var(--accent)]" />
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ change, label, value }: { change: string; label: string; value: string }) {
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
      <p className="text-sm text-[color:var(--muted)]">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold">{value}</p>
        <Badge variant="accent">{change}</Badge>
      </div>
    </section>
  );
}

function EditorLine({ width }: { width: string }) {
  return <div className={`h-3 rounded-full bg-[color:var(--surface-alt)] ${width}`} />;
}

function Gate({ label, state }: { label: string; state: "Passed" | "Waiting" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate text-sm text-[color:var(--muted)]">{label}</span>
      <Badge variant={state === "Passed" ? "success" : "warning"}>{state}</Badge>
    </div>
  );
}

function StatePanel({
  action,
  description,
  icon: Icon,
  title,
}: {
  action: string;
  description: string;
  icon: typeof FilePenLine;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex size-10 items-center justify-center rounded-md bg-[color:var(--surface-alt)]">
        <Icon className="size-5 text-[color:var(--muted)]" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{description}</p>
      <Button className="mt-4" size="sm" variant="secondary">
        <Plus className="size-4" aria-hidden="true" />
        {action}
      </Button>
    </section>
  );
}
