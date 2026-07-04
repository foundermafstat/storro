import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/settings(.*)",
  "/api(.*)",
]);

const isPublicWebhookRoute = createRouteMatcher(["/api/webhooks/clerk(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request) && !isPublicWebhookRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
