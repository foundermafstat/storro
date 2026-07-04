import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import {
  createOrganizationTemplate,
  getTemplateDefinition,
  listAvailableTemplates,
  listTemplateCatalog,
} from "@/services/template-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("organization template service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `template-user-${suffix}`,
        email: `template-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Template Org ${suffix}`,
        slug: `template-org-${suffix}`,
      },
    });

    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };

    await prisma.membership.create({
      data: {
        orgId,
        userId,
        role: "OWNER",
      },
    });
    await prisma.billingAccount.create({
      data: {
        orgId,
        plan: "free",
        status: "ACTIVE",
      },
    });

    const project = await createProject(context, {
      name: `Template Project ${suffix}`,
    });

    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: orgId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  it("filters templates by subscription plan and fails safely for unsupported IDs", async () => {
    const freeTemplates = await listAvailableTemplates(context, { projectId });

    expect(freeTemplates.map((template) => template.id)).toContain("dorahacks-progress");
    expect(freeTemplates.map((template) => template.id)).not.toContain("investor-update");

    await expect(getTemplateDefinition(context, { projectId, templateId: "missing-template" })).rejects.toThrow(
      "Unsupported or unavailable template id.",
    );
  });

  it("adds organization custom templates and exposes plan-gated UI catalog items", async () => {
    await createOrganizationTemplate(context, {
      templateId: "founder-weekly",
      name: "Founder weekly",
      description: "Custom founder update",
      format: "CUSTOM",
      audience: "Founder and advisors",
      tone: "Operational",
      requiredSections: ["Wins", "Risks", "Asks"],
      lengthLimits: { minWords: 300, maxWords: 800 },
      privateFactPolicy: "PRIVATE_ALLOWED",
      groundingRules: {
        requireApprovedFacts: true,
        requireFactIds: true,
        requireClaimsToAvoid: true,
        allowUngroundedClaims: false,
      },
      minimumPlan: "team",
    });

    const freeCatalog = await listTemplateCatalog(context, { projectId });
    const lockedCustom = freeCatalog.templates.find((item) => item.template.id === "founder-weekly");

    expect(lockedCustom).toMatchObject({
      available: false,
      requiredPlan: "team",
    });

    await prisma.billingAccount.update({
      where: {
        orgId,
      },
      data: {
        plan: "team",
      },
    });

    const teamTemplates = await listAvailableTemplates(context, { projectId });

    expect(teamTemplates.map((template) => template.id)).toContain("founder-weekly");
    expect(teamTemplates.map((template) => template.id)).toContain("investor-update");
  });
});
