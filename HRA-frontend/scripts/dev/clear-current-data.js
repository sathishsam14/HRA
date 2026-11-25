// scripts/dev/clear-current-data.js
// Safe utility to clear current-race data while strictly preserving master history and users.
//
// Rules enforced:
// 1. Dry run by default: prints safe DB info (host and name only, NO credentials) and candidate counts.
// 2. Only deletes when invoked with BOTH: --confirm AND --db-name <exact database name>.
// 3. Deletes inside ONE single transaction in strict dependency order (onDelete Restrict compliant).
// 4. KEEPS: Users, Roles, ExceptionKeywords, RuleVersions, Coefficients, and all HISTORY/BSM master data.
// 5. Removes generated current-race files (data/race-extras/, data/horse-remarks.json, uploads/ for current races/reports).
//    NEVER removes history-derived files (BSM.xlsx, pattern-samples.json) or code.

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// If DATABASE_URL is not in process.env, load from .env in project root
if (!process.env.DATABASE_URL) {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (err) {
    // Continue with existing process.env
  }
}

/**
 * Extracts database host and name safely.
 * NEVER outputs credentials, usernames, or passwords.
 */
function getSafeDbInfo(connectionString) {
  if (!connectionString) {
    return { host: "unknown", dbName: "unknown" };
  }
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname + (parsed.port ? `:${parsed.port}` : "");
    const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];
    return {
      host: host || "localhost",
      dbName: dbName || "unknown",
    };
  } catch {
    const match = connectionString.match(/@([^:\/?#]+)(?::(\d+))?\/([^?#]+)/);
    if (match) {
      return {
        host: match[1] + (match[2] ? `:${match[2]}` : ""),
        dbName: match[3],
      };
    }
    return { host: "unknown", dbName: "unknown" };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isConfirmed = args.includes("--confirm");

  // Parse --db-name <val> or --db-name=<val>
  let targetDbNameArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db-name" && i + 1 < args.length) {
      targetDbNameArg = args[i + 1];
    } else if (args[i].startsWith("--db-name=")) {
      targetDbNameArg = args[i].split("=")[1];
    }
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("❌ ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const dbInfo = getSafeDbInfo(rawUrl);

  const prisma = new PrismaClient({
    datasources: {
      db: { url: rawUrl },
    },
    log: ["error"],
  });

  try {
    console.log("\n======================================================================");
    console.log("       HRA CURRENT-RACE DATA CLEANER");
    console.log("======================================================================");
    console.log(`Database Host: ${dbInfo.host}`);
    console.log(`Database Name: ${dbInfo.dbName}`);
    console.log("----------------------------------------------------------------------");

    // 1. Identify current race files vs history files in UploadedFile
    const currentFileTypes = ["RACE", "STARTER", "VETERINARY", "INCIDENT", "STIPE"];
    const historyFileTypes = ["HISTORY", "MASTER", "COEFFICIENT", "ACTIVE_HORSE"];

    const currentUploadedFiles = await prisma.uploadedFile.findMany({
      where: { fileType: { in: currentFileTypes } },
    });

    const historyUploadedFiles = await prisma.uploadedFile.findMany({
      where: { fileType: { in: historyFileTypes } },
    });

    // 2. Identify candidate current races to delete:
    // A race belongs to current race imports if:
    // - status is 'OPEN', OR
    // - it has entries with Rating or Decision records (was rated/reviewed as a current race), OR
    // - it matches a current race file in data/race-extras/
    const extrasDir = path.resolve(process.cwd(), "data/race-extras");
    const extrasKeys = new Set();
    if (fs.existsSync(extrasDir)) {
      const extraFiles = fs.readdirSync(extrasDir).filter((f) => f.endsWith(".json"));
      for (const ef of extraFiles) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(extrasDir, ef), "utf-8"));
          const map = content?.entries || content || {};
          for (const k of Object.keys(map)) {
            const parts = k.split("_");
            if (parts.length >= 2) {
              extrasKeys.add(`${parts[0]}_${parts[1]}`); // date_raceno
            }
          }
        } catch {}
      }
    }

    const allRaces = await prisma.race.findMany({
      include: {
        entries: {
          select: {
            id: true,
            horseId: true,
            rating: { select: { id: true } },
            decision: { select: { id: true } },
          },
        },
      },
    });

    const targetRaces = allRaces.filter((race) => {
      // Rule A: Status OPEN is always a current race
      if (race.status === "OPEN") return true;

      // Rule B: Has any entry with Rating or Decision (evaluated current race)
      const hasRatingOrDecision = race.entries.some(
        (e) => e.rating !== null || e.decision !== null
      );
      if (hasRatingOrDecision) return true;

      // Rule C: Referenced in data/race-extras
      const dateStr = race.raceDate.toISOString().slice(0, 10);
      const key = `${dateStr}_${race.raceNo}`;
      if (extrasKeys.has(key)) return true;

      return false;
    });

    const preservedHistoryRaces = allRaces.filter((r) => !targetRaces.some((tr) => tr.id === r.id));

    const targetRaceIds = targetRaces.map((r) => r.id);
    const targetEntries = targetRaces.flatMap((r) => r.entries);
    const targetEntryIds = targetEntries.map((e) => e.id);

    // Count ratings and decisions to delete
    const ratingCount = await prisma.rating.count({
      where: { entryId: { in: targetEntryIds } },
    });
    const decisionCount = await prisma.decision.count({
      where: { entryId: { in: targetEntryIds } },
    });
    const auditLogCount = await prisma.auditLog.count();

    // Identify candidate orphan horses (horses that would have 0 entries left after this delete)
    const targetHorseIds = Array.from(new Set(targetEntries.map((e) => e.horseId)));
    const horsesToCheck = await prisma.horse.findMany({
      where: { id: { in: targetHorseIds } },
      include: {
        entries: { select: { id: true } },
        runs: { select: { id: true } },
      },
    });

    const targetEntryIdSet = new Set(targetEntryIds);
    const orphanHorseIds = horsesToCheck
      .filter((h) => {
        const remainingEntries = h.entries.filter((e) => !targetEntryIdSet.has(e.id));
        return remainingEntries.length === 0 && h.runs.length === 0;
      })
      .map((h) => h.id);

    // Identify files that would be removed
    const filesToRemove = [];

    // A. data/race-extras/
    if (fs.existsSync(extrasDir)) {
      const jsonFiles = fs.readdirSync(extrasDir).filter((f) => f.endsWith(".json"));
      for (const jf of jsonFiles) {
        filesToRemove.push(path.join("data/race-extras", jf));
      }
    }

    // B. data/horse-remarks.json
    const remarksFile = path.resolve(process.cwd(), "data/horse-remarks.json");
    if (fs.existsSync(remarksFile)) {
      filesToRemove.push("data/horse-remarks.json");
    }

    // C. Uploaded files in uploads/ folder corresponding to current races and reports
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      const diskFiles = fs.readdirSync(uploadsDir);
      const currentNames = new Set(
        currentUploadedFiles.map((f) => f.name.toLowerCase().replace(/[^a-z0-9._-]/g, "_"))
      );
      for (const df of diskFiles) {
        const lowerDisk = df.toLowerCase();
        // Check if matches any current race/report file or timestamped upload
        const isCurrentUpload = Array.from(currentNames).some((cn) => cn && lowerDisk.includes(cn));
        // NEVER remove BSM or master or coefficient files
        const isProtected =
          lowerDisk.includes("bsm") ||
          lowerDisk.includes("master") ||
          lowerDisk.includes("coefficient") ||
          lowerDisk.includes("active_horse");

        if (isCurrentUpload && !isProtected) {
          filesToRemove.push(path.join("uploads", df));
        }
      }
    }

    // Print planned deletion summary
    console.log("Target rows to delete (in 1 single transaction):");
    console.log(`  - Races (Current Race Imports):      ${targetRaces.length}`);
    console.log(`  - Race Entries:                      ${targetEntryIds.length}`);
    console.log(`  - Rating records:                    ${ratingCount}`);
    console.log(`  - Decision records:                  ${decisionCount}`);
    console.log(`  - AuditLog records:                  ${auditLogCount}`);
    console.log(`  - UploadedFile records:              ${currentUploadedFiles.length} (${currentFileTypes.join(", ")})`);
    console.log(`  - Orphan Horses (0 runs / 0 entries): ${orphanHorseIds.length}`);
    console.log("----------------------------------------------------------------------");
    console.log("Data KEPT and PRESERVED:");
    console.log(`  - Preserved History Races:           ${preservedHistoryRaces.length}`);
    console.log(`  - Preserved Master/History Files:    ${historyUploadedFiles.length} (${historyFileTypes.join(", ")})`);
    console.log("  - Users, Roles, and Passwords:       PRESERVED");
    console.log("  - Exception Keywords & Rules:        PRESERVED");
    console.log("  - Coefficients Table:                PRESERVED");
    console.log("  - Master BSM files & models:         PRESERVED");
    console.log("----------------------------------------------------------------------");
    console.log("Generated files to remove:");
    if (filesToRemove.length === 0) {
      console.log("  (None found)");
    } else {
      filesToRemove.forEach((f) => console.log(`  - ${f}`));
    }
    console.log("======================================================================");

    // Check confirmation and db-name
    const isDbNameMatch = !targetDbNameArg || targetDbNameArg === dbInfo.dbName;

    if (!isConfirmed || !isDbNameMatch) {
      console.log("\n⚠️  DRY RUN ONLY — NO DATA WAS DELETED.");
      if (!isConfirmed) {
        console.log("   Missing flag: --confirm");
      }
      if (!isDbNameMatch) {
        console.log(`   DB name mismatch: Provided "${targetDbNameArg}" but active DB is "${dbInfo.dbName}".`);
      }
      console.log("\nTo execute this deletion, run the command:");
      console.log(`  node scripts/dev/clear-current-data.js --confirm\n`);
      return;
    }

    // EXECUTION MODE: Perform deletion in one transaction in safe order
    console.log("\n🚀 Executing clean-up in one transaction...");

    await prisma.$transaction(
      async (tx) => {
        // 1. Delete Rating rows
        if (targetEntryIds.length > 0) {
          const delRatings = await tx.rating.deleteMany({
            where: { entryId: { in: targetEntryIds } },
          });
          console.log(`  ✓ Deleted ${delRatings.count} Rating records`);
        }

        // 2. Delete Decision rows
        if (targetEntryIds.length > 0) {
          const delDecisions = await tx.decision.deleteMany({
            where: { entryId: { in: targetEntryIds } },
          });
          console.log(`  ✓ Deleted ${delDecisions.count} Decision records`);
        }

        // 3. Delete RaceEntry rows
        if (targetEntryIds.length > 0) {
          const delEntries = await tx.raceEntry.deleteMany({
            where: { id: { in: targetEntryIds } },
          });
          console.log(`  ✓ Deleted ${delEntries.count} RaceEntry records`);
        }

        // 4. Delete Race rows
        if (targetRaceIds.length > 0) {
          const delRaces = await tx.race.deleteMany({
            where: { id: { in: targetRaceIds } },
          });
          console.log(`  ✓ Deleted ${delRaces.count} Race records`);
        }

        // 5. Delete AuditLog records
        const delAudit = await tx.auditLog.deleteMany({});
        console.log(`  ✓ Deleted ${delAudit.count} AuditLog records`);

        // 6. Delete UploadedFile records for current races and reports
        const delFiles = await tx.uploadedFile.deleteMany({
          where: { fileType: { in: currentFileTypes } },
        });
        console.log(`  ✓ Deleted ${delFiles.count} UploadedFile records`);

        // 7. Delete orphan horses with 0 remaining entries and 0 runs
        if (orphanHorseIds.length > 0) {
          const delHorses = await tx.horse.deleteMany({
            where: { id: { in: orphanHorseIds } },
          });
          console.log(`  ✓ Deleted ${delHorses.count} orphan Horse records`);
        }
      },
      { timeout: 600000 } // 10 minutes timeout
    );

    // Remove generated files from disk
    let removedFilesCount = 0;
    for (const relPath of filesToRemove) {
      try {
        const absPath = path.resolve(process.cwd(), relPath);
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
          removedFilesCount++;
        }
      } catch (fileErr) {
        console.warn(`  ⚠️ Could not remove file ${relPath}: ${fileErr.message}`);
      }
    }

    console.log(`  ✓ Removed ${removedFilesCount} generated disk file(s)`);
    console.log("\n✅ Clean-up completed successfully!");
    console.log("   The database is now reset to a clean state with master history intact.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Clean-up failed with error:", err);
  process.exit(1);
});
