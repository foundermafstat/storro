import { readFile } from "fs/promises";

const pages = [
  "app/(app)/dashboard/page.tsx",
  "app/(app)/admin/page.tsx",
  "app/(app)/settings/integrations/page.tsx",
  "app/legal/privacy/page.tsx",
  "app/legal/terms/page.tsx",
];
const violations = [];

for (const page of pages) {
  try {
    const body = await readFile(page, "utf8");
    if (!/<main[\s>]/.test(body)) {
      violations.push({ page, rule: "page-main-landmark", severity: "critical" });
    }
    if (!/<h1[\s>]/.test(body)) {
      violations.push({ page, rule: "page-h1", severity: "critical" });
    }
  } catch {
    violations.push({ page, rule: "page-exists", severity: "critical" });
  }
}

console.log(JSON.stringify({ passed: violations.length === 0, checkedPages: pages, violations }, null, 2));
process.exit(violations.length === 0 ? 0 : 1);
