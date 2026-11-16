// tests/rating-engine-db.test.js
// Vitest suite testing the database-wired Rating Engine endpoints:
// Requirements:
// 1. Override without a reason is rejected on the server.
// 2. Double submit is rejected on the server (race status is REVIEWED).
// 3. Viewer role is strictly blocked from deciding or submitting (403 Forbidden).
// 4. Submit saves Decision for every horse, updates Horse.currentRating, writes AuditLog per horse, and marks Race as REVIEWED.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import db from "../lib/db.js";
import { POST as overrideRoute } from "../app/api/rating-engine/override/route.js";
import { POST as submitRoute } from "../app/api/rating-engine/submit/route.js";
import { createSessionToken } from "../lib/auth.js";

describe("Rating Engine Database Integration Suite", () => {
  let handicapperSessionToken;
  let viewerSessionToken;
  let adminSessionToken;
  let testRaceId;
  let testEntryId1;
  let testEntryId2;
  let testHorse1Id;
  let testHorse2Id;

  beforeAll(async () => {
    // 1. Create sessions for Handicapper, Viewer, and Admin
    handicapperSessionToken = await createSessionToken({
      id: 2,
      email: "handicapper@btc.com",
      name: "Senior Handicapper",
      role: "HANDICAPPER",
    });

    viewerSessionToken = await createSessionToken({
      id: 3,
      email: "viewer@btc.com",
      name: "Official Viewer",
      role: "VIEWER",
    });

    adminSessionToken = await createSessionToken({
      id: 1,
      email: "admin@btc.com",
      name: "System Admin",
      role: "ADMIN",
    });

    // 2. Seed a dedicated test race with 2 entrants
    const race = await db.race.create({
      data: {
        venue: `BNG_TEST_${Date.now()}`,
        raceDate: new Date("2026-11-07"),
        category: "60-85",
        raceNo: 10,
        distance: 1400,
        raceType: "HANDICAP",
        status: "OPEN",
      },
    });
    testRaceId = race.id;

    const horse1 = await db.horse.create({
      data: {
        horseId: `HRS_TEST_${Date.now()}_1`,
        name: `Test Runner One ${Date.now()}`,
        currentRating: 60,
        previousRuns: 5,
        active: true,
      },
    });
    testHorse1Id = horse1.id;

    const horse2 = await db.horse.create({
      data: {
        horseId: `HRS_TEST_${Date.now()}_2`,
        name: `Test Runner Two ${Date.now()}`,
        currentRating: 55,
        previousRuns: 4,
        active: true,
      },
    });
    testHorse2Id = horse2.id;

    const entry1 = await db.raceEntry.create({
      data: {
        raceId: testRaceId,
        horseId: testHorse1Id,
        placing: 1,
        weightCarried: 58.0,
      },
    });
    testEntryId1 = entry1.id;

    await db.rating.create({
      data: {
        entryId: testEntryId1,
        status: "RATED",
        recommendedChange: 4,
        recommendedRating: 64,
        reasons: ["Winner (placed 1st)", "Category coefficient: +4"],
      },
    });

    const entry2 = await db.raceEntry.create({
      data: {
        raceId: testRaceId,
        horseId: testHorse2Id,
        placing: 2,
        weightCarried: 56.0,
      },
    });
    testEntryId2 = entry2.id;

    await db.rating.create({
      data: {
        entryId: testEntryId2,
        status: "RATED",
        recommendedChange: 2,
        recommendedRating: 57,
        reasons: ["Placed 2nd (above reference median)", "Coefficient adjustment: +2"],
      },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("1. Override Without Reason Validation", () => {
    it("rejects an override with an empty or missing reason with 400", async () => {
      const req = new Request("http://localhost:3000/api/rating-engine/override", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${handicapperSessionToken}`,
        },
        body: JSON.stringify({
          entryId: testEntryId1,
          finalChange: 6,
          reason: "", // EMPTY REASON
        }),
      });

      const res = await overrideRoute(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("Override needs a reason");
    });

    it("rejects a submit payload containing an override with no reason", async () => {
      const req = new Request("http://localhost:3000/api/rating-engine/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${handicapperSessionToken}`,
        },
        body: JSON.stringify({
          raceId: testRaceId,
          decisions: [
            {
              entryId: testEntryId1,
              finalChange: 6,
              finalRating: 66,
              overridden: true,
              overrideReason: "   ", // WHITESPACE ONLY
            },
            {
              entryId: testEntryId2,
              finalChange: 2,
              finalRating: 57,
              overridden: false,
              overrideReason: null,
            },
          ],
        }),
      });

      const res = await submitRoute(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe("Override needs a reason");
    });
  });

  describe("2. Viewer Role Rejection (Server-Side RBAC Enforcement)", () => {
    it("blocks Viewer with 403 on override route", async () => {
      const req = new Request("http://localhost:3000/api/rating-engine/override", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${viewerSessionToken}`,
        },
        body: JSON.stringify({
          entryId: testEntryId1,
          finalChange: 5,
          reason: "Viewer attempting illegal override",
        }),
      });

      const res = await overrideRoute(req);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.error).toContain("Forbidden");
    });

    it("blocks Viewer with 403 on submit route", async () => {
      const req = new Request("http://localhost:3000/api/rating-engine/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${viewerSessionToken}`,
        },
        body: JSON.stringify({
          raceId: testRaceId,
          decisions: [
            {
              entryId: testEntryId1,
              finalChange: 4,
              finalRating: 64,
              overridden: false,
              overrideReason: null,
            },
            {
              entryId: testEntryId2,
              finalChange: 2,
              finalRating: 57,
              overridden: false,
              overrideReason: null,
            },
          ],
        }),
      });

      const res = await submitRoute(req);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.error).toContain("Forbidden");
    });
  });

  describe("3. Successful Submit & Double Submit Prevention", () => {
    it("successfully submits race in one transaction, updating decisions, ratings, and writing AuditLog per horse", async () => {
      const req = new Request("http://localhost:3000/api/rating-engine/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${handicapperSessionToken}`,
        },
        body: JSON.stringify({
          raceId: testRaceId,
          decisions: [
            {
              entryId: testEntryId1,
              finalChange: 5, // Overridden from +4 to +5
              finalRating: 65,
              overridden: true,
              overrideReason: "Exceptional late acceleration under top weight",
            },
            {
              entryId: testEntryId2,
              finalChange: 2, // Kept recommendation
              finalRating: 57,
              overridden: false,
              overrideReason: null,
            },
          ],
        }),
      });

      const res = await submitRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.decisionsCount).toBe(2);

      // Verify Race status is now REVIEWED
      const updatedRace = await db.race.findUnique({
        where: { id: testRaceId },
      });
      expect(updatedRace.status).toBe("REVIEWED");

      // Verify Decisions saved for both entrants
      const decisions = await db.decision.findMany({
        where: { entryId: { in: [testEntryId1, testEntryId2] } },
      });
      expect(decisions.length).toBe(2);

      const dec1 = decisions.find((d) => d.entryId === testEntryId1);
      expect(dec1.overridden).toBe(true);
      expect(dec1.finalChange).toBe(5);
      expect(dec1.finalRating).toBe(65);
      expect(dec1.overrideReason).toBe("Exceptional late acceleration under top weight");

      const dec2 = decisions.find((d) => d.entryId === testEntryId2);
      expect(dec2.overridden).toBe(false);
      expect(dec2.finalChange).toBe(2);
      expect(dec2.finalRating).toBe(57);

      // Verify Horse.currentRating was updated from finalRating
      const horse1 = await db.horse.findUnique({ where: { id: testHorse1Id } });
      expect(horse1.currentRating).toBe(65);

      const horse2 = await db.horse.findUnique({ where: { id: testHorse2Id } });
      expect(horse2.currentRating).toBe(57);

      // Verify AuditLog rows written for both horses
      const auditEntries = await db.auditLog.findMany({
        where: {
          entity: "Horse",
          entityId: { in: [horse1.horseId, horse2.horseId] },
        },
      });
      expect(auditEntries.length).toBe(2);
      const audit1 = auditEntries.find((a) => a.entityId === horse1.horseId);
      expect(audit1.action).toBe("OVERRIDE");
      expect(audit1.reason).toBe("Exceptional late acceleration under top weight");

      const audit2 = auditEntries.find((a) => a.entityId === horse2.horseId);
      expect(audit2.action).toBe("DECISION_KEPT");
    });

    it("rejects double submit on a race that is already REVIEWED", async () => {
      // Attempting to submit the same race again must be rejected on server
      const req = new Request("http://localhost:3000/api/rating-engine/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${handicapperSessionToken}`,
        },
        body: JSON.stringify({
          raceId: testRaceId,
          decisions: [
            {
              entryId: testEntryId1,
              finalChange: 5,
              finalRating: 65,
              overridden: true,
              overrideReason: "Trying to modify reviewed race",
            },
            {
              entryId: testEntryId2,
              finalChange: 2,
              finalRating: 57,
              overridden: false,
              overrideReason: null,
            },
          ],
        }),
      });

      const res = await submitRoute(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("already REVIEWED");
    });

    it("rejects an override attempt on a race that is already REVIEWED", async () => {
      const req = new Request("http://localhost:3000/api/rating-engine/override", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hra_session=${adminSessionToken}`,
        },
        body: JSON.stringify({
          entryId: testEntryId1,
          finalChange: 7,
          reason: "Admin trying to change locked reviewed race",
        }),
      });

      const res = await overrideRoute(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("REVIEWED");
    });
  });
});
