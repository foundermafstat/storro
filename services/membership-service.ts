import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";

const roleRank: Record<MembershipRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export async function getMembershipRole(
  params: {
    orgId: string;
    userId: string;
  },
  db: DatabaseClient = prisma,
) {
  const membership = await db.membership.findUnique({
    where: {
      userId_orgId: {
        userId: params.userId,
        orgId: params.orgId,
      },
    },
    select: {
      role: true,
    },
  });

  return membership?.role ?? null;
}

export async function assertMembership(
  params: {
    orgId: string;
    userId: string;
    minimumRole?: MembershipRole;
  },
  db: DatabaseClient = prisma,
) {
  const role = await getMembershipRole(params, db);

  if (!role) {
    throw new Error("User does not belong to this organization.");
  }

  if (params.minimumRole && roleRank[role] < roleRank[params.minimumRole]) {
    throw new Error("User does not have permission for this action.");
  }

  return role;
}
