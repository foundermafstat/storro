-- Rename the local auth identity field without dropping existing users.
ALTER TABLE "User" RENAME COLUMN "clerkUserId" TO "authUserId";
ALTER INDEX "User_clerkUserId_key" RENAME TO "User_authUserId_key";

-- Storro owns organizations internally when using NextAuth/Auth.js.
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "clerkOrgId";

-- Replace Clerk integration enum value with NextAuth/Auth.js.
ALTER TYPE "IntegrationProvider" RENAME TO "IntegrationProvider_old";
CREATE TYPE "IntegrationProvider" AS ENUM (
  'GITHUB',
  'CHATGPT',
  'CODEX',
  'CLI',
  'MCP',
  'NEXT_AUTH',
  'STRIPE',
  'OPENAI',
  'OBJECT_STORAGE'
);
ALTER TABLE "SourceConnection"
  ALTER COLUMN "provider" TYPE "IntegrationProvider"
  USING ("provider"::text::"IntegrationProvider");
ALTER TABLE "IntegrationAccount"
  ALTER COLUMN "provider" TYPE "IntegrationProvider"
  USING ("provider"::text::"IntegrationProvider");
DROP TYPE "IntegrationProvider_old";

-- NextAuth/Auth.js does not require a provider webhook enum value.
ALTER TYPE "WebhookProvider" RENAME TO "WebhookProvider_old";
CREATE TYPE "WebhookProvider" AS ENUM ('GITHUB', 'STRIPE');
ALTER TABLE "WebhookDelivery"
  ALTER COLUMN "provider" TYPE "WebhookProvider"
  USING ("provider"::text::"WebhookProvider");
DROP TYPE "WebhookProvider_old";
