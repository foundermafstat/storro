import { notFound } from "next/navigation";
import { TemplateGallery } from "@/components/template-gallery";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getProjectById } from "@/services/project-service";
import { listTemplateCatalog } from "@/services/template-service";

export default async function ProjectTemplatesPage({
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

  const catalog = await listTemplateCatalog(context, {
    projectId: project.id,
  });

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Templates</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Available output formats for {project.name} on the {catalog.plan} plan.
        </p>
      </div>
      <div className="mt-8">
        <TemplateGallery items={catalog.templates} plan={catalog.plan} />
      </div>
    </main>
  );
}
