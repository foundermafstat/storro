import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";

export type NextAuthUserIdentity = {
  authUserId: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

function slugFromEmailOrId(identity: NextAuthUserIdentity) {
  const base = identity.email?.split("@")[0] ?? identity.authUserId;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function syncNextAuthUser(identity: NextAuthUserIdentity, db: DatabaseClient = prisma) {
  return db.user.upsert({
    where: {
      authUserId: identity.authUserId,
    },
    update: {
      email: identity.email ?? null,
      name: identity.name ?? null,
      imageUrl: identity.image ?? null,
    },
    create: {
      authUserId: identity.authUserId,
      email: identity.email ?? null,
      name: identity.name ?? null,
      imageUrl: identity.image ?? null,
    },
  });
}

export async function ensureDefaultOrganizationForUser(
  identity: NextAuthUserIdentity,
  db: DatabaseClient = prisma,
) {
  const user = await syncNextAuthUser(identity, db);

  const existingMembership = await db.membership.findFirst({
    where: {
      userId: user.id,
    },
    select: {
      orgId: true,
      role: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (existingMembership) {
    return {
      user,
      orgId: existingMembership.orgId,
      role: existingMembership.role,
    };
  }

  const slugBase = slugFromEmailOrId(identity) || "storro-user";
  const organization = await db.organization.create({
    data: {
      name: identity.name ? `${identity.name}'s Workspace` : "Personal Workspace",
      slug: `${slugBase}-${user.id.slice(0, 8)}`,
      memberships: {
        create: {
          userId: user.id,
          role: "OWNER",
        },
      },
    },
  });

  return {
    user,
    orgId: organization.id,
    role: "OWNER" as const,
  };
}
