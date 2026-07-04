import { getCurrentAuthContext } from "@/server/auth-context";
import { listProjects } from "@/services/project-service";

export default async function DashboardPage() {
  const context = await getCurrentAuthContext();
  const projects = await listProjects(context);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        Organization-scoped project memory for the active Clerk organization.
      </p>
      <section className="mt-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
        {projects.length === 0 ? (
          <p className="p-6 text-sm text-[color:var(--muted)]">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {projects.map((project) => (
              <li className="p-5" key={project.id}>
                <h2 className="font-medium">{project.name}</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{project.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
