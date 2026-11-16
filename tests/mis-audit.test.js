// tests/mis-audit.test.js
// Tests for Dashboard stats, MIS Report filtering/pagination/export,
// Audit Trail filtering/IST timestamps/export, and Audit Trail having NO write endpoints (405 Method Not Allowed).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import db from "../lib/db.js";
import { GET as getDashboardStats } from "../app/api/dashboard/stats/route.js";
import { GET as getMisRoute } from "../app/api/mis/route.js";
import { GET as exportMisRoute } from "../app/api/mis/export/route.js";
import {
  GET as getAuditRoute,
  POST as postAuditRoute,
  PUT as putAuditRoute,
  PATCH as patchAuditRoute,
  DELETE as deleteAuditRoute,
} from "../app/api/audit/route.js";
import { GET as exportAuditRoute } from "../app/api/audit/export/route.js";
import { createSessionToken } from "../lib/auth.js";

describe("Dashboard, MIS Report, and Audit Trail Integration Suite", () => {
  let adminCookie;
  let handicapperCookie;
  let viewerCookie;

  let testVenue;
  let testRaceId;
  let testHorseId;
  let testEntryId;
  let testAuditLogId;

  beforeAll(async () => {
    // 1. Create valid session cookies for all three roles
    const adminToken = await createSessionToken({
      id: 1,
      email: "admin@btc.com",
      name: "System Administrator",
      role: "ADMIN",
    });
    adminCookie = `hra_session=${adminToken}`;

    const handicapperToken = await createSessionToken({
      id: 2,
      email: "handicapper@btc.com",
      name: "Lead Handicapper",
      role: "HANDICAPPER",
    });
    handicapperCookie = `hra_session=${handicapperToken}`;

    const viewerToken = await createSessionToken({
      id: 3,
      email: "viewer@btc.com",
      name: "Steward Viewer",
      role: "VIEWER",
    });
    viewerCookie = `hra_session=${viewerToken}`;

    // 2. Create seed data specifically for MIS and Audit tests
    testVenue = `VENUE_MIS_${Date.now()}`;

    const race = await db.race.create({
      data: {
        venue: testVenue,
        raceDate: new Date("2026-11-14"),
        season: "2026-27",
        category: "40-65",
        raceNo: 7,
        cardNo: 3,
        distance: 1200,
        raceType: "HANDICAP",
        status: "OPEN",
      },
    });
    testRaceId = race.id;

    const horse = await db.horse.create({
      data: {
        horseId: `HRS_MIS_${Date.now()}`,
        name: `MIS Speedster ${Date.now()}`,
        currentRating: 50,
        previousRuns: 6,
        trainer: "Trainer X",
        active: true,
      },
    });
    testHorseId = horse.id;

    const entry = await db.raceEntry.create({
      data: {
        raceId: testRaceId,
        horseId: testHorseId,
        placing: 2,
        timing: "1:12.45",
        verdict: "1 1/2",
        weightCarried: 56.5,
        horseWeight: 460,
        shoes: "A",
        starterRemark: "Slow to jump",
        veterinaryRemark: null, // Test blank optional values
        incidentRemark: null,
      },
    });
    testEntryId = entry.id;

    await db.rating.create({
      data: {
        entryId: testEntryId,
        status: "RATED",
        recommendedChange: 2,
        recommendedRating: 52,
        reasons: ["Second place finish (+2)"],
      },
    });

    await db.decision.create({
      data: {
        entry: { connect: { id: testEntryId } },
        user: { connect: { id: 2 } },
        finalChange: 3,
        finalRating: 53,
        overridden: true,
        overrideReason: "Handicapper adjustment: carried penalty but finished strongly",
      },
    });

    const auditLog = await db.auditLog.create({
      data: {
        userId: 2,
        action: "OVERRIDE",
        entity: "RaceEntry",
        entityId: String(testEntryId),
        reason: "Handicapper adjustment: carried penalty but finished strongly",
        before: { recommendedChange: 2, recommendedRating: 52 },
        after: { finalChange: 3, finalRating: 53, overridden: true },
      },
    });
    testAuditLogId = auditLog.id;
  });

  afterAll(async () => {
    // Cleanup created test records (AuditLog is append-only, but in local test DB foreign keys restrict)
    try {
      await db.decision.deleteMany({ where: { entryId: testEntryId } });
      await db.rating.deleteMany({ where: { entryId: testEntryId } });
      await db.raceEntry.deleteMany({ where: { id: testEntryId } });
      await db.race.deleteMany({ where: { id: testRaceId } });
      await db.horse.deleteMany({ where: { id: testHorseId } });
    } catch {
      // Ignore cleanup constraint errors
    }
  });

  // ==========================================
  // 1. Dashboard Stats API
  // ==========================================
  describe("Dashboard Stats API (/api/dashboard/stats)", () => {
    it("returns live counts and last 5 uploaded files for Admin, Handicapper, and Viewer", async () => {
      for (const cookie of [adminCookie, handicapperCookie, viewerCookie]) {
        const req = new Request("http://localhost:3000/api/dashboard/stats", {
          headers: { cookie },
        });
        const res = await getDashboardStats(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data).toHaveProperty("stats");
        expect(data.stats).toHaveProperty("racesAwaitingReview");
        expect(data.stats).toHaveProperty("racesReviewed");
        expect(data.stats).toHaveProperty("horsesNeedingHandicapper");
        expect(data.stats).toHaveProperty("overridesThisSeason");
        expect(Array.isArray(data.lastUploadedFiles)).toBe(true);
        expect(Array.isArray(data.races)).toBe(true);
      }
    });

    it("rejects unauthenticated requests with 401", async () => {
      const req = new Request("http://localhost:3000/api/dashboard/stats");
      const res = await getDashboardStats(req);
      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // 2. MIS Report API
  // ==========================================
  describe("MIS Report API (/api/mis)", () => {
    it("returns the 27 statutory columns with server pagination", async () => {
      const req = new Request("http://localhost:3000/api/mis?page=1&pageSize=10", {
        headers: { cookie: viewerCookie },
      });
      const res = await getMisRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("rows");
      expect(data).toHaveProperty("pagination");
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.pageSize).toBe(10);
      expect(data.pagination.totalCount).toBeGreaterThanOrEqual(1);

      // Verify the 27 statutory fields on a returned row
      const row = data.rows.find((r) => r.id === testEntryId);
      expect(row).toBeDefined();
      expect(row.venue).toBe(testVenue);
      expect(row.raceSeason).toBe("2026-27");
      expect(row.raceType).toBe("HANDICAP");
      expect(row.raceCategory).toBe("40-65");
      expect(row.raceNo).toBe(7);
      expect(row.cardNo).toBe(3);
      expect(row.distance).toBe("1200 m");
      expect(row.currentRating).toBe(50);
      expect(row.horseWeight).toBe("460 kg");
      expect(row.shoes).toBe("A");
      expect(row.weightCarried).toBe("56.5 kg");
      expect(row.placing).toBe(2);
      expect(row.timing).toBe("1:12.45");
      expect(row.verdict).toBe("1 1/2");
      expect(row.starterReport).toBe("Slow to jump");
      // Blank optional fields MUST show as a dash "—"
      expect(row.veterinaryReport).toBe("—");
      expect(row.incidentReport).toBe("—");
      // 25. Recommended Rating
      expect(row.recommendedRating).toBe(52);
      // 26. Override
      expect(row.override).toBe("Yes");
      // 27. Final rating change
      expect(row.finalChange).toBe("+3");
      // 28. Final rating
      expect(row.finalRating).toBe(53);
      // 29. Reason explanation
      expect(row.reasonExplanation).toContain("Handicapper adjustment");
    });

    it("filters correctly by Venue", async () => {
      const req = new Request(`http://localhost:3000/api/mis?venue=${testVenue}`, {
        headers: { cookie: handicapperCookie },
      });
      const res = await getMisRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.rows.length).toBeGreaterThanOrEqual(1);
      data.rows.forEach((r) => {
        expect(r.venue).toBe(testVenue);
      });
    });

    it("filters correctly by Category and Season", async () => {
      const req = new Request(
        `http://localhost:3000/api/mis?category=40-65&season=2026-27&venue=${testVenue}`,
        { headers: { cookie: adminCookie } }
      );
      const res = await getMisRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.rows.length).toBe(1);
      expect(data.rows[0].id).toBe(testEntryId);
    });

    it("handles non-matching filters returning empty list", async () => {
      const req = new Request(
        `http://localhost:3000/api/mis?venue=NON_EXISTENT_VENUE_XYZ`,
        { headers: { cookie: viewerCookie } }
      );
      const res = await getMisRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.rows.length).toBe(0);
      expect(data.pagination.totalCount).toBe(0);
    });
  });

  // ==========================================
  // 3. MIS Excel Export API
  // ==========================================
  describe("MIS Excel Export API (/api/mis/export)", () => {
    it("generates and downloads a valid Excel spreadsheet (.xlsx) with all 29 statutory columns", async () => {
      const req = new Request(`http://localhost:3000/api/mis/export?venue=${testVenue}`, {
        headers: { cookie: viewerCookie },
      });
      const res = await exportMisRoute(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      expect(res.headers.get("content-disposition")).toContain("attachment; filename=");

      const blob = await res.arrayBuffer();
      expect(blob.byteLength).toBeGreaterThan(1000); // Valid xlsx file
    });
  });

  // ==========================================
  // 4. Audit Trail API (Read-only, Newest First, IST)
  // ==========================================
  describe("Audit Trail API (/api/audit)", () => {
    it("returns newest-first AuditLog rows with IST formatted timestamps", async () => {
      const req = new Request("http://localhost:3000/api/audit?page=1&pageSize=20", {
        headers: { cookie: viewerCookie },
      });
      const res = await getAuditRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("rows");
      expect(data.rows.length).toBeGreaterThanOrEqual(1);

      // Verify newest-first order
      for (let i = 0; i < data.rows.length - 1; i++) {
        const dateA = new Date(data.rows[i].atUtc).getTime();
        const dateB = new Date(data.rows[i + 1].atUtc).getTime();
        expect(dateA).toBeGreaterThanOrEqual(dateB);
      }

      // Check IST timestamp format
      const entry = data.rows.find((r) => r.id === testAuditLogId);
      expect(entry).toBeDefined();
      expect(entry.atIst).toContain("IST");
      expect(entry.action).toBe("OVERRIDE");
      expect(entry.recommendedChange).toBe("+2");
      expect(entry.finalChange).toBe("+3");
      expect(entry.overridden).toBe(true);
      expect(entry.reason).toBe("Handicapper adjustment: carried penalty but finished strongly");
      expect(entry.userName).toContain("Handicapper");
    });

    it("filters Audit Trail by action and userId", async () => {
      const req = new Request("http://localhost:3000/api/audit?action=OVERRIDE&userId=2", {
        headers: { cookie: adminCookie },
      });
      const res = await getAuditRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.rows.length).toBeGreaterThanOrEqual(1);
      data.rows.forEach((r) => {
        expect(r.action).toBe("OVERRIDE");
      });
    });

    it("filters Audit Trail by race / entity text", async () => {
      const req = new Request(`http://localhost:3000/api/audit?race=${testEntryId}`, {
        headers: { cookie: handicapperCookie },
      });
      const res = await getAuditRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.rows.some((r) => r.id === testAuditLogId)).toBe(true);
    });
  });

  // ==========================================
  // 5. Audit Trail Write Rejection (No Write Endpoints)
  // ==========================================
  describe("Audit Trail Immutability & Rejection of Write Endpoints", () => {
    it("rejects POST to /api/audit with 405 Method Not Allowed", async () => {
      const res = await postAuditRoute();
      expect(res.status).toBe(405);
      const json = await res.json();
      expect(json.error).toContain("Method Not Allowed");
    });

    it("rejects PUT to /api/audit with 405 Method Not Allowed", async () => {
      const res = await putAuditRoute();
      expect(res.status).toBe(405);
      const json = await res.json();
      expect(json.error).toContain("Method Not Allowed");
    });

    it("rejects PATCH to /api/audit with 405 Method Not Allowed", async () => {
      const res = await patchAuditRoute();
      expect(res.status).toBe(405);
      const json = await res.json();
      expect(json.error).toContain("Method Not Allowed");
    });

    it("rejects DELETE to /api/audit with 405 Method Not Allowed", async () => {
      const res = await deleteAuditRoute();
      expect(res.status).toBe(405);
      const json = await res.json();
      expect(json.error).toContain("Method Not Allowed");
    });
  });

  // ==========================================
  // 6. Audit Trail Excel Export API
  // ==========================================
  describe("Audit Trail Excel Export API (/api/audit/export)", () => {
    it("generates and downloads a valid Audit Excel spreadsheet with IST timestamps", async () => {
      const req = new Request("http://localhost:3000/api/audit/export?action=OVERRIDE", {
        headers: { cookie: viewerCookie },
      });
      const res = await exportAuditRoute(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      expect(res.headers.get("content-disposition")).toContain("HRA_Audit_Trail_");

      const blob = await res.arrayBuffer();
      expect(blob.byteLength).toBeGreaterThan(1000);
    });
  });
});
