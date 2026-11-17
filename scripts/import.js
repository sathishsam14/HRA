// scripts/import.js
// CLI script to import race data, history, coefficients, or steward reports using the core importFile engine.
// Usage: npm run import -- <TYPE> <path>

import fs from "node:fs";
import path from "node:path";
import db from "../lib/db.js";
import { importFile } from "../lib/import/index.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("❌ Usage: npm run import -- <TYPE> <path>");
    console.error("   Types: HISTORY, RACE, ACTIVE_HORSE, COEFFICIENT, MASTER, STARTER, VETERINARY, INCIDENT");
    process.exit(1);
  }

  const [rawType, rawPath] = args;
  const fileType = String(rawType).toUpperCase().trim();
  const filePath = path.resolve(process.cwd(), rawPath);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found at path: ${filePath}`);
    process.exit(1);
  }

  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);

  console.log(`\n🚀 Starting CLI import for [${fileType}] file: "${fileName}" (${(buffer.length / 1024).toFixed(1)} KB)...`);

  const t0 = Date.now();
  const result = await importFile({
    fileName,
    buffer,
    fileType,
    source: "CLI",
  });
  const duration = Date.now() - t0;

  console.log("\n📊 --- Import Result ---");
  console.log(`Status:   ${result.success ? (result.skipped ? "SKIPPED (Duplicate)" : "SUCCESS") : "FAILED"}`);
  console.log(`Message:  ${result.message}`);
  console.log(`Duration: ${duration}ms`);

  if (result.savedRows !== undefined) {
    console.log(`Rows:     ${result.savedRows} saved, ${result.rejectedRows || 0} rejected`);
  }
  if (result.errors && result.errors.length > 0) {
    console.log("\nErrors encountered:");
    result.errors.slice(0, 10).forEach((err) => {
      console.log(` - Row ${err.row} [${err.column}]: ${err.reason}`);
    });
    if (result.errors.length > 10) {
      console.log(` ... and ${result.errors.length - 10} more error(s)`);
    }
  }

  await db.$disconnect();

  if (!result.success && !result.skipped) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("❌ Unhandled CLI import error:", err);
  await db.$disconnect();
  process.exit(1);
});
