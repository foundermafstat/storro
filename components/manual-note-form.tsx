"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const noteKinds = [
  "daily_journal",
  "build_note",
  "research_note",
  "failed_attempt",
  "lesson",
  "public_comment",
  "private_comment",
];

export function ManualNoteForm({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState("");

  async function submitNote(formData: FormData) {
    setStatus("Saving note...");
    const filesTouched = String(formData.get("filesTouched") ?? "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const response = await fetch(`/api/projects/${projectId}/manual-notes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: formData.get("title"),
        kind: formData.get("kind"),
        whatTried: formData.get("whatTried"),
        whatWorked: formData.get("whatWorked"),
        whatFailed: formData.get("whatFailed"),
        filesTouched,
        nextStep: formData.get("nextStep"),
        publicSummary: formData.get("publicSummary"),
        privateNotes: formData.get("privateNotes"),
        isPrivate: formData.get("isPrivate") === "on",
      }),
    });
    const payload = await response.json();
    setStatus(payload.ok ? "Manual note saved" : payload.error.message);
  }

  return (
    <form action={submitNote} className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="manual-note-title">
          Title
        </label>
        <input
          className="h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
          id="manual-note-title"
          name="title"
          required
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="manual-note-kind">
          Type
        </label>
        <select
          className="h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
          defaultValue="daily_journal"
          id="manual-note-kind"
          name="kind"
        >
          {noteKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <Field label="What was tried" name="whatTried" />
      <Field label="What worked" name="whatWorked" />
      <Field label="What failed" name="whatFailed" />
      <Field label="Files touched" name="filesTouched" />
      <Field label="Next step" name="nextStep" />
      <Field label="Public-safe summary" name="publicSummary" />
      <Field label="Private notes" name="privateNotes" />
      <label className="flex items-center gap-2 text-sm">
        <input className="size-4" defaultChecked name="isPrivate" type="checkbox" />
        Private by default
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">Save manual note</Button>
        {status ? <span className="text-sm text-[color:var(--muted)]">{status}</span> : null}
      </div>
    </form>
  );
}

function Field({ label, name }: { label: string; name: string }) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={`manual-note-${name}`}>
        {label}
      </label>
      <textarea
        className="min-h-24 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm"
        id={`manual-note-${name}`}
        name={name}
      />
    </div>
  );
}
