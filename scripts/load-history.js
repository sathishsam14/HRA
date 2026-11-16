// scripts/load-history.js
// Imports data/BWM-BSM 22-26 Consolidated.xlsx through importFile() as type HISTORY
// into a separate test database (hra_test, using DATABASE_URL_TEST).
// Strictly does not touch the main database.

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Read .env if present
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || "";
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
} catch {
  // Ignore
}

const MAIN_DB_URL = process.env.DATABASE_URL || "postgresql://sathish@localhost:5432/hra";
const TEST_DB_URL =
  process.env.DATABASE_URL_TEST || "postgresql://sathish@localhost:5432/hra_test";

// Strict Safety Guard: Never touch the main database
if (TEST_DB_URL === MAIN_DB_URL) {
  console.error("FATAL ERROR: DATABASE_URL_TEST is identical to DATABASE_URL!");
  console.error("Aborting to prevent modifying production database.");
  process.exit(1);
}

console.log("================================================================================");
console.log("🐎 BTC HRA Historical Ledger Ingestion (scripts/load-history.js)");
console.log("================================================================================");
console.log(`🔒 Target Database URL : ${TEST_DB_URL}`);
console.log(`🛡️  Main DB (Untouched)  : ${MAIN_DB_URL}`);

// Configure environment and singleton Prisma Client instance to target hra_test
process.env.DATABASE_URL = TEST_DB_URL;
const testDb = new PrismaClient({
  datasources: {
    db: { url: TEST_DB_URL },
  },
});
global.prismaClientInstance = testDb;

// Dynamically import importFile after configuring the DB singleton
const { importFile } = await import("../lib/import/index.js");

async function main() {
  const possiblePaths = [
    path.resolve(process.cwd(), "data/BWM-BSM 22-26 Consolidated.xlsx"),
    path.resolve(process.cwd(), "data/BWM-BSM 22-26-Consolidated (1).xlsx"),
  ];

  let filePath = possiblePaths.find((p) => fs.existsSync(p));
  if (!filePath) {
    console.error("Error: Could not locate historical data file in data/ directory.");
    console.error("Searched paths:", possiblePaths);
    process.exit(1);
  }

  const fileName = "BWM-BSM 22-26 Consolidated.xlsx";
  console.log(`\n📂 Reading file: ${filePath}`);
  const startTime = Date.now();
  const buffer = fs.readFileSync(filePath);
  const readDurationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`   File size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB (read in ${readDurationSec}s)`);

  console.log("\n⚙️  Processing historical ingestion via importFile() [type: HISTORY]...");
  const importStartTime = Date.now();
  const result = await importFile({
    fileName,
    buffer,
    fileType: "HISTORY",
    uploadedBy: null,
  });
  const importDurationSec = ((Date.now() - importStartTime) / 1000).toFixed(2);

  console.log(`\n✅ Ingestion finished in ${importDurationSec}s`);
  console.log(`   Status Message: ${result.message}`);

  // Query actual records from the test database
  const [raceCount, horseCount, entryCount, ratingStatusCounts] = await Promise.all([
    testDb.race.count(),
    testDb.horse.count(),
    testDb.raceEntry.count(),
    testDb.rating.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
  ]);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("📊 1. RECORDS SAVED IN TEST DATABASE (hra_test)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`   • Races Saved       : ${raceCount.toLocaleString()}`);
  console.log(`   • Horses Saved      : ${horseCount.toLocaleString()}`);
  console.log(`   • Entries Saved     : ${entryCount.toLocaleString()}`);
  console.log(`   • Saved Rows Count  : ${result.savedRows?.toLocaleString() ?? entryCount.toLocaleString()}`);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("🚫 2. REJECTED ROWS AND REASONS WHY");
  console.log("--------------------------------------------------------------------------------");
  const rejectedCount = result.rejectedRows || (result.errors ? result.errors.length : 0);
  console.log(`   • Total Rows Rejected : ${rejectedCount.toLocaleString()}`);

  // Tally reasons
  const reasonBreakdown = {};
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      const key = `[${err.column || "Field"}] ${err.reason}`;
      reasonBreakdown[key] = (reasonBreakdown[key] || 0) + 1;
    }
  }

  const breakdownEntries = Object.entries(reasonBreakdown);
  if (breakdownEntries.length > 0) {
    for (const [reason, count] of breakdownEntries) {
      console.log(`     - ${reason}: ${count.toLocaleString()} row(s)`);
    }
  } else {
    console.log("     (No rows were rejected)");
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log("🎯 3. RATINGS ENDED AS EACH STATUS");
  console.log("--------------------------------------------------------------------------------");
  const statusMap = {
    RATED: 0,
    UNCHANGED: 0,
    NOT_ELIGIBLE: 0,
    NOT_RATED: 0,
    NEEDS_HANDICAPPER: 0,
  };

  for (const item of ratingStatusCounts) {
    statusMap[item.status] = item._count.status;
  }

  const totalRatings = Object.values(statusMap).reduce((a, b) => a + b, 0);

  console.log(`   • RATED              : ${statusMap.RATED.toLocaleString()}`);
  console.log(`   • UNCHANGED          : ${statusMap.UNCHANGED.toLocaleString()}`);
  console.log(`   • NOT_ELIGIBLE       : ${statusMap.NOT_ELIGIBLE.toLocaleString()}`);
  console.log(`   • NOT_RATED          : ${statusMap.NOT_RATED.toLocaleString()}`);
  console.log(`   • NEEDS_HANDICAPPER  : ${statusMap.NEEDS_HANDICAPPER.toLocaleString()}`);
  console.log(`   ─────────────────────────────────────────────`);
  console.log(`   • Total Ratings      : ${totalRatings.toLocaleString()}`);
  console.log("================================================================================\n");

  await testDb.$disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Fatal error in scripts/load-history.js:", err);
  await testDb.$disconnect();
  process.exit(1);
});
