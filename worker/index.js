// worker/index.js
// Background worker process that checks for new files every 5 minutes using node-cron
// and calls importFile() from lib/import. Never writes to or deletes from the source.
// Source is chosen by FTP_MODE in .env: local | sftp | ftps.

import cron from "node-cron";
import crypto from "node:crypto";
import db from "../lib/db.js";
import { importFile } from "../lib/import/index.js";
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

/**
 * Executes a single scan and import pass.
 * @param {Object} [options]
 * @param {string} [options.mode] Optional override for FTP_MODE (local | sftp | ftps)
 * @returns {Promise<{ processed: number, saved: number, skipped: number, failed: number }>}
 */
export async function runOnce({ mode } = {}) {
  const source = getSource(mode);
  console.log(`\n🔍 [WORKER] Checking for incoming files via source: ${source.mode.toUpperCase()}...`);

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

  console.log(`📦 [WORKER] Found ${fileList.length} file(s) to inspect.`);

  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const file of fileList) {
    const fileName = file.name;
    const fileType = detectFileType(fileName);

    if (!fileType) {
      console.log(`[SKIPPED] ${fileName}: Unrecognized file type pattern`);
      skippedCount++;
      continue;
    }

    try {
      // 1. Read buffer from source (never write or delete source)
      const buffer = await source.read(fileName);

      // 2. Pre-check SHA-256 hash against UploadedFile table
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const existing = await db.uploadedFile.findUnique({
        where: {
          name_size_hash: {
            name: fileName,
            size: buffer.length,
            hash,
          },
        },
      });

      if (existing) {
        console.log(`[SKIPPED] ${fileName}: Already processed (UploadedFile id: ${existing.id})`);
        skippedCount++;
        continue;
      }

      // 3. Import file via core import engine
      const result = await importFile({
        fileName,
        buffer,
        fileType,
        uploadedBy: null, // automated background process
      });

      if (result.skipped) {
        console.log(`[SKIPPED] ${fileName}: ${result.message}`);
        skippedCount++;
      } else if (result.success) {
        console.log(
          `[SAVED] ${fileName} as ${fileType}: ${result.savedRows} row(s) saved.${
            result.unmatched?.length ? ` (${result.unmatched.length} unmatched remarks)` : ""
          }`
        );
        savedCount++;
      } else {
        const errorDetail = result.errors?.length
          ? result.errors.map((e) => `Row ${e.row} [${e.column}]: ${e.reason}`).join("; ")
          : result.message;
        console.log(`[FAILED] ${fileName}: ${errorDetail}`);
        failedCount++;
      }
    } catch (err) {
      console.log(`[FAILED] ${fileName}: ${err.message}`);
      failedCount++;
    }
  }

  console.log(
    `🏁 [WORKER] Pass complete: ${savedCount} saved, ${skippedCount} skipped, ${failedCount} failed.\n`
  );

  return {
    processed: fileList.length,
    saved: savedCount,
    skipped: skippedCount,
    failed: failedCount,
  };
}

// ─── CLI Entrypoint ───────────────────────────────────────────────────────────

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
