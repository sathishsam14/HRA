// prisma/seed.js
// Seeds ExceptionKeyword table and RuleVersion.
// The Coefficient table starts empty; it is populated exclusively via COEFFICIENT uploads.

import { PrismaClient } from "@prisma/client";
import { STARTER, VETERINARY, INCIDENT, CONSTANT } from "../lib/rating-engine/keywords.js";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting HRA database seed...");

  // 1. Load Exception Keywords from lib/rating-engine/keywords.js
  console.log("Loading ExceptionKeyword table...");
  const keywordSets = [
    { type: "STARTER", list: STARTER },
    { type: "VETERINARY", list: VETERINARY },
    { type: "INCIDENT", list: INCIDENT },
    { type: "CONSTANT", list: CONSTANT },
  ];

  let keywordCount = 0;
  for (const set of keywordSets) {
    for (const text of set.list) {
      await prisma.exceptionKeyword.upsert({
        where: {
          type_text: {
            type: set.type,
            text,
          },
        },
        update: { active: true },
        create: {
          type: set.type,
          text,
          active: true,
        },
      });
      keywordCount++;
    }
  }
  console.log(`  ✓ Loaded ${keywordCount} exception keywords across 4 categories.`);

  // 2. Seed RuleVersion
  await prisma.ruleVersion.upsert({
    where: { id: 1 },
    update: { name: "BRD v1.0 (17 Oct 2026)", active: true },
    create: { id: 1, name: "BRD v1.0 (17 Oct 2026)", active: true },
  });
  console.log("  ✓ Seeded default RuleVersion (BRD v1.0).");

  console.log("✅ Seed completed successfully! (Coefficient table left empty for dynamic client upload).");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
