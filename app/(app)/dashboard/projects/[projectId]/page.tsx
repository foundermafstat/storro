import { prisma } from "@/db/client";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectWorkflowPanel } from "@/components/project-workflow-panel";
import { getCurrentAuthContext } from "@/server/auth-context";
import { listExtractionFacts } from "@/services/extraction-review-service";
import {
  extractProjectSettings,
  getProjectById,
  getProjectDashboardSummary,
} from "@/services/project-service";
import { listStoryPlans } from "@/services/story-planning-service";
import { listTemplateCatalog } from "@/services/template-service";
import Link from "next/link";

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

  const [summary, settings, sources, facts, storyRuns, catalog, extractionRuns, artifacts, generationJobs] = await Promise.all([
    getProjectDashboardSummary(context, project.id),
    Promise.resolve(extractProjectSettings(project.metadata)),
    prisma.sourceDocument.findMany({
      where: {
        orgId: context.orgId,
        projectId: project.id,
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 25,
      include: {
        normalizedSources: {
          select: {
            id: true,
            _count: {
              select: {
                chunks: true,
              },
            },
          },
        },
        redactionReports: {
          orderBy: {
            createdAt: "desc",
          },
          select: {
            blocked: true,
          },
          take: 1,
        },
      },
    }),
    listExtractionFacts(context, { projectId: project.id }),
    listStoryPlans(context, { projectId: project.id }),
    listTemplateCatalog(context, { projectId: project.id }),
    prisma.extractionRun.findMany({
      where: {
        orgId: context.orgId,
        projectId: project.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),
    prisma.storyArtifact.findMany({
      where: {
        orgId: context.orgId,
        projectId: project.id,
        archivedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),
    prisma.job.findMany({
      where: {
        orgId: context.orgId,
        projectId: project.id,
        type: "STORY_GENERATION",
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    }),
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="font-semibold">Recent jobs</h2>
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
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

      <ProjectWorkflowPanel
        approvedFactCount={facts.filter((fact) => fact.reviewStatus === "APPROVED").length}
        artifacts={artifacts.map((artifact) => ({
          id: artifact.id,
          title: artifact.title,
          format: artifact.format,
          status: artifact.status,
          groundingState: artifact.groundingState,
          createdAt: artifact.createdAt.toISOString(),
        }))}
        extractionRuns={extractionRuns.map((run) => ({
          id: run.id,
          status: run.status,
          selectedSourceIds: run.selectedSourceIds,
          createdAt: run.createdAt.toISOString(),
          errorMessage: run.errorMessage,
        }))}
        factCounts={{
          pending: facts.filter((fact) => fact.reviewStatus === "PENDING").length,
          approved: facts.filter((fact) => fact.reviewStatus === "APPROVED").length,
          rejected: facts.filter((fact) => fact.reviewStatus === "REJECTED").length,
          privateFacts: facts.filter((fact) => fact.isPrivate).length,
        }}
        generationJobs={generationJobs.map((job) => ({
          id: job.id,
          status: job.status,
          createdAt: job.createdAt.toISOString(),
          error: job.error,
        }))}
        projectId={project.id}
        sources={sources.map((source) => ({
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          status: source.status,
          isPrivate: source.isPrivate,
          parsedAt: source.parsedAt?.toISOString() ?? null,
          normalizedCount: source.normalizedSources.length,
          chunkCount: source.normalizedSources.reduce((total, normalizedSource) => total + normalizedSource._count.chunks, 0),
          redactionBlocked: source.redactionReports[0]?.blocked ?? null,
        }))}
        storyRuns={storyRuns.map((run) => ({
          id: run.id,
          status: run.status,
          templateId: run.templateId,
          format: run.format,
          hasPlan: Boolean(run.storyPlan),
          createdAt: run.createdAt.toISOString(),
          errorMessage: run.errorMessage,
        }))}
        templates={catalog.templates.map((item) => ({
          id: item.template.id,
          name: item.template.name,
          format: item.template.format,
          available: item.available,
        }))}
      />
    </main>
  );
}
