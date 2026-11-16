// prisma/seed-users.js
// Seeds the 3 required RBAC users (admin, handicapper, viewer)
// Passwords MUST be read from .env (SEED_ADMIN_PASSWORD, SEED_HANDICAPPER_PASSWORD, SEED_VIEWER_PASSWORD).
// Never hard-code passwords in code.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting user seed from environment variables...");

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const handicapperPassword = process.env.SEED_HANDICAPPER_PASSWORD;
  const viewerPassword = process.env.SEED_VIEWER_PASSWORD;

  if (!adminPassword || !handicapperPassword || !viewerPassword) {
    throw new Error(
      "Missing required seed passwords in .env. Please set SEED_ADMIN_PASSWORD, SEED_HANDICAPPER_PASSWORD, and SEED_VIEWER_PASSWORD."
    );
  }

  const usersToSeed = [
    {
      email: "admin@btc.com",
      name: "System Admin",
      role: "ADMIN",
      password: adminPassword,
    },
    {
      email: "handicapper@btc.com",
      name: "Senior Handicapper",
      role: "HANDICAPPER",
      password: handicapperPassword,
    },
    {
      email: "viewer@btc.com",
      name: "Official Viewer",
      role: "VIEWER",
      password: viewerPassword,
    },
  ];

  for (const u of usersToSeed) {
    const passwordHash = await bcrypt.hash(u.password, 10);

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        passwordHash,
        active: true,
        failedLogins: 0,
        lockedUntil: null,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        active: true,
        failedLogins: 0,
      },
    });

    console.log(`  ✓ User ready: ${user.email} (Role: ${user.role})`);
  }

  console.log("✅ Users seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed users failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
