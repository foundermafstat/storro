import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorMessages } from "@/lib/api-contract";
import { normalizeApiError } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createGitHubAppEnv } from "@/server/env";
import {
  GitHubRestAppClient,
  handleGitHubInstallationCallback,
} from "@/services/github-app-service";

const querySchema = z.object({
  installation_id: z.string().regex(/^\d+$/),
  setup_action: z.string().optional(),
  state: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const url = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!query.success) {
    return NextResponse.json({
      ok: false,
      requestId,
      error: {
        code: "VALIDATION_FAILED",
        message: apiErrorMessages.VALIDATION_FAILED,
        details: query.error.flatten(),
      },
    }, { status: 400, headers: { "x-request-id": requestId } });
  }

  try {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createGitHubAppEnv();

    await handleGitHubInstallationCallback(
      context,
      {
        installationId: query.data.installation_id,
        setupAction: query.data.setup_action,
        state: query.data.state,
      },
      new GitHubRestAppClient(env),
    );

    const redirectPath = query.data.state
      ? `/dashboard/projects/${query.data.state}/integrations/github/pull-requests`
      : "/settings/integrations";

    const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || url.origin;

    return NextResponse.redirect(new URL(redirectPath, publicOrigin));
  } catch (error) {
    const normalized = normalizeApiError(error);

    return NextResponse.json({
      ok: false,
      requestId,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      },
    }, { status: normalized.statusCode, headers: { "x-request-id": requestId } });
  }
}
