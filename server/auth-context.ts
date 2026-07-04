import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import type { ScopedContext } from "@/services/scoped-context";

export type ClerkAuthIdentity = {
  clerkUserId: string;
  clerkOrgId?: string | null;
};

export async function resolveLocalAuthContext(
  identity: ClerkAuthIdentity,
  db: DatabaseClient = prisma,
): Promise<ScopedContext> {
  const user = await db.user.findUnique({
    where: {
      clerkUserId: identity.clerkUserId,
    },
    select: {
      id: true,
      memberships: {
        where: identity.clerkOrgId
          ? {
              organization: {
                clerkOrgId: identity.clerkOrgId,
              },
            }
          : undefined,
        select: {
          role: true,
          organization: {
            select: {
              id: true,
            },
          },
        },
        take: 1,
      },
    },
  });

  const membership = user?.memberships[0];

  if (!user || !membership) {
    throw new Error("Authenticated Clerk user is not synced to a local Storro organization.");
  }

  return {
    orgId: membership.organization.id,
    userId: user.id,
    role: membership.role,
  };
}

export async function getCurrentAuthContext() {
  const session = await auth();

  if (!session.userId) {
    throw new Error("Authentication is required.");
  }

  return resolveLocalAuthContext({
    clerkUserId: session.userId,
    clerkOrgId: session.orgId,
  });
}
