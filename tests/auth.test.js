// tests/auth.test.js
// Vitest suite testing authentication, account locking, and RBAC write permissions.
// Requirements:
// 1. Wrong password returns generic error and logs to AuditLog.
// 2. Account locks for 15 minutes after 5 failed attempts.
// 3. Viewer role is strictly read-only and blocked from writing on the server (403).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import db from "../lib/db.js";
import { POST as loginRoute } from "../app/api/auth/login/route.js";
import {
  hashPassword,
  createSessionToken,
  assertWritePermission,
  requireRole,
} from "../lib/auth.js";
import { NextRequest } from "next/server";
import { middleware } from "../middleware.js";

describe("Authentication & RBAC Security Suite", () => {
  const testUserEmail = `test_auth_${Date.now()}@btc.com`;
  const validPassword = "CorrectPassword123!";
  const wrongPassword = "WrongPassword999!";

  beforeAll(async () => {
    // Create a dedicated test user
    const passwordHash = await hashPassword(validPassword);
    await db.user.create({
      data: {
        email: testUserEmail,
        name: "Test Auth User",
        role: "HANDICAPPER",
        passwordHash,
        active: true,
        failedLogins: 0,
        lockedUntil: null,
      },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("Wrong Password & Failed Logins", () => {
    it("returns generic 401 error on incorrect password and writes to AuditLog", async () => {
      const req = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testUserEmail,
          password: wrongPassword,
        }),
      });

      const res = await loginRoute(req);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toBe("Invalid email or password");

      // Verify AuditLog entry
      const auditEntry = await db.auditLog.findFirst({
        where: {
          action: "LOGIN_FAILED",
          entity: "User",
        },
        orderBy: { at: "desc" },
      });

      expect(auditEntry).not.toBeNull();
      expect(auditEntry.action).toBe("LOGIN_FAILED");
    });
  });

  describe("Account Locking (5 Failed Attempts -> 15 min lock)", () => {
    it("locks the account after 5 consecutive failed login attempts", async () => {
      const lockTestEmail = `lock_test_${Date.now()}@btc.com`;
      const passwordHash = await hashPassword(validPassword);
      await db.user.create({
        data: {
          email: lockTestEmail,
          name: "Lockout Test User",
          role: "HANDICAPPER",
          passwordHash,
          active: true,
          failedLogins: 0,
          lockedUntil: null,
        },
      });

      // Attempt 1 through 4: Should return 401
      for (let attempt = 1; attempt <= 4; attempt++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: lockTestEmail,
            password: wrongPassword,
          }),
        });

        const res = await loginRoute(req);
        expect(res.status).toBe(401);
      }

      // Verify user has 4 failed logins and is not locked yet
      let userInDb = await db.user.findUnique({
        where: { email: lockTestEmail },
      });
      expect(userInDb.failedLogins).toBe(4);
      expect(userInDb.lockedUntil).toBeNull();

      // Attempt 5: This 5th attempt must lock the account for 15 minutes and return 423
      const req5 = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: lockTestEmail,
          password: wrongPassword,
        }),
      });

      const res5 = await loginRoute(req5);
      expect(res5.status).toBe(423);
      const body5 = await res5.json();
      expect(body5.error).toContain("Account is locked for 15 minutes");

      // Verify database state: lockedUntil is set ~15 minutes into future
      userInDb = await db.user.findUnique({
        where: { email: lockTestEmail },
      });
      expect(userInDb.failedLogins).toBe(5);
      expect(userInDb.lockedUntil).not.toBeNull();
      const lockDurationMs = userInDb.lockedUntil.getTime() - Date.now();
      expect(lockDurationMs).toBeGreaterThan(13 * 60 * 1000); // at least ~14-15 min
      expect(lockDurationMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);

      // Attempt 6 (even with correct password): Must be blocked immediately while locked
      const req6 = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: lockTestEmail,
          password: validPassword,
        }),
      });

      const res6 = await loginRoute(req6);
      expect(res6.status).toBe(423);
      const body6 = await res6.json();
      expect(body6.error).toContain("Account is temporarily locked");

      // Verify AuditLog recorded LOGIN_BLOCKED_LOCKED
      const lockAudit = await db.auditLog.findFirst({
        where: {
          action: "LOGIN_BLOCKED_LOCKED",
          userId: userInDb.id,
        },
        orderBy: { at: "desc" },
      });
      expect(lockAudit).not.toBeNull();
      expect(lockAudit.reason).toContain("Account is locked");
    });
  });

  describe("Server-Side Read-Only Enforcement for VIEWER", () => {
    it("assertWritePermission rejects VIEWER with 403 Forbidden", async () => {
      const viewerSession = {
        id: 999,
        email: "viewer@btc.com",
        name: "Test Viewer",
        role: "VIEWER",
      };

      await expect(assertWritePermission(viewerSession)).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining("VIEWER role is read-only"),
      });
    });

    it("assertWritePermission allows ADMIN and HANDICAPPER", async () => {
      const adminSession = {
        id: 1,
        email: "admin@btc.com",
        name: "Admin",
        role: "ADMIN",
      };
      const handicapperSession = {
        id: 2,
        email: "handicapper@btc.com",
        name: "Handicapper",
        role: "HANDICAPPER",
      };

      await expect(assertWritePermission(adminSession)).resolves.toEqual(adminSession);
      await expect(assertWritePermission(handicapperSession)).resolves.toEqual(handicapperSession);
    });

    it("requireRole rejects VIEWER when only ADMIN and HANDICAPPER are permitted", async () => {
      const viewerSession = {
        id: 999,
        email: "viewer@btc.com",
        name: "Test Viewer",
        role: "VIEWER",
      };

      await expect(
        requireRole(["ADMIN", "HANDICAPPER"], viewerSession)
      ).rejects.toMatchObject({
        status: 403,
      });
    });

    it("middleware rejects write requests (POST/PUT/PATCH/DELETE) from VIEWER with 403", async () => {
      const viewerSessionToken = await createSessionToken({
        id: 999,
        email: "viewer@btc.com",
        name: "Test Viewer",
        role: "VIEWER",
      });

      // Construct a simulated write request with viewer cookie to /api/decision
      const writeRequest = new NextRequest("http://localhost:3000/api/decision", {
        method: "POST",
        headers: {
          cookie: `hra_session=${viewerSessionToken}`,
        },
      });

      const response = await middleware(writeRequest);
      expect(response.status).toBe(403);

      const json = await response.json();
      expect(json.error).toContain("VIEWER role is read-only and cannot perform write operations");
    });

    it("middleware allows write requests from HANDICAPPER or ADMIN", async () => {
      const handicapperSessionToken = await createSessionToken({
        id: 2,
        email: "handicapper@btc.com",
        name: "Test Handicapper",
        role: "HANDICAPPER",
      });

      const writeRequest = new NextRequest("http://localhost:3000/api/decision", {
        method: "POST",
        headers: {
          cookie: `hra_session=${handicapperSessionToken}`,
        },
      });

      const response = await middleware(writeRequest);
      // Middleware should allow the request through (NextResponse.next() has status 200)
      expect(response.status).toBe(200);
    });
  });
});
