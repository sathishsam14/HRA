// tests/worker.test.js
// Vitest suite testing the background worker in local mode (worker/index.js).
// Verifies file detection, import, duplicate skipping, and source immutability (never deletes/modifies source).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import db from "../lib/db.js";
import { runOnce } from "../worker/index.js";
import { detectFileType } from "../worker/file-types.js";

describe("Worker File Ingestion Suite (Local Mode)", () => {
  const incomingDir = path.resolve(process.cwd(), "ftp-test/incoming");
  const samplesDir = path.resolve(process.cwd(), "data/samples");
  const testFileName = `worker_test_race_${Date.now()}.xlsx`;
  const targetFilePath = path.join(incomingDir, testFileName);

  beforeAll(() => {
    if (!fs.existsSync(incomingDir)) {
      fs.mkdirSync(incomingDir, { recursive: true });
    }
  });

  afterAll(async () => {
    // Clean up test file from incoming
    if (fs.existsSync(targetFilePath)) {
      fs.unlinkSync(targetFilePath);
    }
    await db.$disconnect();
  });

  it("detectFileType correctly infers file types from naming conventions", () => {
    expect(detectFileType("master_data.xlsx")).toBe("MASTER");
    expect(detectFileType("Active Horse Previous perfomance report.xlsx")).toBe("MASTER");
    expect(detectFileType("race_05_07nov.xlsx")).toBe("RACE");
    expect(detectFileType("race_card.xlsx")).toBe("RACE");
    expect(detectFileType("BWM-BSM 22-26-Consolidated.xlsx")).toBe("HISTORY");
    expect(detectFileType("starter_05.docx")).toBe("STARTER");
    expect(detectFileType("vet_05.pdf")).toBe("VETERINARY");
    expect(detectFileType("incident_02.pdf")).toBe("INCIDENT");
    expect(detectFileType("random_file.txt")).toBeNull();
  });

  it("detects and saves a new race file without modifying or deleting the source file", async () => {
    // Copy sample good race to ftp-test/incoming
    const sampleBuffer = fs.readFileSync(path.join(samplesDir, "good_race.xlsx"));
    fs.writeFileSync(targetFilePath, sampleBuffer);

    // Run one worker pass in local mode
    const summary = await runOnce({ mode: "local" });

    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect(summary.saved).toBeGreaterThanOrEqual(1);

    // CRITICAL RULE: Source file MUST NOT be deleted or modified
    expect(fs.existsSync(targetFilePath)).toBe(true);
    const remainingBuffer = fs.readFileSync(targetFilePath);
    expect(remainingBuffer.length).toBe(sampleBuffer.length);

    // Verify record in database
    const uploadedRecord = await db.uploadedFile.findFirst({
      where: { name: testFileName },
    });
    expect(uploadedRecord).not.toBeNull();
    expect(uploadedRecord.status).toBe("PROCESSED");
  });

  it("skips identical file on subsequent passes without creating duplicate DB entries", async () => {
    // Second pass with the file still sitting in ftp-test/incoming
    const summary = await runOnce({ mode: "local" });

    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.saved).toBe(0);

    // Verify only 1 record exists in UploadedFile
    const count = await db.uploadedFile.count({
      where: { name: testFileName },
    });
    expect(count).toBe(1);

    // Source file remains intact
    expect(fs.existsSync(targetFilePath)).toBe(true);
  });
});
