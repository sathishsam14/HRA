// app/api/rating-engine/re-rate/route.js
// Triggers whole-meeting rating calculation via Python ML backend (/api/predict-meeting).

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { rateMeeting } from "@/lib/rate";
import { invalidateServerCache } from "@/lib/serverCache.js";

export async function POST(request) {
  try {
    const session = await getSession(request);
    await requireRole(["ADMIN", "HANDICAPPER"], session);

    const result = await rateMeeting();
    invalidateServerCache();

    return NextResponse.json({
      success: true,
      message: `Whole meeting (${result.racesRated} open races, ${result.entriesRated} horses) rated via Python ML Engine!`,
      count: result.racesRated,
      entriesRated: result.entriesRated,
    });
  } catch (error) {
    console.error("Re-rate error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to trigger auto-rating" },
      { status: error.status || 500 }
    );
  }
}
