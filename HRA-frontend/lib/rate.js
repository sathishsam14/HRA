// lib/rate.js
// HRA Rating Integration (Bangalore Turf Club)
// Delegates whole-meeting rating in one call to the Python Machine Learning backend (/api/predict-meeting)
// and persists Rating records into PostgreSQL for the Next.js frontend.

import { db } from "./db.js";
import { loadRaceExtrasLookup } from "./rating/raceExtras.js";
import { getPythonApiUrl } from "./pythonApi.js";

/**
 * Classifies race category into TERMS or HANDICAP.
 */
export function raceType(category) {
  const c = String(category ?? "").trim().toUpperCase();
  if (!c) return null;
  if (/TERMS|MAIDEN|CLASSIC|SWEEPSTAKES|DERBY|OAKS|GUINEAS|CUP|TROPHY|MILLION|PLATE|STAKES/i.test(c)) {
    return "TERMS";
  }
  return "HANDICAP";
}

/**
 * Validates and applies handicapper override.
 */
export function applyOverride(result, { finalChange, reason, userId, at = new Date() }) {
  if (!Number.isFinite(finalChange)) throw new Error("Override needs a final rating change");
  if (!reason || !String(reason).trim()) throw new Error("Override needs a reason");
  if (!userId) throw new Error("Override needs the user");
  const start = (result.recommendedRating ?? 0) - (result.recommendedChange ?? 0);
  return {
    ...result,
    override: { finalChange, reason: String(reason).trim(), userId, at },
    finalChange,
    finalRating: start + finalChange,
  };
}

/**
 * Rates the entire open meeting (all open races across all dates) in ONE call
 * to /api/predict-meeting, matching the client script's full-meeting feature engineering.
 *
 * @param {object} [tx] Optional Prisma client or transaction
 */
export async function rateMeeting(tx = null, userId = null) {
  const client = tx || db;

  const openRaces = await client.race.findMany({
    where: { status: { not: "REVIEWED" } },
    include: {
      entries: {
        include: {
          horse: true,
          rating: true,
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
      { id: "asc" },
    ],
  });

  if (openRaces.length === 0) {
    return { ok: true, racesRated: 0, entriesRated: 0, results: [] };
  }

  const meetingEntries = [];
  const entryMap = new Map();
  const getRaceExtra = await loadRaceExtrasLookup(client);

  for (const race of openRaces) {
    const detectedType = raceType(race.category);
    if (detectedType && race.raceType !== detectedType) {
      await client.race.update({
        where: { id: race.id },
        data: { raceType: detectedType },
      });
    }

    const raceDateStr = race.raceDate.toISOString().slice(0, 10);

    for (const entry of race.entries) {
      const raceExtra = getRaceExtra({
        raceDate: race.raceDate,
        raceNo: race.raceNo,
        horseName: entry.horse.name,
      });

      const raceCurrat = raceExtra?.currat != null ? Number(raceExtra.currat) : null;
      const masterRating = entry.horse.currentRating != null ? Number(entry.horse.currentRating) : null;
      const currentRating = raceCurrat ?? masterRating ?? null;

      entryMap.set(entry.id, { entry, currentRating });

      meetingEntries.push({
        entry_id: entry.id,
        race_id: race.id,
        racedate: raceDateStr,
        season: race.season || "2026-27",
        category: race.category,
        raceno: race.raceNo,
        distance: race.distance,
        currat: currentRating,
        horse_name: entry.horse.name,
        horse_weight: entry.horseWeight ?? null,
        shoes: entry.shoes || "A",
        gate: entry.startGate ?? null,
        jockey: entry.jockey ?? "Unknown",
        placing: entry.placing ?? null,
        timing: raceExtra?.timing || entry.timing || null,
        verdict: entry.verdict ?? null,
        trainer: entry.trainer || entry.horse.trainer || "Unknown",
        penetrometer: entry.penetrometer ?? null,
        railing: entry.railing ?? null,
      });
    }
  }

  let ratings = [];
  const pythonApiUrl = getPythonApiUrl();
  try {
    const response = await fetch(`${pythonApiUrl}/api/predict-meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: meetingEntries }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.ratings)) {
        ratings = data.ratings;
      }
    } else {
      console.warn(`[RATE] Python backend /api/predict-meeting returned status: ${response.status}`);
    }
  } catch (backendErr) {
    console.error(`[RATE] Could not reach Python backend at ${pythonApiUrl}:`, backendErr.message);
  }

  if (ratings.length === 0) {
    for (const e of meetingEntries) {
      ratings.push({
        entry_id: e.entry_id,
        status: e.placing != null ? "RATED" : "UNCHANGED",
        recommended_change: 0,
        recommended_rating: e.currat,
        justification: "Pending Python backend calculation",
      });
    }
  }

  for (const r of ratings) {
    if (r.entry_id == null) continue;
    const status = r.status || "RATED";
    const recommendedChange = r.recommended_change ?? 0;
    const recommendedRating = r.recommended_rating ?? null;
    const reasons = [r.justification || ""];

    await client.rating.upsert({
      where: { entryId: r.entry_id },
      update: {
        status,
        recommendedChange,
        recommendedRating,
        reasons,
      },
      create: {
        entryId: r.entry_id,
        status,
        recommendedChange,
        recommendedRating,
        reasons,
      },
    });
  }

  await client.auditLog.create({
    data: {
      action: "GENERATE_RATINGS",
      entity: "Race",
      entityId: openRaces.map((r) => r.id).join(","),
      userId: typeof userId === "number" ? userId : null,
      after: {
        raceIds: openRaces.map((r) => r.id),
        racesRated: openRaces.length,
        entriesRated: ratings.length,
      },
    },
  });

  return {
    ok: true,
    racesRated: openRaces.length,
    entriesRated: ratings.length,
    results: ratings,
  };
}

export async function reRateAllOpenRaces(tx = null, userId = null) {
  return rateMeeting(tx, userId);
}
