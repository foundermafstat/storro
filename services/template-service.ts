import type { ArtifactFormat, Prisma, TemplatePrivateFactPolicy } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type SubscriptionPlan = "free" | "pro" | "team" | "enterprise";

export type TemplateDefinition = {
  id: string;
  name: string;
  description: string;
  source: "built_in" | "organization";
  format: ArtifactFormat;
  audience: string;
  tone: string;
  requiredSections: string[];
  lengthLimits: {
    minWords?: number;
    maxWords?: number;
    maxCharacters?: number;
    maxItems?: number;
  };
  privateFactPolicy: TemplatePrivateFactPolicy;
  groundingRules: {
    requireApprovedFacts: boolean;
    requireFactIds: boolean;
    requireClaimsToAvoid: boolean;
    allowUngroundedClaims: boolean;
  };
  minimumPlan: SubscriptionPlan;
};

export type TemplateCatalogItem = {
  template: TemplateDefinition;
  available: boolean;
  requiredPlan: SubscriptionPlan;
};

const planRank: Record<SubscriptionPlan, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

const lengthLimitsSchema = z.object({
  minWords: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
  maxCharacters: z.number().int().positive().optional(),
  maxItems: z.number().int().positive().optional(),
});

const groundingRulesSchema = z.object({
  requireApprovedFacts: z.boolean(),
  requireFactIds: z.boolean(),
  requireClaimsToAvoid: z.boolean(),
  allowUngroundedClaims: z.boolean(),
});

const createTemplateSchema = z.object({
  templateId: z.string().min(2).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(2),
  description: z.string().optional(),
  format: z.enum([
    "LONG_ARTICLE",
    "DORAHACKS_UPDATE",
    "GITHUB_RELEASE_NOTES",
    "LINKEDIN_POST",
    "X_THREAD",
    "DAILY_BUILD_JOURNAL",
    "INVESTOR_UPDATE",
    "INTERNAL_CHANGELOG",
    "CUSTOM",
  ]),
  audience: z.string().min(2),
  tone: z.string().min(2),
  requiredSections: z.array(z.string().min(1)).min(1),
  lengthLimits: lengthLimitsSchema,
  privateFactPolicy: z.enum(["PUBLIC_ONLY", "INTERNAL_ALLOWED", "PRIVATE_ALLOWED"]),
  groundingRules: groundingRulesSchema,
  minimumPlan: z.enum(["free", "pro", "team", "enterprise"]).default("team"),
});

export type CreateOrganizationTemplateInput = z.infer<typeof createTemplateSchema>;

export const builtInTemplates: TemplateDefinition[] = [
  {
    id: "long-article",
    name: "Long article",
    description: "Structured long-form article for public technical storytelling.",
    source: "built_in",
    format: "LONG_ARTICLE",
    audience: "External technical readers and potential users",
    tone: "Clear, concrete, evidence-led",
    requiredSections: ["Hook", "Problem", "Build evidence", "Architecture", "Tradeoffs", "Next steps"],
    lengthLimits: { minWords: 1200, maxWords: 2400 },
    privateFactPolicy: "PUBLIC_ONLY",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "pro",
  },
  {
    id: "dorahacks-progress",
    name: "DoraHacks update",
    description: "Concise public progress update for builder communities.",
    source: "built_in",
    format: "DORAHACKS_UPDATE",
    audience: "DoraHacks voters, builders, and grant reviewers",
    tone: "Direct, technical, milestone-oriented",
    requiredSections: ["What shipped", "Evidence", "What is next"],
    lengthLimits: { minWords: 250, maxWords: 700 },
    privateFactPolicy: "PUBLIC_ONLY",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "free",
  },
  {
    id: "github-release-notes",
    name: "GitHub release notes",
    description: "Release notes grounded in commits, pull requests, and reviewed source facts.",
    source: "built_in",
    format: "GITHUB_RELEASE_NOTES",
    audience: "Developers and maintainers",
    tone: "Precise, changelog-friendly",
    requiredSections: ["Added", "Changed", "Fixed", "Migration notes"],
    lengthLimits: { minWords: 150, maxWords: 900 },
    privateFactPolicy: "PUBLIC_ONLY",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "free",
  },
  {
    id: "linkedin-post",
    name: "LinkedIn post",
    description: "Public launch or progress post with business-readable technical proof.",
    source: "built_in",
    format: "LINKEDIN_POST",
    audience: "Professional network, partners, and early customers",
    tone: "Confident, specific, non-hype",
    requiredSections: ["Opening", "Progress proof", "Why it matters", "Call to action"],
    lengthLimits: { minWords: 120, maxWords: 350 },
    privateFactPolicy: "PUBLIC_ONLY",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "pro",
  },
  {
    id: "x-thread",
    name: "Twitter/X thread",
    description: "Thread-sized sequence of grounded progress notes.",
    source: "built_in",
    format: "X_THREAD",
    audience: "Public social audience and builder peers",
    tone: "Compact, technical, punchy",
    requiredSections: ["Lead post", "Evidence posts", "Next step post"],
    lengthLimits: { maxCharacters: 280, maxItems: 8 },
    privateFactPolicy: "PUBLIC_ONLY",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "pro",
  },
  {
    id: "daily-build-journal",
    name: "Daily build journal",
    description: "Internal or public daily log assembled from reviewed build evidence.",
    source: "built_in",
    format: "DAILY_BUILD_JOURNAL",
    audience: "Founder, team, and project stakeholders",
    tone: "Operational, chronological, specific",
    requiredSections: ["Today", "Files touched", "Decisions", "Risks", "Tomorrow"],
    lengthLimits: { minWords: 200, maxWords: 900 },
    privateFactPolicy: "INTERNAL_ALLOWED",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "free",
  },
  {
    id: "investor-update",
    name: "Investor update",
    description: "Commercial update with traction, product progress, risks, and asks.",
    source: "built_in",
    format: "INVESTOR_UPDATE",
    audience: "Investors, advisors, and strategic partners",
    tone: "Executive, factual, accountable",
    requiredSections: ["Summary", "Product progress", "Metrics", "Risks", "Ask"],
    lengthLimits: { minWords: 500, maxWords: 1200 },
    privateFactPolicy: "PRIVATE_ALLOWED",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "team",
  },
  {
    id: "internal-changelog",
    name: "Internal changelog",
    description: "Private team changelog with implementation details and risks.",
    source: "built_in",
    format: "INTERNAL_CHANGELOG",
    audience: "Internal product and engineering team",
    tone: "Dense, operational, unambiguous",
    requiredSections: ["Shipped", "Changed", "Risk", "Follow-up"],
    lengthLimits: { minWords: 200, maxWords: 1200 },
    privateFactPolicy: "PRIVATE_ALLOWED",
    groundingRules: defaultGroundingRules(),
    minimumPlan: "free",
  },
];

export async function listTemplateCatalog(
  context: ScopedContext,
  input: {
    projectId?: string;
    plan?: string;
  } = {},
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);

  if (input.projectId) {
    await assertProjectPermission(context, input.projectId, "artifact.read", db);
  }

  const plan = normalizePlan(input.plan ?? (await resolveOrganizationPlan(context, db)));
  const templates = [...builtInTemplates, ...(await listOrganizationTemplates(context, db))];

  return {
    plan,
    templates: templates.map((template): TemplateCatalogItem => ({
      template,
      available: isTemplateAvailable(template, plan),
      requiredPlan: template.minimumPlan,
    })),
  };
}

export async function listAvailableTemplates(
  context: ScopedContext,
  input: {
    projectId?: string;
    plan?: string;
  } = {},
  db: DatabaseClient = prisma,
) {
  const catalog = await listTemplateCatalog(context, input, db);

  return catalog.templates.filter((item) => item.available).map((item) => item.template);
}

export async function getTemplateDefinition(
  context: ScopedContext,
  input: {
    templateId: string;
    projectId?: string;
    plan?: string;
  },
  db: DatabaseClient = prisma,
) {
  const templates = await listAvailableTemplates(context, input, db);
  const template = templates.find((item) => item.id === input.templateId);

  if (!template) {
    throw new ValidationServiceError("Unsupported or unavailable template id.", {
      templateId: input.templateId,
    });
  }

  return template;
}

export async function createOrganizationTemplate(
  context: ScopedContext,
  input: CreateOrganizationTemplateInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  const parsed = createTemplateSchema.parse(input);

  const created = await db.organizationTemplate.create({
    data: {
      orgId: context.orgId,
      createdById: context.userId,
      templateId: parsed.templateId,
      name: parsed.name,
      description: parsed.description,
      format: parsed.format,
      audience: parsed.audience,
      tone: parsed.tone,
      requiredSections: parsed.requiredSections,
      lengthLimits: parsed.lengthLimits as Prisma.InputJsonObject,
      privateFactPolicy: parsed.privateFactPolicy,
      groundingRules: parsed.groundingRules as Prisma.InputJsonObject,
      minimumPlan: parsed.minimumPlan,
    },
  });

  return mapOrganizationTemplate(created);
}

async function listOrganizationTemplates(context: ScopedContext, db: DatabaseClient) {
  const templates = await db.organizationTemplate.findMany({
    where: {
      orgId: context.orgId,
      archivedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return templates.map(mapOrganizationTemplate);
}

async function resolveOrganizationPlan(context: ScopedContext, db: DatabaseClient) {
  const billing = await db.billingAccount.findUnique({
    where: {
      orgId: context.orgId,
    },
    select: {
      plan: true,
    },
  });

  return billing?.plan ?? "free";
}

function mapOrganizationTemplate(template: {
  templateId: string;
  name: string;
  description: string | null;
  format: ArtifactFormat;
  audience: string;
  tone: string;
  requiredSections: string[];
  lengthLimits: Prisma.JsonValue;
  privateFactPolicy: TemplatePrivateFactPolicy;
  groundingRules: Prisma.JsonValue;
  minimumPlan: string;
}): TemplateDefinition {
  return {
    id: template.templateId,
    name: template.name,
    description: template.description ?? "Organization template",
    source: "organization",
    format: template.format,
    audience: template.audience,
    tone: template.tone,
    requiredSections: template.requiredSections,
    lengthLimits: lengthLimitsSchema.parse(template.lengthLimits),
    privateFactPolicy: template.privateFactPolicy,
    groundingRules: groundingRulesSchema.parse(template.groundingRules),
    minimumPlan: normalizePlan(template.minimumPlan),
  };
}

function defaultGroundingRules(): TemplateDefinition["groundingRules"] {
  return {
    requireApprovedFacts: true,
    requireFactIds: true,
    requireClaimsToAvoid: true,
    allowUngroundedClaims: false,
  };
}

function normalizePlan(plan: string): SubscriptionPlan {
  return plan === "enterprise" || plan === "team" || plan === "pro" ? plan : "free";
}

function isTemplateAvailable(template: TemplateDefinition, plan: SubscriptionPlan) {
  return planRank[plan] >= planRank[template.minimumPlan];
}
