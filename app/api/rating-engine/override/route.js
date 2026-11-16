// app/api/rating-engine/override/route.js
// Handles and validates individual handicapper overrides using applyOverride from lib/rating-engine.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession, requireRole } from "@/lib/auth";
import { applyOverride } from "@/lib/rating-engine/index.js";

export async function POST(request) {
  try {
    const session = await getSession(request);
    await requireRole(["ADMIN", "HANDICAPPER"], session);

    const body = await request.json().catch(() => ({}));
    const { entryId, finalChange, reason } = body;

    if (!entryId) {
      return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    }

    if (!Number.isFinite(Number(finalChange))) {
      return NextResponse.json(
        { error: "Override needs a final rating change" },
        { status: 400 }
      );
    }

    if (!reason || !String(reason).trim()) {
      return NextResponse.json(
        { error: "Override needs a reason" },
        { status: 400 }
      );
    }

    // Fetch entry with race and rating
    const entry = await db.raceEntry.findUnique({
      where: { id: parseInt(entryId, 10) },
      include: {
        race: true,
        horse: true,
        rating: true,
      },
    });

    if (!entry) {
      return NextResponse.json({ error: "RaceEntry not found" }, { status: 404 });
    }

    if (entry.race.status === "REVIEWED") {
      return NextResponse.json(
        { error: "Cannot modify or override an entry on a REVIEWED race" },
        { status: 400 }
      );
    }

    const recRating = entry.rating?.recommendedRating ?? entry.horse.currentRating ?? 30;
    const recChange = entry.rating?.recommendedChange ?? 0;

    // Validate using rating-engine applyOverride function
    const overrideResult = applyOverride(
      {
        horseId: entry.horse.horseId,
        horseName: entry.horse.name,
        recommendedRating: recRating,
        recommendedChange: recChange,
        status: entry.rating?.status || "RATED",
        reasons: entry.rating?.reasons || [],
      },
      {
        finalChange: Number(finalChange),
        reason: String(reason).trim(),
        userId: session.id,
        at: new Date(),
      }
    );

    return NextResponse.json({
      ok: true,
      entryId: entry.id,
      finalChange: overrideResult.finalChange,
      finalRating: overrideResult.finalRating,
      overrideReason: overrideResult.override.reason,
      user: session.name,
      decidedAt: overrideResult.override.at.toISOString(),
    });
  } catch (error) {
    console.error("Override validation error:", error);
    const status = error.status || 400;
    return NextResponse.json(
      { error: error.message || "Failed to validate override" },
      { status }
    );
  }
}
