import { createHmac } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  type BillingProvider,
  createBillingCheckout,
  getQuotaUsage,
  handleStripeWebhook,
} from "@/services/billing-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const webhookSecret = `whsec_${suffix}`;

let orgId = "";
let userId = "";
let context: ScopedContext;

const fakeProvider: BillingProvider = {
  async createCheckoutSession() {
    return {
      id: `cs_${suffix}`,
      url: "https://checkout.stripe.com/c/session",
      customerId: `cus_${suffix}`,
      subscriptionId: `sub_${suffix}`,
    };
  },
  async createPortalSession() {
    return {
      id: `bps_${suffix}`,
      url: "https://billing.stripe.com/session",
    };
  },
};

describe("billing service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `billing-user-${suffix}`, email: `billing-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `Billing Org ${suffix}`, slug: `billing-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates checkout subscription state and a local billing record", async () => {
    const result = await createBillingCheckout(
      context,
      {
        plan: "pro",
        priceId: "price_pro_test",
        successUrl: "https://storro.local/success",
        cancelUrl: "https://storro.local/cancel",
      },
      fakeProvider,
    );

    expect(result.checkoutSession.url).toContain("checkout.stripe.com");
    expect(result.billingAccount).toMatchObject({
      orgId,
      plan: "pro",
      status: "ACTIVE",
      stripeCustomerId: `cus_${suffix}`,
      stripeSubscriptionId: `sub_${suffix}`,
    });
  });

  it("updates subscription status idempotently from signed Stripe webhook fixtures", async () => {
    const event = {
      id: `evt_${suffix}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: `sub_${suffix}`,
          customer: `cus_${suffix}`,
          status: "past_due",
          current_period_end: 1_783_108_800,
          metadata: {
            orgId,
            plan: "team",
          },
        },
      },
    };
    const rawBody = JSON.stringify(event);
    const signature = signStripeFixture(rawBody);

    const first = await handleStripeWebhook(rawBody, signature, webhookSecret);
    const second = await handleStripeWebhook(rawBody, signature, webhookSecret);
    const deliveries = await prisma.webhookDelivery.count({
      where: {
        provider: "STRIPE",
        deliveryId: event.id,
      },
    });
    const billing = await prisma.billingAccount.findUniqueOrThrow({ where: { orgId } });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(deliveries).toBe(1);
    expect(billing).toMatchObject({
      plan: "team",
      status: "PAST_DUE",
      stripeSubscriptionId: `sub_${suffix}`,
    });
  });

  it("blocks quota-limited project creation server-side", async () => {
    await prisma.billingAccount.update({
      where: {
        orgId,
      },
      data: {
        plan: "free",
        status: "ACTIVE",
        metadata: {
          quotaOverrides: {
            projects: 1,
          },
        },
      },
    });

    await createProject(context, { name: `Allowed Project ${suffix}` });
    await expect(createProject(context, { name: `Blocked Project ${suffix}` })).rejects.toThrow("Billing quota exceeded.");
    const usage = await getQuotaUsage(context);

    expect(usage.usage.projects).toBe(1);
    expect(usage.entitlements.projects).toBe(1);
  });
});

function signStripeFixture(rawBody: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");

  return `t=${timestamp},v1=${signature}`;
}
