// app/api/rating-engine/races/route.js
// Fetches races and entries for the Rating Engine screen, with filtering support.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const venueFilter = searchParams.get("venue");
    const dateFilter = searchParams.get("raceDate");
    const raceTypeFilter = searchParams.get("raceType");
    const raceNoFilter = searchParams.get("raceNo");
    const categoryFilter = searchParams.get("category");
    const distanceFilter = searchParams.get("distance");
    const statusFilter = searchParams.get("status");

    // 1. Fetch all distinct filter options across races in DB
    const allRaces = await db.race.findMany({
      select: {
        venue: true,
        raceDate: true,
        raceNo: true,
        raceType: true,
        category: true,
        distance: true,
        status: true,
      },
      orderBy: { raceDate: "desc" },
    });

    const venues = Array.from(new Set(allRaces.map((r) => r.venue))).filter(Boolean);
    const dates = Array.from(
      new Set(allRaces.map((r) => r.raceDate.toISOString().slice(0, 10)))
    ).filter(Boolean);
    const raceTypes = Array.from(new Set(allRaces.map((r) => (r.raceType === "TERMS" ? "Terms" : "Handicap")))).filter(Boolean);
    const raceNos = Array.from(new Set(allRaces.map((r) => r.raceNo))).sort((a, b) => a - b);
    const categories = Array.from(new Set(allRaces.map((r) => r.category))).filter(Boolean);
    const categoriesByType = {
      Handicap: Array.from(
        new Set(
          allRaces
            .filter((r) => String(r.raceType).toUpperCase() === "HANDICAP")
            .map((r) => r.category)
        )
      ).filter(Boolean),
      Terms: Array.from(
        new Set(
          allRaces
            .filter((r) => String(r.raceType).toUpperCase() === "TERMS")
            .map((r) => r.category)
        )
      ).filter(Boolean),
    };
    const distances = Array.from(new Set(allRaces.map((r) => r.distance))).filter(Boolean).sort((a, b) => a - b);

    // 2. Build where clause
    const where = {};
    if (venueFilter && venueFilter !== "ALL") where.venue = venueFilter;
    if (dateFilter && dateFilter !== "ALL") {
      const d = new Date(dateFilter);
      if (!isNaN(d.getTime())) {
        where.raceDate = d;
      }
    }
    if (raceTypeFilter && raceTypeFilter !== "ALL") {
      const upperType = raceTypeFilter.toUpperCase();
      if (upperType === "HANDICAP" || upperType === "TERMS") {
        where.raceType = upperType;
      }
    }
    if (raceNoFilter && raceNoFilter !== "ALL") {
      const parsedNo = parseInt(raceNoFilter, 10);
      if (!isNaN(parsedNo)) where.raceNo = parsedNo;
    }
    if (categoryFilter && categoryFilter !== "ALL") where.category = categoryFilter;
    if (distanceFilter && distanceFilter !== "ALL") where.distance = parseInt(distanceFilter, 10);
    if (statusFilter && statusFilter !== "ALL") where.status = statusFilter;

    // 3. Fetch matching races with full runner details
    const races = await db.race.findMany({
      where,
      include: {
        entries: {
          include: {
            horse: true,
            rating: true,
            decision: {
              include: { user: { select: { id: true, name: true, role: true } } },
            },
          },
          orderBy: [
            { placing: "asc" },
            { id: "asc" },
          ],
        },
      },
      orderBy: [
        { raceDate: "desc" },
        { raceNo: "asc" },
      ],
    });

    // 4. Format payload for UI
    const formattedRaces = races.map((race) => {
      const displayRaceType = race.raceType === "TERMS" ? "Terms" : "Handicap";
      const entries = race.entries.map((entry) => {
        const horse = entry.horse || {};
        const rating = entry.rating || null;
        const decision = entry.decision || null;

        // Plain words reasons explanation
        let reasonsExplanation = "No automated rating explanation available.";
        let cleanReasons = [];
        if (rating?.reasons) {
          const rawArr = Array.isArray(rating.reasons) ? rating.reasons : [String(rating.reasons)];
          cleanReasons = rawArr.map((r) => {
            if (typeof r !== "string") return r;
            return r
              .replace(/step value (\d+)\.0000/g, "step value $1")
              .replace(/step value (\d+\.\d+?)00/g, "step value $1")
              .replace(/step\(s\) = (-?\d+)\.00/g, "step(s) = $1");
          });
          reasonsExplanation = cleanReasons.join(" · ");
        }

        const isOverridden = decision ? decision.overridden : false;
        const finalChange = decision ? decision.finalChange : (rating?.recommendedChange ?? 0);
        const finalRating = decision
          ? decision.finalRating
          : (rating?.recommendedRating ?? horse.currentRating ?? null);

        return {
          id: entry.id,
          entryId: entry.id,
          horseDbId: horse.id,
          horseId: horse.horseId || `HRS-${String(horse.id).padStart(6, "0")}`,
          horseName: horse.name || "Unknown Horse",
          sexCategory: horse.sexCategory || "—",
          previousRuns: horse.previousRuns ?? 0,
          currentRating: horse.currentRating ?? null,
          placing: entry.placing ?? null,
          timing: entry.timing || "—",
          verdict: entry.verdict || "—",
          weightCarried: entry.weightCarried ?? null,
          weightDeclare: entry.weightDeclare ?? null,
          horseWeight: entry.horseWeight ?? null,
          jockey: entry.jockey || "—",
          trainer: entry.trainer || horse.trainer || "—",
          startGate: entry.startGate ?? null,
          shoes: entry.shoes || "—",
          penetrometer: entry.penetrometer ?? null,
          railing: entry.railing || "—",
          starterRemark: entry.starterRemark || null,
          veterinaryRemark: entry.veterinaryRemark || null,
          incidentRemark: entry.incidentRemark || null,
          exception:
            entry.starterRemark || entry.veterinaryRemark || entry.incidentRemark
              ? [entry.starterRemark, entry.veterinaryRemark, entry.incidentRemark].filter(Boolean).join(" | ")
              : "None",
          // Rating details
          ratingStatus: rating?.status || "NOT_RATED",
          recommendedChange: rating?.recommendedChange ?? null,
          recommendedRating: rating?.recommendedRating ?? null,
          reasons: cleanReasons,
          reasonsExplanation,
          // Decision & Override
          overridden: isOverridden,
          overrideReason: decision?.overrideReason || null,
          finalChange,
          finalRating,
          decisionUser: decision?.user?.name || null,
          decidedAt: decision?.decidedAt ? decision.decidedAt.toISOString() : null,
          // Race context fields
          venue: race.venue,
          raceDate: race.raceDate.toISOString().slice(0, 10),
          raceSeason: race.season || "2026-27",
          raceType: displayRaceType,
          raceCategory: race.category,
          raceNo: race.raceNo,
          cardNo: race.cardNo ?? 1,
          distance: race.distance,
        };
      });

      return {
        id: race.id,
        venue: race.venue,
        raceDate: race.raceDate.toISOString().slice(0, 10),
        raceDateFormatted: race.raceDate.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        season: race.season || "2026-27",
        category: race.category,
        raceNo: race.raceNo,
        cardNo: race.cardNo ?? 1,
        distance: race.distance,
        raceType: displayRaceType,
        status: race.status, // OPEN | REVIEWED
        runnersCount: entries.length,
        entries,
      };
    });

    return NextResponse.json({
      filters: {
        venues,
        dates,
        raceTypes,
        categories,
        categoriesByType,
        distances,
        raceNos,
      },
      races: formattedRaces,
    });
  } catch (error) {
    console.error("Failed to fetch rating engine races:", error);
    return NextResponse.json(
      { error: "Internal server error while fetching races" },
      { status: 500 }
    );
  }
}
