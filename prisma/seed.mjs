import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed Storro.");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: { authUserId: "seed_user_storro" },
    update: {},
    create: {
      authUserId: "seed_user_storro",
      email: "founder@storro.local",
      name: "Storro Founder",
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "storro-seed" },
    update: {},
    create: {
      name: "Storro Seed Organization",
      slug: "storro-seed",
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_orgId: {
        userId: user.id,
        orgId: organization.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      userId: user.id,
      orgId: organization.id,
      role: "OWNER",
    },
  });

  const project = await prisma.project.upsert({
    where: {
      orgId_slug: {
        orgId: organization.id,
        slug: "production-build",
      },
    },
    update: {},
    create: {
      orgId: organization.id,
      ownerId: user.id,
      name: "Production Build",
      slug: "production-build",
      description: "Seed project for validating the production data model.",
      tags: ["seed", "production"],
    },
  });

  await prisma.sourceDocument.create({
    data: {
      orgId: organization.id,
      projectId: project.id,
      createdById: user.id,
      sourceType: "MANUAL_NOTE",
      status: "CREATED",
      title: "Seed build note",
      rawText: "Storro seed source for validating project memory creation.",
      isPrivate: false,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
