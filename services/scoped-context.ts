import type { MembershipRole } from "@prisma/client";

export type ScopedContext = {
  orgId: string;
  userId: string;
  role?: MembershipRole;
};

export function requireScopedContext(context: ScopedContext) {
  if (!context.orgId || !context.userId) {
    throw new Error("Scoped orgId and userId are required.");
  }
}
