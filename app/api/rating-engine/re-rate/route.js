// app/api/rating-engine/re-rate/route.js
// Triggers automatic rating calculation and validation against latest coefficients.

import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { rateAndSaveRace, reRateAllOpenRaces } from "@/lib/rate";

export async function POST(request) {
  try {
    const session = await getSession(request);
    await requireRole(["ADMIN", "HANDICAPPER"], session);

    const body = await request.json().catch(() => ({}));
    const { raceId } = body;

    if (raceId && raceId !== "ALL") {
      const parsedId = parseInt(raceId, 10);
      const result = await rateAndSaveRace(parsedId);
      if (!result.ok && !result.skipped) {
        return NextResponse.json({ error: result.reason || "Failed to auto-rate race" }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        message: `Race ${result.raceRef || raceId} auto-rated & validated successfully!`,
        result,
      });
    }

    // Otherwise re-rate all open races
    const results = await reRateAllOpenRaces();
    return NextResponse.json({
      success: true,
      message: `All ${results.length} open races auto-rated & validated against approved coefficients!`,
      count: results.length,
    });
  } catch (error) {
    console.error("Re-rate error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to trigger auto-rating" },
      { status: error.status || 500 }
    );
  }
}
