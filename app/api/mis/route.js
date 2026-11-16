// app/api/mis/route.js
// Server-paginated API for the 27 statutory MIS columns with Venue, Date, Season, Type, Category filters.

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
    const venue = searchParams.get("venue");
    const raceDate = searchParams.get("raceDate");
    const season = searchParams.get("season");
    const raceType = searchParams.get("raceType");
    const category = searchParams.get("category");
    const horseName = searchParams.get("horseName");

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10)));
    const skip = (page - 1) * pageSize;

    // 1. Fetch distinct filter options
    const allRaces = await db.race.findMany({
      select: {
        venue: true,
        raceDate: true,
        season: true,
        raceType: true,
        category: true,
      },
    });

    const venues = Array.from(new Set(allRaces.map((r) => r.venue))).filter(Boolean);
    const dates = Array.from(
      new Set(allRaces.map((r) => r.raceDate.toISOString().slice(0, 10)))
    ).filter(Boolean);
    const seasons = Array.from(new Set(allRaces.map((r) => r.season))).filter(Boolean);
    const types = Array.from(new Set(allRaces.map((r) => (r.raceType === "TERMS" ? "Terms" : "Handicap")))).filter(Boolean);
    const categories = Array.from(
      new Set(
        allRaces
          .filter((r) => !raceType || raceType === "ALL" || String(r.raceType).toUpperCase() === raceType.toUpperCase())
          .map((r) => r.category)
      )
    ).filter(Boolean);
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

    // 2. Build race filter where clause
    const raceWhere = {};
    if (venue && venue !== "ALL") raceWhere.venue = venue;
    if (raceDate && raceDate !== "ALL") {
      const d = new Date(raceDate);
      if (!isNaN(d.getTime())) raceWhere.raceDate = d;
    }
    if (season && season !== "ALL") raceWhere.season = season;
    if (raceType && raceType !== "ALL") {
      const upperType = raceType.toUpperCase();
      if (upperType === "HANDICAP" || upperType === "TERMS") {
        raceWhere.raceType = upperType;
      }
    }
    if (category && category !== "ALL") raceWhere.category = category;

    const entryWhere = { race: raceWhere };
    if (horseName && horseName.trim() !== "") {
      entryWhere.horse = {
        name: { contains: horseName.trim(), mode: "insensitive" },
      };
    }

    // 3. Count total matching rows & query paginated records
    const [totalCount, entries] = await Promise.all([
      db.raceEntry.count({ where: entryWhere }),
      db.raceEntry.findMany({
        where: entryWhere,
        skip,
        take: pageSize,
        include: {
          race: true,
          horse: true,
          rating: true,
          decision: true,
        },
        orderBy: [
          { race: { raceDate: "desc" } },
          { race: { raceNo: "asc" } },
          { placing: "asc" },
        ],
      }),
    ]);

    // 4. Map the 27 statutory columns (blank optional values display as "—")
    const rows = entries.map((e) => {
      const r = e.race;
      const h = e.horse;
      const rating = e.rating;
      const decision = e.decision;

      const finalChange = decision ? decision.finalChange : (rating?.recommendedChange ?? null);
      const finalRating = decision ? decision.finalRating : (rating?.recommendedRating ?? h.currentRating ?? null);

      return {
        id: e.id,
        // 1. Venue
        venue: r.venue || "—",
        // 2. Race date
        raceDate: r.raceDate.toISOString().slice(0, 10),
        raceDateFormatted: r.raceDate.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        // 3. Race season
        raceSeason: r.season || "—",
        // 4. Race type
        raceType: r.raceType || "—",
        // 5. Race category
        raceCategory: r.category || "—",
        // 6. Race no
        raceNo: r.raceNo,
        // 7. Card no
        cardNo: r.cardNo !== null ? r.cardNo : "—",
        // 8. Distance
        distance: r.distance ? `${r.distance} m` : "—",
        // 9. Current rating (Rating after auto rating done or handicapper edited rating)
        currentRating: finalRating !== null ? finalRating : (h.currentRating !== null ? h.currentRating : "—"),
        // 10. Horse name
        horseName: h.name || "—",
        // 11. Horse weight
        horseWeight: e.horseWeight !== null ? `${e.horseWeight} kg` : "—",
        // 12. Shoes
        shoes: e.shoes || "—",
        // 13. Start Gate
        startGate: e.startGate !== null ? e.startGate : "—",
        // 14. Weight declare
        weightDeclare: e.weightDeclare !== null ? `${e.weightDeclare} kg` : "—",
        // 15. Jockey
        jockey: e.jockey || "—",
        // 16. Weight carried
        weightCarried: e.weightCarried !== null ? `${e.weightCarried} kg` : "—",
        // 17. Placing in the current race
        placing: e.placing !== null ? e.placing : "—",
        // 18. Timing
        timing: e.timing || "—",
        // 19. Verdict
        verdict: e.verdict || "—",
        // 20. Trainer
        trainer: e.trainer || h.trainer || "—",
        // 21. Penetrometer reading
        penetrometer: e.penetrometer !== null ? e.penetrometer : "—",
        // 22. Railing position
        railing: e.railing || "—",
        // 23. Starter report observations
        starterReport: e.starterRemark || "—",
        // 24. Veterinary report observations
        veterinaryReport: e.veterinaryRemark || "—",
        // 25. Incident report observations
        incidentReport: e.incidentRemark || "—",
        // 26. Rating status
        status: rating?.status || "NOT_RATED",
        // 27. Override (Yes / No)
        override: decision ? (decision.overridden ? "Yes" : "No") : "—",
        // 28. Final rating change
        finalChange: finalChange !== null ? (finalChange > 0 ? `+${finalChange}` : String(finalChange)) : "—",
        // 29. Reason explanation for decision
        reasonExplanation: decision?.overrideReason || (Array.isArray(rating?.reasons) ? rating.reasons.join("; ") : (rating?.reasons || "—")),
        // Backward-compat aliases if needed
        finalRating: finalRating !== null ? finalRating : "—",
        recommendedRating: rating?.recommendedRating !== null && rating?.recommendedRating !== undefined ? rating.recommendedRating : "—",
        overridden: decision ? Boolean(decision.overridden) : false,
      };
    });

    return NextResponse.json({
      filters: {
        venues,
        dates,
        seasons,
        types,
        categories,
        categoriesByType,
      },
      rows,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      },
    });
  } catch (error) {
    console.error("MIS report fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch MIS report records" },
      { status: 500 }
    );
  }
}
