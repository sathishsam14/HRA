// app/api/dashboard/stats/route.js
// Fetches live aggregated dashboard statistics, KPI metrics, and recent uploads from PostgreSQL.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // 1. KPI Counts
    const [
      racesAwaitingReview,
      racesReviewed,
      horsesNeedingHandicapper,
      overridesThisSeason,
      lastUploadedFiles,
      openRacesList,
      recentOverridesList,
    ] = await Promise.all([
      // A. Races awaiting review
      db.race.count({ where: { status: "OPEN" } }),

      // B. Races reviewed
      db.race.count({ where: { status: "REVIEWED" } }),

      // C. Horses needing the Handicapper
      db.rating.count({
        where: {
          status: "NEEDS_HANDICAPPER",
          entry: { race: { status: "OPEN" } },
        },
      }),

      // D. Overrides this season
      db.decision.count({ where: { overridden: true } }),

      // E. Last 5 uploaded files with status
      db.uploadedFile.findMany({
        take: 5,
        orderBy: { uploadedAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      }),

      // F. Open races list for dashboard table
      db.race.findMany({
        where: { status: "OPEN" },
        take: 8,
        orderBy: [{ raceDate: "desc" }, { raceNo: "asc" }],
        include: {
          entries: {
            select: { id: true },
          },
        },
      }),

      // G. Recent 5 overrides from AuditLog
      db.auditLog.findMany({
        where: { action: "OVERRIDE" },
        take: 5,
        orderBy: { at: "desc" },
        include: {
          user: { select: { name: true, role: true } },
        },
      }),
    ]);

    // Format last uploaded files
    const formattedFiles = lastUploadedFiles.map((f) => ({
      id: f.id,
      name: f.name,
      fileType: f.fileType,
      sizeKb: (f.size / 1024).toFixed(1),
      status: f.status,
      uploadedAt: f.uploadedAt.toISOString(),
      uploadedBy: f.user?.name || f.user?.email || "Automated Ingestion",
    }));

    // Format open races
    const formattedRaces = openRacesList.map((r) => ({
      id: r.id,
      venue: r.venue,
      raceDate: r.raceDate.toISOString().slice(0, 10),
      raceDateFormatted: r.raceDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      category: r.category,
      raceNo: r.raceNo,
      distance: r.distance,
      runners: r.entries.length,
      status: r.status,
    }));

    // Format overrides
    const formattedOverrides = recentOverridesList.map((a) => {
      const before = a.before || {};
      const after = a.after || {};
      return {
        id: a.id,
        at: a.at.toISOString(),
        horse: a.entityId,
        userName: a.user?.name || "Handicapper",
        reason: a.reason || "Manual steward discretion",
        beforeRating: before.currentRating ?? null,
        finalRating: after.finalRating ?? null,
        finalChange: after.finalChange ?? null,
      };
    });

    return NextResponse.json({
      stats: {
        racesAwaitingReview,
        racesReviewed,
        horsesNeedingHandicapper,
        overridesThisSeason,
      },
      lastUploadedFiles: formattedFiles,
      races: formattedRaces,
      recentOverrides: formattedOverrides,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard statistics" },
      { status: 500 }
    );
  }
}
