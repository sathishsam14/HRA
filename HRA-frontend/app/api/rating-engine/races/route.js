// app/api/rating-engine/races/route.js
// Fetches races and entries for the Rating Engine screen, with filtering support.

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";
import { findRaceExtraEntry } from "@/lib/rating/raceExtras";
import { getCachedData } from "@/lib/serverCache.js";
import { getPythonApiUrl } from "@/lib/pythonApi";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const cacheKey = searchParams.toString() || "default";

    const payload = await getCachedData("rating_races", cacheKey, async () => {
      const venueFilter = searchParams.get("venue");
      const dateFilter = searchParams.get("raceDate");
      const raceTypeFilter = searchParams.get("raceType");
      const raceNoFilter = searchParams.get("raceNo");
      const categoryFilter = searchParams.get("category");
      const distanceFilter = searchParams.get("distance");
      const statusFilter = searchParams.get("status");

      // 1. Fetch distinct filter options across races in DB (default: only OPEN races for current race day)
      const targetStatus = statusFilter && statusFilter !== "ALL" ? statusFilter : "OPEN";
      const allRaces = await db.race.findMany({
        where: statusFilter === "ALL" ? {} : { status: targetStatus },
        select: {
          venue: true,
          raceDate: true,
          raceNo: true,
          raceType: true,
          category: true,
          distance: true,
          status: true,
        },
        orderBy: [
          { raceDate: "asc" },
          { raceNo: "asc" },
        ],
      });

      const venues = Array.from(new Set(allRaces.map((r) => r.venue))).filter(Boolean);
      const dates = Array.from(
        new Set(allRaces.map((r) => r.raceDate.toISOString().slice(0, 10)))
      ).filter(Boolean).sort();
      const raceTypes = Array.from(new Set(allRaces.map((r) => (r.raceType === "TERMS" ? "Terms" : "Handicap")))).filter(Boolean);

      // The race list depends on the chosen date (Requirement 4)
      const racesForDate = dateFilter && dateFilter !== "ALL"
        ? allRaces.filter((r) => r.raceDate.toISOString().slice(0, 10) === dateFilter)
        : allRaces;
      const raceNos = Array.from(new Set(racesForDate.map((r) => r.raceNo))).sort((a, b) => a - b);

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
      } else if (statusFilter === "ALL" && allRaces.length > 0) {
        where.raceDate = allRaces[allRaces.length - 1].raceDate;
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
      if (statusFilter === "ALL") {
        // All statuses
      } else {
        where.status = targetStatus;
      }

      // 3. Fetch matching races with full runner details
      const races = await db.race.findMany({
        where,
        take: 200,
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
          { raceDate: "asc" },
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

          const raceExtra = findRaceExtraEntry({
            raceDate: race.raceDate,
            raceNo: race.raceNo,
            horseName: horse.name,
          });

          const raceCurrat = raceExtra?.currat != null ? Number(raceExtra.currat) : null;
          const masterRating = horse.currentRating != null ? Number(horse.currentRating) : null;
          const ratingDiffersFromMaster =
            masterRating != null && raceCurrat != null && masterRating !== raceCurrat;

          const startRating =
            raceCurrat ??
            (rating?.recommendedRating != null && rating?.recommendedChange != null
              ? rating.recommendedRating - rating.recommendedChange
              : masterRating);

          const isOverridden = decision ? decision.overridden : false;
          const finalChange = decision ? decision.finalChange : (rating?.recommendedChange ?? 0);
          const suggestedRating =
            startRating != null && rating?.recommendedChange != null
              ? startRating + rating.recommendedChange
              : (rating?.recommendedRating ?? null);
          const finalRating = decision
            ? decision.finalRating
            : (startRating != null ? startRating + finalChange : (rating?.recommendedRating ?? null));

          return {
            id: entry.id,
            entryId: entry.id,
            horseDbId: horse.id,
            horseId: horse.horseId || `HRS-${String(horse.id).padStart(6, "0")}`,
            horseName: horse.name || "Unknown Horse",
            sexCategory: horse.sexCategory || "—",
            previousRuns: horse.previousRuns ?? 0,
            currentRating: startRating,
            startRating: startRating,
            raceCurrat,
            masterRating,
            ratingDiffersFromMaster,
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
                ? [
                    entry.starterRemark ? `[Starter] ${entry.starterRemark}` : null,
                    entry.veterinaryRemark ? `[Vet] ${entry.veterinaryRemark}` : null,
                    entry.incidentRemark
                      ? (entry.incidentRemark.startsWith("[Stipe]") ? entry.incidentRemark : `[Incidents] ${entry.incidentRemark}`)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" | ")
                : "None",
            ratingStatus: rating?.status || "NOT_RATED",
            recommendedChange: rating?.recommendedChange ?? null,
            recommendedRating: rating?.recommendedRating ?? null,
            suggestedRating,
            reasons: cleanReasons,
            reasonsExplanation,
            overridden: isOverridden,
            overrideReason: decision?.overrideReason || null,
            finalChange,
            finalRating,
            decisionUser: decision?.user?.name || null,
            decidedAt: decision?.decidedAt ? decision.decidedAt.toISOString() : null,
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
          status: race.status,
          runnersCount: entries.length,
          entries,
        };
      });

      const activeRatingMode = "python";
      const activeRatingModeLabel = "Python ML Engine (BTC Model)";

      let masterDataReady = false;
      let masterEntries = 0;
      let trainingDateInfo = "";
      let modelSha256 = "";
      let reportEventsLoaded = 0;
      let useConfirmedRaces = true;
      try {
        const infoRes = await fetch(`${getPythonApiUrl()}/api/model-info`, { cache: "no-store" });
        if (infoRes.ok) {
          const info = await infoRes.json();
          masterDataReady = Boolean(info.master_data_loaded);
          masterEntries = info.master_entries || 0;
          modelSha256 = info.model_sha256 || "";
          reportEventsLoaded = info.report_events_loaded ?? 0;
          useConfirmedRaces = info.use_confirmed_races !== undefined ? Boolean(info.use_confirmed_races) : true;
          const ti = info.training_info || {};
          if (ti.min_date && ti.max_date && ti.min_date !== "N/A") {
            trainingDateInfo = ` · ${ti.min_date} to ${ti.max_date}`;
          }
        }
      } catch {
        // Backend status fallback
      }

      const shortHash = modelSha256 ? modelSha256.slice(0, 8) : "unknown";
      const patternInfo = {
        loaded: masterDataReady,
        modelSha256,
        reportEventsLoaded,
        useConfirmedRaces,
        summaryText: masterDataReady
          ? `Python ML Service: ${masterEntries.toLocaleString()} training rows${trainingDateInfo} · btc_rating_model.py ${shortHash} · Reports: ${reportEventsLoaded} events · USE_CONFIRMED_RACES=${useConfirmedRaces}`
          : "Python ML Service: Master data not loaded",
      };

      return {
        filters: {
          venues,
          dates,
          raceTypes,
          categories,
          categoriesByType,
          distances,
          raceNos,
        },
        ratingMode: activeRatingMode,
        ratingModeLabel: activeRatingModeLabel,
        patternInfo,
        masterDataReady,
        masterEntries,
        races: formattedRaces,
      };
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Failed to fetch rating engine races:", error);
    return NextResponse.json(
      { error: "Internal server error while fetching races" },
      { status: 500 }
    );
  }
}
