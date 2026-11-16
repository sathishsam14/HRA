// app/api/auth/logout/route.js
// Destroys user session cookie and logs logout in AuditLog.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(request) {
  try {
    const session = await getSession(request);

    // Write logout to AuditLog if user had an active session
    if (session?.id) {
      await db.auditLog.create({
        data: {
          action: "LOGOUT",
          userId: session.id,
          entity: "User",
          entityId: String(session.id),
          reason: "User logged out",
        },
      });
    }

    const response = NextResponse.json({ ok: true, message: "Logged out successfully" });

    // Expire the session cookie immediately
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Failed to process logout" },
      { status: 500 }
    );
  }
}
