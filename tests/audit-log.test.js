// tests/audit-log.test.js
// Vitest suite verifying append-only AuditLog database trigger
// and Reviewed race immutability triggers.

import { describe, it, expect, afterAll } from "vitest";
import db from "../lib/db.js";

describe("Database Trigger Constraints", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  describe("AuditLog Append-Only Trigger", () => {
    it("allows inserting a new AuditLog record", async () => {
      const record = await db.auditLog.create({
        data: {
          action: "OVERRIDE",
          entity: "Horse",
          entityId: "HRS-000001",
          before: { rating: 50 },
          after: { rating: 54 },
          reason: "Legitimate initial handicapper override",
        },
      });

      expect(record.id).toBeDefined();
      expect(record.action).toBe("OVERRIDE");
    });

    it("blocks UPDATE on AuditLog and raises 'AuditLog is append-only'", async () => {
      const record = await db.auditLog.create({
        data: {
          action: "TEST_UPDATE_TARGET",
          entity: "Horse",
          entityId: "HRS-000002",
          before: { rating: 40 },
          after: { rating: 44 },
          reason: "Before tampering attempt",
        },
      });

      // Attempting to UPDATE the audit row must be rejected by PostgreSQL trigger
      await expect(
        db.auditLog.update({
          where: { id: record.id },
          data: {
            reason: "Attempted fraudulent tampering with audit reason",
          },
        })
      ).rejects.toThrow(/AuditLog is append-only/);
    });

    it("blocks DELETE on AuditLog and raises 'AuditLog is append-only'", async () => {
      const record = await db.auditLog.create({
        data: {
          action: "TEST_DELETE_TARGET",
          entity: "Horse",
          entityId: "HRS-000003",
          before: { rating: 60 },
          after: { rating: 62 },
          reason: "Before delete attempt",
        },
      });

      // Attempting to DELETE the audit row must be rejected by PostgreSQL trigger
      await expect(
        db.auditLog.delete({
          where: { id: record.id },
        })
      ).rejects.toThrow(/AuditLog is append-only/);
    });
  });

  describe("Reviewed Race Immutability Trigger", () => {
    it("blocks UPDATE or DELETE on Decision when parent race status is REVIEWED", async () => {
      // 1. Create a user
      const user = await db.user.create({
        data: {
          email: `handicapper_${Date.now()}@btc.com`,
          name: "Test Handicapper",
          passwordHash: "hash123",
          role: "HANDICAPPER",
        },
      });

      // 2. Create a race with status REVIEWED
      const race = await db.race.create({
        data: {
          venue: `BNG_${Date.now()}`,
          raceDate: new Date("2026-11-07"),
          category: "60-85",
          raceNo: 99,
          distance: 1400,
          status: "REVIEWED",
        },
      });

      // 3. Create a horse & race entry
      const horse = await db.horse.create({
        data: {
          horseId: `HRS_${Date.now()}`,
          name: "Test Runner",
          previousRuns: 5,
          currentRating: 50,
        },
      });

      const entry = await db.raceEntry.create({
        data: {
          raceId: race.id,
          horseId: horse.id,
          placing: 1,
        },
      });

      // 4. Create decision
      const decision = await db.decision.create({
        data: {
          entryId: entry.id,
          finalChange: 4,
          finalRating: 54,
          overridden: false,
          userId: user.id,
        },
      });

      // Modifying Decision on a REVIEWED race must fail
      await expect(
        db.decision.update({
          where: { id: decision.id },
          data: { finalRating: 58 },
        })
      ).rejects.toThrow(/Cannot modify or delete Decision when parent Race status is REVIEWED/);

      // Deleting RaceEntry on a REVIEWED race must fail
      await expect(
        db.raceEntry.delete({
          where: { id: entry.id },
        })
      ).rejects.toThrow(/Cannot modify or delete RaceEntry when parent Race status is REVIEWED/);
    });
  });
});
