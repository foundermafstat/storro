import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import type { ScopedContext } from "@/services/scoped-context";
import {
  ensureDefaultOrganizationForUser,
  syncNextAuthUser,
  type NextAuthUserIdentity,
} from "@/services/next-auth-sync-service";

export type NextAuthContextIdentity = NextAuthUserIdentity & {
  orgId?: string | null;
};

export async function resolveLocalAuthContext(
  identity: NextAuthContextIdentity,
  db: DatabaseClient = prisma,
): Promise<ScopedContext> {
  const user = await syncNextAuthUser(identity, db);

  if (identity.orgId) {
    const membership = await db.membership.findUnique({
      where: {
        userId_orgId: {
          userId: user.id,
          orgId: identity.orgId,
        },
      },
      select: {
        role: true,
      },
    });

    if (!membership) {
      throw new Error("Authenticated user does not belong to the requested Storro organization.");
    }

    return {
      orgId: identity.orgId,
      userId: user.id,
      role: membership.role,
    };
  }

  const defaultOrg = await ensureDefaultOrganizationForUser(identity, db);

  return {
    orgId: defaultOrg.orgId,
    userId: user.id,
    role: defaultOrg.role,
  };
}
