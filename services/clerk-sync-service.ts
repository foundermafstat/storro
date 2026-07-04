import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";

type ClerkEmail = {
  id?: string;
  email_address?: string;
};

type ClerkUserPayload = {
  id: string;
  email_addresses?: ClerkEmail[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
};

type ClerkOrganizationPayload = {
  id: string;
  name: string;
  slug?: string | null;
};

type ClerkMembershipPayload = {
  role?: string | null;
  organization?: {
    id?: string;
  } | null;
  organization_id?: string | null;
  public_user_data?: {
    user_id?: string;
  } | null;
  user_id?: string | null;
};

export type ClerkWebhookLike = {
  type: string;
  data: unknown;
};

function primaryEmail(data: ClerkUserPayload) {
  const primary = data.email_addresses?.find((email) => email.id === data.primary_email_address_id);
  return primary?.email_address ?? data.email_addresses?.[0]?.email_address ?? null;
}

function displayName(data: ClerkUserPayload) {
  return [data.first_name, data.last_name].filter(Boolean).join(" ") || null;
}

function slugFromOrganization(data: ClerkOrganizationPayload) {
  return data.slug ?? data.id;
}

function roleFromClerkRole(role?: string | null) {
  if (role === "org:admin") return "ADMIN";
  if (role === "org:member") return "EDITOR";
  return "VIEWER";
}

export async function syncClerkUser(data: ClerkUserPayload, db: DatabaseClient = prisma) {
  return db.user.upsert({
    where: {
      clerkUserId: data.id,
    },
    update: {
      email: primaryEmail(data),
      name: displayName(data),
      imageUrl: data.image_url ?? null,
    },
    create: {
      clerkUserId: data.id,
      email: primaryEmail(data),
      name: displayName(data),
      imageUrl: data.image_url ?? null,
    },
  });
}

export async function syncClerkOrganization(
  data: ClerkOrganizationPayload,
  db: DatabaseClient = prisma,
) {
  return db.organization.upsert({
    where: {
      clerkOrgId: data.id,
    },
    update: {
      name: data.name,
      slug: slugFromOrganization(data),
    },
    create: {
      clerkOrgId: data.id,
      name: data.name,
      slug: slugFromOrganization(data),
    },
  });
}

export async function syncClerkMembership(data: ClerkMembershipPayload, db: DatabaseClient = prisma) {
  const clerkUserId = data.public_user_data?.user_id ?? data.user_id;
  const clerkOrgId = data.organization?.id ?? data.organization_id;

  if (!clerkUserId || !clerkOrgId) {
    throw new Error("Clerk membership webhook is missing user or organization id.");
  }

  const [user, organization] = await Promise.all([
    db.user.findUnique({
      where: {
        clerkUserId,
      },
      select: {
        id: true,
      },
    }),
    db.organization.findUnique({
      where: {
        clerkOrgId,
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!user || !organization) {
    throw new Error("Clerk membership references unsynced user or organization.");
  }

  return db.membership.upsert({
    where: {
      userId_orgId: {
        userId: user.id,
        orgId: organization.id,
      },
    },
    update: {
      role: roleFromClerkRole(data.role),
    },
    create: {
      userId: user.id,
      orgId: organization.id,
      role: roleFromClerkRole(data.role),
    },
  });
}

export async function syncClerkWebhookEvent(event: ClerkWebhookLike, db: DatabaseClient = prisma) {
  if (event.type === "user.created" || event.type === "user.updated") {
    return syncClerkUser(event.data as ClerkUserPayload, db);
  }

  if (event.type === "organization.created" || event.type === "organization.updated") {
    return syncClerkOrganization(event.data as ClerkOrganizationPayload, db);
  }

  if (
    event.type === "organizationMembership.created" ||
    event.type === "organizationMembership.updated"
  ) {
    return syncClerkMembership(event.data as ClerkMembershipPayload, db);
  }

  return null;
}
