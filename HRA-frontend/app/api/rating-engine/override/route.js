// app/api/rating-engine/override/route.js
// Handles and validates individual handicapper overrides using applyOverride from lib/rate.
// Persists the Decision and records an immutable AuditLog row immediately so overrides
// are preserved and visible across all races and in the Audit Trail.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession, requireRole } from "@/lib/auth";
import { applyOverride } from "@/lib/rate.js";
import { invalidateServerCache } from "@/lib/serverCache.js";

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

    // Fetch entry with race, horse, and rating
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
    const now = new Date();

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
        at: now,
      }
    );

    const patternDetails = "Python ML Backend (BTC Hybrid Model)";

    // Persist Decision and create AuditLog in a transaction
    await db.$transaction(async (tx) => {
      // 1. Upsert Decision
      await tx.decision.upsert({
        where: { entryId: entry.id },
        update: {
          finalChange: overrideResult.finalChange,
          finalRating: overrideResult.finalRating,
          overridden: true,
          overrideReason: overrideResult.override.reason,
          userId: session.id,
          decidedAt: now,
        },
        create: {
          entryId: entry.id,
          finalChange: overrideResult.finalChange,
          finalRating: overrideResult.finalRating,
          overridden: true,
          overrideReason: overrideResult.override.reason,
          userId: session.id,
          decidedAt: now,
        },
      });

      // 2. Append immutable AuditLog row
      await tx.auditLog.create({
        data: {
          action: "OVERRIDE",
          entity: "Horse",
          entityId: entry.horse.horseId,
          userId: session.id,
          reason: overrideResult.override.reason,
          before: {
            horseName: entry.horse.name,
            raceNo: entry.race.raceNo,
            raceDate: entry.race.raceDate,
            currentRating: entry.horse.currentRating,
            recommendedRating: recRating,
            recommendedChange: recChange,
            status: entry.rating?.status || "RATED",
            patternDetails,
          },
          after: {
            horseName: entry.horse.name,
            raceNo: entry.race.raceNo,
            raceDate: entry.race.raceDate,
            finalRating: overrideResult.finalRating,
            finalChange: overrideResult.finalChange,
            overridden: true,
            overrideReason: overrideResult.override.reason,
            patternDetails,
          },
        },
      });
    });

    // Invalidate server cache so fresh override data is served
    invalidateServerCache();

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
