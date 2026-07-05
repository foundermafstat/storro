"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type ProjectCreateResponse =
  | { ok: true; data: { project: { id: string } } }
  | { ok: false; error: { message: string } };

export function ProjectCreateForm() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function createProject(formData: FormData) {
    setIsSubmitting(true);
    setStatus("Creating project...");

    const tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: formData.get("name"),
          description: formData.get("description") || null,
          tags,
          settings: {
            visibility: formData.get("visibility"),
            sourcePrivacyDefault: formData.get("sourcePrivacyDefault") === "on",
            aiReviewRequired: formData.get("aiReviewRequired") === "on",
          },
        }),
      });
      const payload = (await response.json()) as ProjectCreateResponse;

      if (!payload.ok) {
        setStatus(payload.error.message);
        return;
      }

      setStatus("Project created");
      router.push(`/dashboard/projects/${payload.data.project.id}`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form action={createProject} className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="project-name">
          Name
        </label>
        <input
          className="h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
          id="project-name"
          name="name"
          required
          type="text"
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="project-description">
          Description
        </label>
        <textarea
          className="min-h-24 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm"
          id="project-description"
          name="description"
        />
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="project-tags">
            Tags
          </label>
          <input
            className="h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
            id="project-tags"
            name="tags"
            placeholder="launch, api, docs"
            type="text"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="project-visibility">
            Visibility
          </label>
          <select
            className="h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
            defaultValue="PRIVATE"
            id="project-visibility"
            name="visibility"
          >
            <option value="PRIVATE">Private</option>
            <option value="ORGANIZATION">Organization</option>
            <option value="PUBLIC">Public</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input className="size-4" defaultChecked name="sourcePrivacyDefault" type="checkbox" />
          Private sources by default
        </label>
        <label className="flex items-center gap-2">
          <input className="size-4" defaultChecked name="aiReviewRequired" type="checkbox" />
          Require AI review
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={isSubmitting} type="submit">
          <Plus className="size-4" aria-hidden="true" />
          Create project
        </Button>
        {status ? <span className="text-sm text-[color:var(--muted)]">{status}</span> : null}
      </div>
    </form>
  );
}
