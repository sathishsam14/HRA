// scripts/load-main-data.js
// Ingests the real consolidated historical ledger into the MAIN database (hra)
// so that all 1,400+ races and 13,000+ entries are live in the UI.

import fs from "node:fs";
import path from "node:path";
import db from "../lib/db.js";
import { importFile } from "../lib/import/index.js";

async function main() {
  console.log("================================================================================");
  console.log("🐎 BTC HRA Loading Production Data into Main Database (hra)");
  console.log("================================================================================");
  console.log(`🔒 Target: Main Database (${process.env.DATABASE_URL})`);

  const filePath = path.resolve(process.cwd(), "data/BWM-BSM 22-26 Consolidated.xlsx");
  if (!fs.existsSync(filePath)) {
    console.error("File not found at:", filePath);
    process.exit(1);
  }

  const fileName = "BWM-BSM 22-26 Consolidated.xlsx";
  const buffer = fs.readFileSync(filePath);
  console.log(`📂 Read file: ${fileName} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);

  console.log("\n⚙️  Importing via importFile() [type: HISTORY]...");
  const startTime = Date.now();
  const result = await importFile({
    fileName,
    buffer,
    fileType: "HISTORY",
    uploadedBy: null,
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ Ingestion complete in ${duration}s: ${result.message}`);

  const [raceCount, horseCount, entryCount, ratingCount] = await Promise.all([
    db.race.count(),
    db.horse.count(),
    db.raceEntry.count(),
    db.rating.count(),
  ]);

  console.log("\n📊 MAIN DATABASE TOTALS:");
  console.log(`   • Races   : ${raceCount.toLocaleString()}`);
  console.log(`   • Horses  : ${horseCount.toLocaleString()}`);
  console.log(`   • Entries : ${entryCount.toLocaleString()}`);
  console.log(`   • Ratings : ${ratingCount.toLocaleString()}`);
  console.log("================================================================================\n");

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal error loading production data:", e);
  await db.$disconnect();
  process.exit(1);
});
