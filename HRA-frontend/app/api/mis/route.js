// app/api/mis/route.js
// Server-paginated API for the 27 statutory MIS columns with Venue, Date, Season, Type, Category filters.

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCachedData } from "@/lib/serverCache.js";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const cacheKey = searchParams.toString() || "default";

    const payload = await getCachedData("mis_report", cacheKey, async () => {
      const venue = searchParams.get("venue");
      const raceDate = searchParams.get("raceDate");
      const season = searchParams.get("season");
      const raceType = searchParams.get("raceType");
      const category = searchParams.get("category");
      const horseName = searchParams.get("horseName");

      const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10)));
      const skip = (page - 1) * pageSize;

      // 1. Fetch distinct filter options only for races with confirmed handicapper decisions
      const allRaces = await db.race.findMany({
        where: {
          status: "REVIEWED",
          entries: { some: { decision: { isNot: null } } },
        },
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
      ).filter(Boolean).sort();
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

      // 2. Build race filter where clause: ONLY confirmed REVIEWED races with decisions
      const raceWhere = {
        status: "REVIEWED",
      };
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

      // Only entries confirmed by the Handicapper appear in the MIS report
      const entryWhere = {
        race: raceWhere,
        decision: { isNot: null },
      };
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

        const finalChange = decision ? decision.finalChange : null;
        const finalRating = decision ? decision.finalRating : (h.currentRating ?? null);
        const isConfirmed = decision !== null && decision !== undefined;

        return {
          id: e.id,
          venue: r.venue || "—",
          raceDate: r.raceDate.toISOString().slice(0, 10),
          raceDateFormatted: r.raceDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          raceSeason: r.season || "—",
          raceType: r.raceType || "—",
          raceCategory: r.category || "—",
          raceNo: r.raceNo,
          cardNo: r.cardNo !== null ? r.cardNo : "—",
          distance: r.distance ? `${r.distance} m` : "—",
          currentRating: finalRating !== null ? finalRating : (h.currentRating !== null ? h.currentRating : "—"),
          horseName: h.name || "—",
          horseWeight: e.horseWeight !== null ? `${e.horseWeight} kg` : "—",
          shoes: e.shoes || "—",
          startGate: e.startGate !== null ? e.startGate : "—",
          weightDeclare: e.weightDeclare !== null ? `${e.weightDeclare} kg` : "—",
          jockey: e.jockey || "—",
          weightCarried: e.weightCarried !== null ? `${e.weightCarried} kg` : "—",
          placing: e.placing !== null ? e.placing : "—",
          timing: e.timing || "—",
          verdict: e.verdict || "—",
          trainer: e.trainer || h.trainer || "—",
          penetrometer: e.penetrometer !== null ? e.penetrometer : "—",
          railing: e.railing || "—",
          starterReport: e.starterRemark || "—",
          veterinaryReport: e.veterinaryRemark || "—",
          incidentReport: e.incidentRemark || "—",
          status: isConfirmed ? (decision.overridden ? "OVERRIDDEN" : "RATED") : "NOT_RATED",
          override: decision ? (decision.overridden ? "Yes" : "No") : "No",
          finalChange: finalChange !== null ? (finalChange > 0 ? `+${finalChange}` : String(finalChange)) : "—",
          reasonExplanation: decision?.overrideReason || (Array.isArray(rating?.reasons) ? rating.reasons.join("; ") : (rating?.reasons || "Approved recommendation")),
          finalRating: finalRating !== null ? finalRating : (h.currentRating !== null ? h.currentRating : "—"),
          recommendedRating: rating?.recommendedRating !== null && rating?.recommendedRating !== undefined ? rating.recommendedRating : (h.currentRating !== null ? h.currentRating : "—"),
          overridden: decision ? Boolean(decision.overridden) : false,
        };
      });

      return {
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
      };
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("MIS report fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch MIS report records" },
      { status: 500 }
    );
  }
}
