import Link from "next/link";
import { ArrowRight, Settings } from "lucide-react";
import { ProjectCreateForm } from "@/components/project-create-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentAuthContext } from "@/server/auth-context";
import { listProjects } from "@/services/project-service";

export default async function DashboardPage() {
  const context = await getCurrentAuthContext();
  const projects = await listProjects(context);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Organization-scoped project memory for the selected Storro workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/settings/integrations">
              <Settings className="size-4" aria-hidden="true" />
              Integrations
            </Link>
          </Button>
        </div>
      </div>

      <section className="mt-8 grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
          <h2 className="text-lg font-semibold">New project</h2>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Create a real workspace, then import evidence and generate artifacts from the project pipeline.
          </p>
          <div className="mt-5">
            <ProjectCreateForm />
          </div>
        </div>

        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
          <div className="border-b border-[color:var(--border)] p-5">
            <h2 className="text-lg font-semibold">Projects</h2>
          </div>
        {projects.length === 0 ? (
          <p className="p-6 text-sm text-[color:var(--muted)]">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {projects.map((project) => (
              <li className="p-5" key={project.id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="truncate font-medium hover:text-[color:var(--accent)] focus-visible:rounded-sm"
                        href={`/dashboard/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                      <Badge variant={project.status === "ACTIVE" ? "success" : "neutral"}>{project.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">{project.description}</p>
                    {project.tags.length > 0 ? (
                      <p className="mt-2 text-xs uppercase text-[color:var(--muted)]">{project.tags.join(" / ")}</p>
                    ) : null}
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/dashboard/projects/${project.id}`}>
                      Open pipeline
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>
    </main>
  );
}
