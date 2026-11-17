// app/api/rating-engine/submit/route.js
// Submits a race review in a single transaction: saves Decision for every horse,
// writes one AuditLog row per horse, sets Race status to REVIEWED, and updates Horse.currentRating.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession, requireRole } from "@/lib/auth";
import { applyOverride } from "@/lib/rating-engine/index.js";

export async function POST(request) {
  try {
    // 1. Enforce RBAC: Admin and Handicapper only. Manager rejected with 403.
    const session = await getSession(request);
    await requireRole(["ADMIN", "HANDICAPPER"], session);

    // 2. Parse request
    const body = await request.json().catch(() => ({}));
    const { raceId, decisions } = body;

    if (!raceId) {
      return NextResponse.json({ error: "raceId is required" }, { status: 400 });
    }

    if (!Array.isArray(decisions) || decisions.length === 0) {
      return NextResponse.json(
        { error: "decisions list is required and cannot be empty" },
        { status: 400 }
      );
    }

    // 3. Fetch Race with entries and existing ratings
    const race = await db.race.findUnique({
      where: { id: parseInt(raceId, 10) },
      include: {
        entries: {
          include: {
            horse: true,
            rating: true,
            decision: true,
          },
        },
      },
    });

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    // 4. Double submit protection & immutability:
    // "After submit the race is read-only everywhere, enforced on the server."
    if (race.status === "REVIEWED") {
      return NextResponse.json(
        { error: "Race is already REVIEWED and cannot be submitted again" },
        { status: 400 }
      );
    }

    const decisionMap = new Map(decisions.map((d) => [d.entryId, d]));

    // 5. Pre-validation across all horses:
    // - Every entry must have a decision
    // - NEEDS_HANDICAPPER rows must be decided before submit
    // - Overrides must have a reason (validated with applyOverride)
    for (const entry of race.entries) {
      const d = decisionMap.get(entry.id);
      if (!d) {
        return NextResponse.json(
          { error: `Missing decision for entrant "${entry.horse.name}" (entryId: ${entry.id})` },
          { status: 400 }
        );
      }

      const isNeedsHandicapper = entry.rating?.status === "NEEDS_HANDICAPPER";
      if (isNeedsHandicapper) {
        if (!Number.isFinite(Number(d.finalChange)) || !Number.isFinite(Number(d.finalRating))) {
          return NextResponse.json(
            {
              error: `NEEDS_HANDICAPPER row for "${entry.horse.name}" must be decided by the Handicapper before submit`,
            },
            { status: 400 }
          );
        }
      }

      // Check if override
      if (d.overridden) {
        if (!d.overrideReason || !String(d.overrideReason).trim()) {
          return NextResponse.json(
            { error: "Override needs a reason" },
            { status: 400 }
          );
        }

        // Validate override logic
        const recRating = entry.rating?.recommendedRating ?? entry.horse.currentRating ?? 30;
        const recChange = entry.rating?.recommendedChange ?? 0;
        try {
          applyOverride(
            {
              horseId: entry.horse.horseId,
              horseName: entry.horse.name,
              recommendedRating: recRating,
              recommendedChange: recChange,
              status: entry.rating?.status || "RATED",
              reasons: entry.rating?.reasons || [],
            },
            {
              finalChange: Number(d.finalChange),
              reason: String(d.overrideReason).trim(),
              userId: session.id,
              at: new Date(),
            }
          );
        } catch (err) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
      }
    }

    // 6. Execute in ONE database transaction
    await db.$transaction(async (tx) => {
      const now = new Date();

      for (const entry of race.entries) {
        const d = decisionMap.get(entry.id);
        const finalChange = Number(d.finalChange);
        const finalRating = Number(d.finalRating);
        const overridden = Boolean(d.overridden);
        const overrideReason = overridden ? String(d.overrideReason).trim() : null;

        // A. Save Decision for every horse
        await tx.decision.upsert({
          where: { entryId: entry.id },
          update: {
            finalChange,
            finalRating,
            overridden,
            overrideReason,
            userId: session.id,
            decidedAt: now,
          },
          create: {
            entryId: entry.id,
            finalChange,
            finalRating,
            overridden,
            overrideReason,
            userId: session.id,
            decidedAt: now,
          },
        });

        // B. Update Horse.currentRating from the final rating
        await tx.horse.update({
          where: { id: entry.horseId },
          data: { currentRating: finalRating },
        });

        // C. Write AuditLog row ONLY for horses whose rating was overridden by the handicapper
        if (overridden) {
          await tx.auditLog.create({
            data: {
              action: "OVERRIDE",
              entity: "Horse",
              entityId: entry.horse.horseId,
              userId: session.id,
              reason: overrideReason || "Handicapper rating override",
              before: {
                horseName: entry.horse.name,
                raceNo: race.raceNo,
                raceDate: race.raceDate,
                currentRating: entry.horse.currentRating,
                recommendedRating: entry.rating?.recommendedRating,
                recommendedChange: entry.rating?.recommendedChange,
                status: entry.rating?.status,
              },
              after: {
                horseName: entry.horse.name,
                raceNo: race.raceNo,
                raceDate: race.raceDate,
                finalRating,
                finalChange,
                overridden: true,
                overrideReason,
              },
            },
          });
        }
      }

      // D. Set Race status to REVIEWED
      await tx.race.update({
        where: { id: race.id },
        data: { status: "REVIEWED" },
      });
    });

    return NextResponse.json({
      ok: true,
      message: "Race successfully submitted and marked as REVIEWED",
      raceId: race.id,
      decisionsCount: race.entries.length,
    });
  } catch (error) {
    console.error("Submit race error:", error);
    const status = error.status || 500;
    return NextResponse.json(
      { error: error.message || "Failed to submit race decisions" },
      { status }
    );
  }
}
