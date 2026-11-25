// worker/index.js
// Background worker process that monitors FTP / SFTP / local source every 5 minutes using node-cron
// and calls importFile() from lib/import. Strictly read-only: never writes, renames, or deletes files at the source.
// Source is chosen by FTP_MODE in .env: local | sftp | ftps.
// Uses DATABASE_URL from .env.

import cron from "node-cron";
import crypto from "node:crypto";
import db from "../lib/db.js";
import { importFile } from "../lib/import/index.js";
import { reRateAllOpenRaces } from "../lib/rate.js";
import { detectFileType } from "./file-types.js";
import * as localSource from "./sources/local.js";
import * as sftpSource from "./sources/sftp.js";
import * as ftpsSource from "./sources/ftps.js";

export function getSource(mode = process.env.FTP_MODE || "local") {
  const normalized = String(mode).toLowerCase().trim();
  switch (normalized) {
    case "sftp":
      return { mode: "sftp", ...sftpSource };
    case "ftps":
      return { mode: "ftps", ...ftpsSource };
    case "local":
    default:
      return { mode: "local", ...localSource };
  }
}

// Processing priority order: COEFFICIENT, then HISTORY, then ACTIVE_HORSE, then reports
const TYPE_PRIORITY = {
  COEFFICIENT: 1,
  HISTORY: 2,
  ACTIVE_HORSE: 3,
  STARTER: 4,
  VETERINARY: 4,
  INCIDENT: 4,
};

/**
 * Executes a single scan and import pass.
 * @param {Object} [options]
 * @param {string} [options.mode] Optional override for FTP_MODE (local | sftp | ftps)
 * @returns {Promise<{ processed: number, saved: number, skipped: number, failed: number }>}
 */
export async function runOnce({ mode } = {}) {
  const source = getSource(mode);
  console.log(`\n🔍 [WORKER] Checking incoming files via source: ${source.mode.toUpperCase()}...`);

  let fileList = [];
  try {
    fileList = await source.list();
  } catch (err) {
    console.error(`❌ [WORKER] Failed to list files from ${source.mode} source:`, err.message);
    return { processed: 0, saved: 0, skipped: 0, failed: 1, error: err.message };
  }

  if (fileList.length === 0) {
    console.log(`ℹ️ [WORKER] No incoming files found.`);
    return { processed: 0, saved: 0, skipped: 0, failed: 0 };
  }

  console.log(`📦 [WORKER] Found ${fileList.length} file(s) in source.`);

  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 1. Resolve file types and filter out unknown names
  const recognizedFiles = [];
  for (const file of fileList) {
    const fileType = detectFileType(file.name);
    if (!fileType) {
      console.log(`[SKIPPED] "${file.name}": Unknown file type pattern`);
      skippedCount++;
    } else {
      recognizedFiles.push({
        ...file,
        fileType,
        priority: TYPE_PRIORITY[fileType] || 99,
      });
    }
  }

  // 2. Sort recognized files in strict order: COEFFICIENT (1), HISTORY (2), ACTIVE_HORSE (3), Reports (4)
  recognizedFiles.sort((a, b) => a.priority - b.priority);

  // 3. Process each file sequentially. A bad file must not stop others.
  for (const file of recognizedFiles) {
    const fileT0 = Date.now();
    const fileName = file.name;
    const fileType = file.fileType;

    try {
      // Read buffer from source (strictly read-only)
      const buffer = await source.read(fileName);

      // Pre-check SHA-256 hash + size against UploadedFile table
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const existing = await db.uploadedFile.findFirst({
        where: {
          size: buffer.length,
          hash,
        },
      });

      if (existing) {
        const fileElapsed = Date.now() - fileT0;
        console.log(`[SKIPPED] "${fileName}" [${fileType}]: Already imported (size: ${buffer.length}, hash: ${hash.slice(0, 8)}..., previously "${existing.name}") in ${fileElapsed}ms`);
        skippedCount++;
        continue;
      }

      // Call importFile with source FTP
      const result = await importFile({
        fileName,
        buffer,
        fileType,
        uploadedBy: null,
        source: "FTP",
      });

      const fileElapsed = Date.now() - fileT0;

      if (result.skipped) {
        console.log(`[SKIPPED] "${fileName}" [${fileType}]: ${result.message} (${fileElapsed}ms)`);
        skippedCount++;
      } else if (result.success) {
        console.log(
          `[SAVED] "${fileName}" [${fileType}]: ${result.savedRows} row(s) imported in ${fileElapsed}ms.${
            result.unmatched?.length ? ` (${result.unmatched.length} unmatched remarks)` : ""
          }`
        );
        savedCount++;
      } else {
        const errorDetail = result.errors?.length
          ? result.errors.map((e) => `Row ${e.row} [${e.column}]: ${e.reason}`).join("; ")
          : result.message;
        console.error(`[FAILED] "${fileName}" [${fileType}]: ${errorDetail} (${fileElapsed}ms)`);
        failedCount++;
      }
    } catch (err) {
      const fileElapsed = Date.now() - fileT0;
      console.error(`[FAILED] "${fileName}" [${fileType}]: ${err.message} (${fileElapsed}ms)`);
      failedCount++;
    }
  }

  // 4. After a cycle that imported anything, rate on the server by calling reRateAllOpenRaces() once
  if (savedCount > 0) {
    console.log(`\n⚡ [WORKER] Cycle imported ${savedCount} file(s). Triggering server-side rating for all open races via reRateAllOpenRaces()...`);
    const rateT0 = Date.now();
    try {
      const reRated = await reRateAllOpenRaces();
      const successCount = reRated.filter((r) => r.ok).length;
      console.log(`🏁 [WORKER] Server-side re-rating completed: ${successCount} open race(s) rated in ${Date.now() - rateT0}ms.`);
    } catch (rateErr) {
      console.error("❌ [WORKER] Server-side re-rating error:", rateErr.message);
    }
  }

  console.log(
    `\n🏁 [WORKER] Cycle complete: ${savedCount} saved, ${skippedCount} skipped, ${failedCount} failed.\n`
  );

  return {
    processed: fileList.length,
    saved: savedCount,
    skipped: skippedCount,
    failed: failedCount,
  };
}

// ─── CLI / Daemon Entrypoint ──────────────────────────────────────────────────

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/worker/index.js") ||
  process.argv[1]?.endsWith("worker/index.js");

if (isDirectRun) {
  const isOnce = process.argv.includes("--once");

  if (isOnce) {
    runOnce()
      .then(async () => {
        await db.$disconnect();
        process.exit(0);
      })
      .catch(async (e) => {
        console.error("Worker run error:", e);
        await db.$disconnect();
        process.exit(1);
      });
  } else {
    console.log("⏱️  [WORKER] Starting background file monitor (every 5 minutes)...");

    // Run first pass immediately
    runOnce().catch(console.error);

    // Schedule cron every 5 minutes: */5 * * * *
    cron.schedule("*/5 * * * *", async () => {
      try {
        await runOnce();
      } catch (err) {
        console.error("Worker cron execution error:", err);
      }
    });
  }
}
