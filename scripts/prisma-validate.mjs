import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const schemaPath = "prisma/schema.prisma";

if (!existsSync(schemaPath)) {
  console.log("Prisma schema not present yet; validation will run after Stage 05 adds prisma/schema.prisma.");
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "validate", "--schema", schemaPath], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
