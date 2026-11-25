// app/api/auth/logout/route.js
// Destroys user session cookie and logs logout in AuditLog.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(request) {
  try {
    await getSession(request);

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
