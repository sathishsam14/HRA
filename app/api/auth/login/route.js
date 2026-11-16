// app/api/auth/login/route.js
// Handles user authentication, 5-attempt/15-minute account locking,
// signed session cookie creation, and AuditLog recording.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import {
  verifyPassword,
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRY_SECONDS,
} from "@/lib/auth";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawEmail = String(body.email || body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!rawEmail || !password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Look up user by email (or username matching email prefix if someone types 'admin')
    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: rawEmail },
          { email: `${rawEmail}@btc.com` },
        ],
      },
    });

    // 1. User does not exist
    if (!user || !user.active) {
      await db.auditLog.create({
        data: {
          action: "LOGIN_FAILED",
          userId: null,
          entity: "User",
          entityId: rawEmail,
          reason: "Invalid email or password (user not found or inactive)",
        },
      });

      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // 2. Check if account is currently locked
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutesRemaining = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / (60 * 1000));

      await db.auditLog.create({
        data: {
          action: "LOGIN_BLOCKED_LOCKED",
          userId: user.id,
          entity: "User",
          entityId: String(user.id),
          reason: `Login rejected: Account is locked until ${user.lockedUntil.toISOString()}`,
        },
      });

      return NextResponse.json(
        {
          error: `Account is temporarily locked due to multiple failed login attempts. Please try again in ${minutesRemaining} minute(s).`,
        },
        { status: 423 }
      );
    }

    // 3. Verify password with bcryptjs
    const isPasswordValid = await verifyPassword(password, user.passwordHash);

    if (!isPasswordValid) {
      const newFailedLogins = (user.failedLogins || 0) + 1;
      let newLockedUntil = null;
      let auditReason = "Invalid email or password";

      // Lock account for 15 minutes after 5 failed attempts
      if (newFailedLogins >= 5) {
        newLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        auditReason = "Account locked for 15 minutes after 5 failed login attempts";
      }

      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: newFailedLogins,
          lockedUntil: newLockedUntil,
        },
      });

      await db.auditLog.create({
        data: {
          action: "LOGIN_FAILED",
          userId: user.id,
          entity: "User",
          entityId: String(user.id),
          reason: auditReason,
          after: {
            failedLogins: newFailedLogins,
            lockedUntil: newLockedUntil ? newLockedUntil.toISOString() : null,
          },
        },
      });

      if (newFailedLogins >= 5) {
        return NextResponse.json(
          {
            error: "Too many failed login attempts. Account is locked for 15 minutes.",
          },
          { status: 423 }
        );
      }

      // Return one generic error on wrong password
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // 4. Password is valid: reset failed counters and unlock
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
      },
    });

    // 5. Create signed JWT session token with jose (8 hour expiry)
    const sessionPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const sessionToken = await createSessionToken(sessionPayload);

    // 6. Record successful login into AuditLog
    await db.auditLog.create({
      data: {
        action: "LOGIN_SUCCESS",
        userId: user.id,
        entity: "User",
        entityId: String(user.id),
        reason: "User logged in successfully",
      },
    });

    // 7. Set signed httpOnly cookie and return user info
    const response = NextResponse.json({
      ok: true,
      user: sessionPayload,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_EXPIRY_SECONDS,
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during login" },
      { status: 500 }
    );
  }
}
