import { Badge } from "@/components/ui/badge";
import type { TemplateCatalogItem, SubscriptionPlan } from "@/services/template-service";

export function TemplateGallery({
  items,
  plan,
}: {
  items: TemplateCatalogItem[];
  plan: SubscriptionPlan;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4" key={item.template.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.available ? "success" : "warning"}>{item.available ? "Available" : "Upgrade"}</Badge>
            <Badge variant="accent">{item.template.format}</Badge>
          </div>
          <h2 className="mt-3 text-lg font-semibold">{item.template.name}</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{item.template.description}</p>
          <dl className="mt-4 grid gap-2 text-sm">
            <div>
              <dt className="text-[color:var(--muted)]">Audience</dt>
              <dd>{item.template.audience}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--muted)]">Tone</dt>
              <dd>{item.template.tone}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--muted)]">Sections</dt>
              <dd>{item.template.requiredSections.join(", ")}</dd>
            </div>
          </dl>
          {!item.available ? (
            <p className="mt-4 text-xs text-[color:var(--muted)]">
              Current plan: {plan}. Required plan: {item.requiredPlan}.
            </p>
          ) : null}
        </article>
      ))}
    </section>
  );
}
