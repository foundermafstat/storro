import { auth } from "@/auth";
import { resolveLocalAuthContext } from "@/services/auth-context-service";

export async function getCurrentAuthContext(selectedOrgId?: string | null) {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Authentication is required.");
  }

  return resolveLocalAuthContext({
    authUserId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
    orgId: selectedOrgId,
  });
}
