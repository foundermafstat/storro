import { createHmac, timingSafeEqual } from "crypto";
import type { BillingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertBillingManagement, assertOrgPermission } from "@/services/authorization-service";
import { IntegrationFailureError, NotFoundError, RateLimitError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type BillingPlan = "free" | "pro" | "team" | "enterprise";
export type QuotaResource = "projects" | "sources" | "aiRuns" | "exports" | "storageBytes" | "seats";

type PlanEntitlements = Record<QuotaResource, number>;

export type BillingProviderCheckoutInput = {
  orgId: string;
  plan: BillingPlan;
  priceId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type BillingProviderCheckoutSession = {
  id: string;
  url: string;
  customerId?: string;
  subscriptionId?: string;
};

export type BillingProviderPortalSession = {
  id: string;
  url: string;
};

export type BillingProvider = {
  createCheckoutSession(input: BillingProviderCheckoutInput): Promise<BillingProviderCheckoutSession>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<BillingProviderPortalSession>;
};

export const planEntitlements: Record<BillingPlan, PlanEntitlements> = {
  free: {
    projects: 3,
    sources: 50,
    aiRuns: 20,
    exports: 5,
    storageBytes: 1_000_000_000,
    seats: 1,
  },
  pro: {
    projects: 10,
    sources: 1_000,
    aiRuns: 500,
    exports: 100,
    storageBytes: 20_000_000_000,
    seats: 1,
  },
  team: {
    projects: 50,
    sources: 10_000,
    aiRuns: 5_000,
    exports: 1_000,
    storageBytes: 200_000_000_000,
    seats: 10,
  },
  enterprise: {
    projects: 1_000_000,
    sources: 1_000_000,
    aiRuns: 1_000_000,
    exports: 1_000_000,
    storageBytes: 10_000_000_000_000,
    seats: 1_000_000,
  },
};

export class StripeHttpBillingProvider implements BillingProvider {
  private readonly apiVersion = "2026-02-25.clover";

  constructor(private readonly secretKey: string) {}

  async createCheckoutSession(input: BillingProviderCheckoutInput): Promise<BillingProviderCheckoutSession> {
    const body = new URLSearchParams({
      mode: "subscription",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.orgId,
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][orgId]": input.orgId,
      "subscription_data[metadata][plan]": input.plan,
      "metadata[orgId]": input.orgId,
      "metadata[plan]": input.plan,
    });

    if (input.customerId) {
      body.set("customer", input.customerId);
    } else if (input.customerEmail) {
      body.set("customer_email", input.customerEmail);
    }

    const payload = await this.stripeRequest("https://api.stripe.com/v1/checkout/sessions", body);

    return {
      id: String(payload.id ?? ""),
      url: String(payload.url ?? ""),
      customerId: typeof payload.customer === "string" ? payload.customer : undefined,
      subscriptionId: typeof payload.subscription === "string" ? payload.subscription : undefined,
    };
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<BillingProviderPortalSession> {
    const payload = await this.stripeRequest(
      "https://api.stripe.com/v1/billing_portal/sessions",
      new URLSearchParams({
        customer: input.customerId,
        return_url: input.returnUrl,
      }),
    );

    return {
      id: String(payload.id ?? ""),
      url: String(payload.url ?? ""),
    };
  }

  private async stripeRequest(url: string, body: URLSearchParams) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": this.apiVersion,
      },
      body,
    });

    if (!response.ok) {
      throw new IntegrationFailureError("Stripe Billing request failed.", {
        status: response.status,
        body: await response.text(),
      });
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

export async function createBillingCheckout(
  context: ScopedContext,
  input: {
    plan: Exclude<BillingPlan, "free" | "enterprise">;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  },
  provider: BillingProvider,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertBillingManagement(context, db);

  const user = await db.user.findUnique({
    where: {
      id: context.userId,
    },
  });
  const account = await ensureBillingAccount(context, db);
  const session = await provider.createCheckoutSession({
    orgId: context.orgId,
    plan: input.plan,
    priceId: input.priceId,
    customerId: account.stripeCustomerId,
    customerEmail: user?.email,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
  const updated = await db.billingAccount.update({
    where: {
      orgId: context.orgId,
    },
    data: {
      plan: input.plan,
      status: session.subscriptionId ? "ACTIVE" : "TRIALING",
      stripeCustomerId: session.customerId ?? account.stripeCustomerId,
      stripeSubscriptionId: session.subscriptionId ?? account.stripeSubscriptionId,
      trialEndsAt: account.trialEndsAt ?? addDays(new Date(), 14),
      seatLimit: planEntitlements[input.plan].seats,
      metadata: mergeMetadata(account.metadata, {
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        requestedPlan: input.plan,
      }),
    },
  });

  return {
    billingAccount: updated,
    checkoutSession: session,
  };
}

export async function createBillingPortal(
  context: ScopedContext,
  input: {
    returnUrl: string;
  },
  provider: BillingProvider,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertBillingManagement(context, db);

  const account = await db.billingAccount.findUnique({
    where: {
      orgId: context.orgId,
    },
  });

  if (!account?.stripeCustomerId) {
    throw new NotFoundError("Stripe customer is not connected.");
  }

  return provider.createPortalSession({
    customerId: account.stripeCustomerId,
    returnUrl: input.returnUrl,
  });
}

export async function assertQuota(
  context: ScopedContext,
  input: {
    resource: QuotaResource;
    increment?: number;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  const usage = await getQuotaUsage(context, db);
  const limit = usage.entitlements[input.resource];
  const current = usage.usage[input.resource];
  const increment = input.increment ?? 1;

  if (current + increment > limit) {
    throw new RateLimitError("Billing quota exceeded.", {
      resource: input.resource,
      current,
      increment,
      limit,
      plan: usage.plan,
    });
  }

  return {
    resource: input.resource,
    current,
    increment,
    limit,
    plan: usage.plan,
  };
}

export async function getQuotaUsage(context: ScopedContext, db: DatabaseClient = prisma) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  const account = await ensureBillingAccount(context, db);
  const plan = normalizePlan(account.plan);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [projects, sources, aiRuns, exportsCount, storage, seats] = await Promise.all([
    db.project.count({ where: { orgId: context.orgId, archivedAt: null } }),
    db.sourceDocument.count({ where: { orgId: context.orgId, deletedAt: null } }),
    db.usageEvent.aggregate({
      where: {
        orgId: context.orgId,
        type: { in: ["AI_EXTRACTION", "AI_GENERATION"] },
        createdAt: { gte: monthStart },
      },
      _sum: {
        quantity: true,
      },
    }),
    db.artifactExport.count({
      where: {
        orgId: context.orgId,
        createdAt: { gte: monthStart },
      },
    }),
    db.sourceFile.aggregate({
      where: {
        orgId: context.orgId,
      },
      _sum: {
        sizeBytes: true,
      },
    }),
    db.membership.count({ where: { orgId: context.orgId } }),
  ]);
  const entitlements = applyQuotaOverrides(planEntitlements[plan], account.metadata);

  return {
    plan,
    status: account.status,
    billingAccount: account,
    entitlements: {
      ...entitlements,
      seats: account.seatLimit || entitlements.seats,
    },
    usage: {
      projects,
      sources,
      aiRuns: aiRuns._sum.quantity ?? 0,
      exports: exportsCount,
      storageBytes: Number(storage._sum.sizeBytes ?? 0n),
      seats,
    },
  };
}

export async function handleStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  db: DatabaseClient = prisma,
) {
  const event = verifyStripeWebhook(rawBody, signatureHeader, webhookSecret);
  const existing = await db.webhookDelivery.findUnique({
    where: {
      provider_deliveryId: {
        provider: "STRIPE",
        deliveryId: event.id,
      },
    },
  });

  if (existing?.status === "PROCESSED") {
    return {
      delivery: existing,
      duplicate: true,
    };
  }

  const object = readEventObject(event);
  const billingAccount = await syncBillingAccountFromStripeEvent(event.type, object, db);
  const delivery = existing
    ? await db.webhookDelivery.update({
        where: {
          id: existing.id,
        },
        data: {
          orgId: billingAccount?.orgId,
          status: "PROCESSED",
          signatureValid: true,
          payload: event as Prisma.InputJsonObject,
          processedAt: new Date(),
        },
      })
    : await db.webhookDelivery.create({
        data: {
          orgId: billingAccount?.orgId,
          provider: "STRIPE",
          deliveryId: event.id,
          eventType: event.type,
          status: "PROCESSED",
          signatureValid: true,
          payload: event as Prisma.InputJsonObject,
          processedAt: new Date(),
        },
      });

  return {
    delivery,
    billingAccount,
    duplicate: false,
  };
}

async function ensureBillingAccount(context: ScopedContext, db: DatabaseClient) {
  return db.billingAccount.upsert({
    where: {
      orgId: context.orgId,
    },
    update: {},
    create: {
      orgId: context.orgId,
      status: "TRIALING",
      plan: "free",
      trialEndsAt: addDays(new Date(), 14),
      seatLimit: planEntitlements.free.seats,
      metadata: {
        trialSource: "automatic",
      },
    },
  });
}

async function syncBillingAccountFromStripeEvent(type: string, object: Record<string, unknown>, db: DatabaseClient) {
  if (type === "checkout.session.completed") {
    const metadata = readMetadata(object);
    const orgId = readString(metadata.orgId);
    if (!orgId) {
      return undefined;
    }
    const plan = normalizePlan(readString(metadata.plan));
    const checkoutMetadata = {
      checkoutSessionId: readId(object.id),
      latestCheckoutStatus: String(object.status ?? "unknown"),
    } as Prisma.InputJsonObject;

    return db.billingAccount.upsert({
      where: { orgId },
      update: {
        stripeCustomerId: readId(object.customer),
        stripeSubscriptionId: readId(object.subscription),
        status: "ACTIVE",
        plan,
        metadata: checkoutMetadata,
      },
      create: {
        orgId,
        stripeCustomerId: readId(object.customer),
        stripeSubscriptionId: readId(object.subscription),
        status: "ACTIVE",
        plan,
        seatLimit: planEntitlements[plan].seats,
        metadata: checkoutMetadata,
      },
    });
  }

  if (type.startsWith("customer.subscription.")) {
    const metadata = readMetadata(object);
    const orgId = readString(metadata.orgId);
    const subscriptionId = readId(object.id);
    const customerId = readId(object.customer);
    const existing = await findBillingAccountForStripeObject(db, orgId, customerId, subscriptionId);

    if (!existing) {
      return undefined;
    }

    const plan = normalizePlan(readString(metadata.plan) ?? existing.plan);
    const status = mapStripeSubscriptionStatus(String(object.status ?? "incomplete"));

    return db.billingAccount.update({
      where: {
        id: existing.id,
      },
      data: {
        stripeCustomerId: customerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: subscriptionId ?? existing.stripeSubscriptionId,
        status,
        plan,
        currentPeriodEnd: unixDate(object.current_period_end),
        trialEndsAt: unixDate(object.trial_end) ?? existing.trialEndsAt,
        seatLimit: planEntitlements[plan].seats,
        metadata: mergeMetadata(existing.metadata, {
          latestSubscriptionStatus: object.status,
          latestSubscriptionEvent: type,
        }),
      },
    });
  }

  if (type.startsWith("invoice.")) {
    const customerId = readId(object.customer);
    const subscriptionId = readId(object.subscription);
    const existing = await findBillingAccountForStripeObject(db, undefined, customerId, subscriptionId);

    if (!existing) {
      return undefined;
    }

    return db.billingAccount.update({
      where: {
        id: existing.id,
      },
      data: {
        status: type === "invoice.payment_failed" ? "PAST_DUE" : existing.status,
        metadata: mergeMetadata(existing.metadata, {
          latestInvoiceId: readId(object.id),
          latestInvoiceStatus: object.status,
          latestInvoiceEvent: type,
        }),
      },
    });
  }

  return undefined;
}

async function findBillingAccountForStripeObject(db: DatabaseClient, orgId?: string, customerId?: string, subscriptionId?: string) {
  if (orgId) {
    return db.billingAccount.findUnique({ where: { orgId } });
  }
  if (subscriptionId) {
    return db.billingAccount.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  }
  if (customerId) {
    return db.billingAccount.findUnique({ where: { stripeCustomerId: customerId } });
  }

  return undefined;
}

function verifyStripeWebhook(rawBody: string, signatureHeader: string | null, webhookSecret: string) {
  const timestamp = signatureHeader?.match(/(?:^|,)t=([^,]+)/)?.[1];
  const signature = signatureHeader?.match(/(?:^|,)v1=([^,]+)/)?.[1];

  if (!timestamp || !signature) {
    throw new ValidationServiceError("Missing Stripe webhook signature.");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new ValidationServiceError("Invalid Stripe webhook signature.");
  }

  return JSON.parse(rawBody) as { id: string; type: string; data?: { object?: unknown } };
}

function readEventObject(event: { data?: { object?: unknown } }) {
  return isRecord(event.data?.object) ? event.data.object : {};
}

function normalizePlan(plan: unknown): BillingPlan {
  return plan === "pro" || plan === "team" || plan === "enterprise" ? plan : "free";
}

function mapStripeSubscriptionStatus(status: string): BillingStatus {
  if (status === "active") {
    return "ACTIVE";
  }
  if (status === "trialing") {
    return "TRIALING";
  }
  if (status === "past_due" || status === "unpaid") {
    return "PAST_DUE";
  }
  if (status === "canceled") {
    return "CANCELED";
  }

  return "INCOMPLETE";
}

function applyQuotaOverrides(entitlements: PlanEntitlements, metadata: Prisma.JsonValue): PlanEntitlements {
  if (!isRecord(metadata) || !isRecord(metadata.quotaOverrides)) {
    return entitlements;
  }

  return {
    ...entitlements,
    ...Object.fromEntries(
      Object.entries(metadata.quotaOverrides)
        .filter((entry): entry is [QuotaResource, number] => isQuotaResource(entry[0]) && typeof entry[1] === "number" && entry[1] >= 0),
    ),
  };
}

function mergeMetadata(existing: Prisma.JsonValue, next: Record<string, unknown>) {
  return {
    ...(isRecord(existing) ? existing : {}),
    ...next,
  } as Prisma.InputJsonObject;
}

function readMetadata(object: Record<string, unknown>) {
  return isRecord(object.metadata) ? object.metadata : {};
}

function readId(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function unixDate(value: unknown) {
  return typeof value === "number" ? new Date(value * 1000) : undefined;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isQuotaResource(value: string): value is QuotaResource {
  return value === "projects"
    || value === "sources"
    || value === "aiRuns"
    || value === "exports"
    || value === "storageBytes"
    || value === "seats";
}
