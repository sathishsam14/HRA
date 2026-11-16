// tests/import.test.js
// Tests file import engine and API upload endpoint.
// Requirements:
// 1. ACTIVE_HORSE gives 553 horses and 6,251 distinct run rows (the file has 6,253 rows, 2 are exact duplicates).
// 2. The same file twice is skipped with "already uploaded".
// 3. A file with a missing mandatory field is rejected and saves nothing.
// 4. A VIEWER upload is refused on the server with 403 Forbidden.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import db from "../lib/db.js";
import { importFile } from "../lib/import/index.js";
import { POST as uploadRoute } from "../app/api/upload/route.js";
import { createSessionToken } from "../lib/auth.js";

describe("File Import Engine & Upload Suite", () => {
  const activeHorsePath = path.resolve(process.cwd(), "data/Active Horse Previous perfomance report.xlsx");
  const samplesDir = path.resolve(process.cwd(), "data/samples");
  let adminUser = null;
  let viewerUser = null;

  beforeAll(async () => {
    // Ensure test users exist
    adminUser = await db.user.upsert({
      where: { email: "import_test_admin@btc.com" },
      update: {},
      create: {
        email: "import_test_admin@btc.com",
        name: "Import Test Admin",
        role: "ADMIN",
        passwordHash: "hash",
        active: true,
      },
    });

    viewerUser = await db.user.upsert({
      where: { email: "import_test_viewer@btc.com" },
      update: {},
      create: {
        email: "import_test_viewer@btc.com",
        name: "Import Test Viewer",
        role: "VIEWER",
        passwordHash: "hash",
        active: true,
      },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("1. ACTIVE_HORSE Report Ingestion", () => {
    it("gives 553 horses and 6,251 distinct run rows (from 6,253 rows with 2 exact duplicates)", async () => {
      expect(fs.existsSync(activeHorsePath)).toBe(true);
      const buffer = fs.readFileSync(activeHorsePath);
      const fileName = `Active_Horse_Test_${Date.now()}.xlsx`;

      const result = await importFile({
        fileName,
        buffer,
        fileType: "ACTIVE_HORSE",
        uploadedBy: adminUser.id,
        source: "UPLOAD",
      });

      expect(result.success).toBe(true);
      expect(result.horsesCount).toBe(553);
      expect(result.totalRuns).toBe(6253);
      expect(result.savedRows).toBe(6251);
      expect(result.errors).toEqual([]);
      expect(result.fileId).toBeDefined();

      // Verify UploadedFile record
      const uploadedFile = await db.uploadedFile.findUnique({
        where: { id: result.fileId },
      });
      expect(uploadedFile).not.toBeNull();
      expect(uploadedFile.name).toBe(fileName);
      expect(uploadedFile.fileType).toBe("ACTIVE_HORSE");
      expect(uploadedFile.status).toBe("PROCESSED");

      // Verify AuditLog written
      const auditLog = await db.auditLog.findFirst({
        where: {
          action: "FILE_IMPORT",
          entity: "UploadedFile",
          entityId: String(result.fileId),
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.reason).toContain("ACTIVE_HORSE");

      // Verify database function previous_runs() works for an imported horse
      const sampleHorse = await db.horse.findFirst({
        where: { name: "SERDAR" },
      });
      expect(sampleHorse).not.toBeNull();

      const runsCount = await db.$queryRaw`
        SELECT previous_runs(${sampleHorse.id}::INT, NULL) as count
      `;
      expect(Number(runsCount[0].count)).toBeGreaterThan(0);
    }, 120000);
  });

  describe("2. Duplicate File Upload Prevention", () => {
    it("skips the same file uploaded twice with 'already uploaded'", async () => {
      const buffer = fs.readFileSync(activeHorsePath);
      const fixedName = `stable_duplicate_${Date.now()}.xlsx`;

      // Upload 1
      const res1 = await importFile({
        fileName: fixedName,
        buffer,
        fileType: "ACTIVE_HORSE",
        uploadedBy: adminUser.id,
      });
      expect(res1.success).toBe(true);
      expect(res1.skipped).toBeUndefined();

      // Upload 2 (same name, size, SHA-256 hash)
      const res2 = await importFile({
        fileName: fixedName,
        buffer,
        fileType: "ACTIVE_HORSE",
        uploadedBy: adminUser.id,
      });

      expect(res2.success).toBe(true);
      expect(res2.skipped).toBe(true);
      expect(res2.savedRows).toBe(0);
      expect(res2.message.toLowerCase()).toContain("already");
      expect(res2.message.toLowerCase()).toContain("uploaded");
    }, 60000);
  });

  describe("3. Missing Mandatory Field Rejection", () => {
    it("rejects file with a missing mandatory field and saves nothing", async () => {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Race Data");
      ws.columns = [
        { header: "Venue", key: "venue" },
        { header: "Race Date", key: "raceDate" },
        { header: "Race Category", key: "raceCategory" },
        { header: "Race No", key: "raceNo" },
        { header: "Distance", key: "distance" },
        { header: "Horse Name", key: "horseName" },
      ];

      ws.addRow({
        venue: "BNG",
        raceDate: "07/11/2026",
        raceCategory: "60-85",
        raceNo: 999,
        distance: 1200,
        horseName: "Valid Runner Sample",
      });

      ws.addRow({
        venue: "BNG",
        raceDate: "07/11/2026",
        raceCategory: "60-85",
        raceNo: 999,
        distance: null, // Missing mandatory
        horseName: "", // Missing mandatory
      });

      const buffer = await wb.xlsx.writeBuffer();
      const testName = `defective_race_${Date.now()}.xlsx`;

      const result = await importFile({
        fileName: testName,
        buffer: Buffer.from(buffer),
        fileType: "RACE",
        uploadedBy: adminUser.id,
      });

      expect(result.success).toBe(false);
      expect(result.savedRows).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);

      // Verify no Race #999 was created
      const race = await db.race.findFirst({
        where: { raceNo: 999 },
      });
      expect(race).toBeNull();

      // Verify no UploadedFile row was created
      const uploaded = await db.uploadedFile.findFirst({
        where: { name: testName },
      });
      expect(uploaded).toBeNull();
    });
  });

  describe("4. VIEWER Role Rejection", () => {
    it("refuses upload from VIEWER role on the server with 403 Forbidden", async () => {
      // Create session cookie for VIEWER
      const viewerToken = await createSessionToken({
        id: viewerUser.id,
        email: viewerUser.email,
        name: viewerUser.name,
        role: "VIEWER",
      });

      const formData = new FormData();
      const fakeBlob = new Blob(["dummy content"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      formData.append("file", fakeBlob, "test.xlsx");
      formData.append("fileType", "RACE");

      const req = new Request("http://localhost:3000/api/upload", {
        method: "POST",
        headers: {
          cookie: `hra_session=${viewerToken}`,
        },
        body: formData,
      });

      const response = await uploadRoute(req);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error).toMatch(/Forbidden|role/i);
    });
  });
});
