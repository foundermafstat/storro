"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--background)] p-6">
      <section className="w-full max-w-md rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-sm">
        <div className="flex size-10 items-center justify-center rounded-md bg-red-50 text-red-700">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">Workspace unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          The current workspace view could not be loaded.
        </p>
        <Button className="mt-6" onClick={reset}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      </section>
    </main>
  );
}
