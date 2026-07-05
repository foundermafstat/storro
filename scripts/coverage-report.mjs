import { readdir, readFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const criticalServices = [
  "authorization-service",
  "billing-service",
  "security-service",
  "github-webhook-service",
  "ai-gateway",
  "extraction-pipeline-service",
  "grounding-review-service",
  "artifact-generation-service",
  "artifact-export-service",
  "notification-service",
  "observability-service",
];

const testFiles = await collectFiles(path.join(root, "tests"));
const testBodies = await Promise.all(testFiles.map((file) => readFile(file, "utf8")));
const coverage = criticalServices.map((service) => {
  const matchingTests = testFiles.filter((file, index) => testBodies[index].includes(`/services/${service}`) || testBodies[index].includes(`@/services/${service}`));

  return {
    service,
    tested: matchingTests.length > 0,
    tests: matchingTests.map((file) => path.relative(root, file)),
  };
});
const untested = coverage.filter((entry) => !entry.tested);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  criticalServices: coverage,
  untestedCriticalServices: untested,
}, null, 2));

if (untested.length > 0) {
  process.exitCode = 1;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute));
    } else if (/\.(test|spec)\.tsx?$/.test(entry.name)) {
      files.push(absolute);
    }
  }

  return files;
}
