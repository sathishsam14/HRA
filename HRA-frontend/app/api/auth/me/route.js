// app/api/auth/me/route.js
// Returns current authenticated user session or null.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        role: session.role,
      },
    });
  } catch (error) {
    console.error("Session fetch error:", error);
    return NextResponse.json({ user: null });
  }
}
