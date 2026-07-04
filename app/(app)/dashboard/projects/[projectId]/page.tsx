import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  extractProjectSettings,
  getProjectById,
  getProjectDashboardSummary,
} from "@/services/project-service";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getCurrentAuthContext();
  const project = await getProjectById(context, projectId);

  if (!project) {
    notFound();
  }

  const [summary, settings] = await Promise.all([
    getProjectDashboardSummary(context, project.id),
    Promise.resolve(extractProjectSettings(project.metadata)),
  ]);

  const cards = [
    { label: "Sources", value: summary.cards.sources },
    { label: "Extractions", value: summary.cards.extractions },
    { label: "Artifacts", value: summary.cards.artifacts },
    { label: "Integrations", value: summary.cards.integrations },
    { label: "Recent jobs", value: summary.cards.recentJobs },
    { label: "Usage", value: summary.cards.usage },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={project.status === "ACTIVE" ? "success" : "neutral"}>{project.status}</Badge>
            <Badge variant="accent">{settings.visibility}</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
            {project.description ?? "Project workspace"}
          </p>
        </div>
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <p className="font-medium">Project settings</p>
          <p className="mt-2 text-[color:var(--muted)]">
            AI review {settings.aiReviewRequired ? "required" : "optional"} · Sources{" "}
            {settings.sourcePrivacyDefault ? "private by default" : "shared by default"}
          </p>
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4" key={card.label}>
            <p className="text-sm text-[color:var(--muted)]">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="border-b border-[color:var(--border)] p-4">
          <h2 className="font-semibold">Recent jobs</h2>
        </div>
        {summary.recentJobs.length === 0 ? (
          <p className="p-4 text-sm text-[color:var(--muted)]">No jobs yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {summary.recentJobs.map((job) => (
              <li className="flex items-center justify-between gap-3 p-4" key={job.id}>
                <span className="text-sm">{job.type}</span>
                <Badge variant={job.status === "FAILED" ? "danger" : "neutral"}>{job.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
