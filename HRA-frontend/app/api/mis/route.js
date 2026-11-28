// app/api/mis/route.js
// Server-paginated API for the 27 statutory MIS columns with Venue, Date, Season, Type, Category filters.
// Combines confirmed current-season races (REVIEWED) with all master Excel (BSM.xlsx) records.

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCachedData } from "@/lib/serverCache.js";
import { getPythonApiUrl } from "@/lib/pythonApi";
import {
  fetchReportEvidenceMap,
  formatReportRemarksForEntry,
} from "@/lib/rating/pythonData";

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

      // 1. Fetch confirmed REVIEWED entries from PostgreSQL
      const dbEntries = await db.raceEntry.findMany({
        where: {
          race: { status: "REVIEWED" },
          decision: { isNot: null },
        },
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
      });

      const pythonApiUrl = getPythonApiUrl();
      const dbHorseNames = dbEntries.map((e) => e.horse?.name).filter(Boolean);
      const [evidenceRes, masterRes] = await Promise.all([
        fetchReportEvidenceMap(dbHorseNames, pythonApiUrl),
        fetch(`${pythonApiUrl}/api/master-records`, { cache: "no-store" })
          .then(async (r) => (r.ok ? { ok: true, data: await r.json() } : { ok: false }))
          .catch(() => ({ ok: false })),
      ]);

      const dbRows = dbEntries.map((e) => {
        const r = e.race;
        const h = e.horse;
        const rating = e.rating;
        const decision = e.decision;
        const finalChange = decision ? decision.finalChange : null;
        const finalRating = decision ? decision.finalRating : (h.currentRating ?? null);
        const isConfirmed = decision !== null && decision !== undefined;
        const raceIsoDate = r.raceDate.toISOString().slice(0, 10);
        const pyEvents = evidenceRes.byHorse.get(String(h.name || "").trim().toUpperCase()) || [];
        const pyRemarks = formatReportRemarksForEntry(pyEvents, raceIsoDate);

        return {
          id: e.id,
          venue: r.venue || "—",
          raceDate: raceIsoDate,
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
          starterReport: pyRemarks.starterRemark || "—",
          veterinaryReport: pyRemarks.veterinaryRemark || "—",
          incidentReport: pyRemarks.incidentRemark || "—",
          status: isConfirmed ? (decision.overridden ? "OVERRIDDEN" : "RATED") : "NOT_RATED",
          override: decision ? (decision.overridden ? "Yes" : "No") : "No",
          finalChange: finalChange !== null ? (finalChange > 0 ? `+${finalChange}` : String(finalChange)) : "—",
          reasonExplanation: decision?.overrideReason || (Array.isArray(rating?.reasons) ? rating.reasons.join("; ") : (rating?.reasons || "Approved recommendation")),
          finalRating: finalRating !== null ? finalRating : (h.currentRating !== null ? h.currentRating : "—"),
          recommendedRating: rating?.recommendedRating !== null && rating?.recommendedRating !== undefined ? rating.recommendedRating : (h.currentRating !== null ? h.currentRating : "—"),
          overridden: decision ? Boolean(decision.overridden) : false,
        };
      });

      // 2. Fetch all master Excel (BSM.xlsx) records from Python backend
      let masterRows = [];
      let masterOk = false;
      if (masterRes?.ok && masterRes.data?.success && Array.isArray(masterRes.data.rows)) {
        masterRows = masterRes.data.rows;
        masterOk = masterRows.length > 0;
      }

      const combinedRows = [...dbRows, ...masterRows];

      // 3. Build filter options across all MIS records (DB confirmed + BSM master)
      const venues = Array.from(new Set(combinedRows.map((r) => r.venue))).filter((v) => v && v !== "—");
      const dates = Array.from(new Set(combinedRows.map((r) => r.raceDate))).filter((d) => d && d !== "—").sort().reverse();
      const seasons = Array.from(new Set(combinedRows.map((r) => r.raceSeason))).filter((s) => s && s !== "—");
      const types = Array.from(
        new Set(combinedRows.map((r) => (String(r.raceType).toUpperCase() === "TERMS" ? "Terms" : "Handicap")))
      ).filter(Boolean);
      const categories = Array.from(
        new Set(
          combinedRows
            .filter((r) => !raceType || raceType === "ALL" || String(r.raceType).toUpperCase() === raceType.toUpperCase())
            .map((r) => r.raceCategory)
        )
      ).filter((c) => c && c !== "—").sort();
      const categoriesByType = {
        Handicap: Array.from(
          new Set(
            combinedRows
              .filter((r) => String(r.raceType).toUpperCase() === "HANDICAP")
              .map((r) => r.raceCategory)
          )
        ).filter((c) => c && c !== "—").sort(),
        Terms: Array.from(
          new Set(
            combinedRows
              .filter((r) => String(r.raceType).toUpperCase() === "TERMS")
              .map((r) => r.raceCategory)
          )
        ).filter((c) => c && c !== "—").sort(),
      };

      // 4. Filter combined rows
      const searchHorse = horseName ? horseName.trim().toLowerCase() : "";
      const filtered = combinedRows.filter((r) => {
        if (venue && venue !== "ALL" && r.venue !== venue) return false;
        if (raceDate && raceDate !== "ALL" && r.raceDate !== raceDate) return false;
        if (season && season !== "ALL" && r.raceSeason !== season) return false;
        if (raceType && raceType !== "ALL" && String(r.raceType).toUpperCase() !== raceType.toUpperCase()) return false;
        if (category && category !== "ALL" && r.raceCategory !== category) return false;
        if (searchHorse && !String(r.horseName).toLowerCase().includes(searchHorse)) return false;
        return true;
      });

      const totalCount = filtered.length;
      const start = (page - 1) * pageSize;
      const pagedRows = filtered.slice(start, start + pageSize);

      return {
        _skipCache: !masterOk || !evidenceRes.ok,
        filters: {
          venues,
          dates,
          seasons,
          types,
          categories,
          categoriesByType,
        },
        rows: pagedRows,
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
