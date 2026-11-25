// lib/rate.js
// HRA Rating Integration (Bangalore Turf Club)
// Delegates race rating to the dedicated Python Machine Learning backend (FastAPI / Scikit-Learn)
// and persists Rating records into PostgreSQL for the Next.js frontend.

import { db } from "./db.js";
import { findRaceExtraEntry } from "./rating/raceExtras.js";

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8000";

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
 * Executes rating logic by delegating to Python backend and persists Rating records for a single race.
 * Skips races whose status is REVIEWED.
 *
 * @param {number} raceId
 * @param {object} [tx] Optional Prisma transaction
 */
async function runRating(tx, raceId) {
  const race = await tx.race.findUnique({
    where: { id: raceId },
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
  });

  if (!race) {
    return { ok: false, reason: `Race with id ${raceId} not found` };
  }

  // Skip reviewed races: once reviewed by handicapper, automatic re-rating is locked
  if (race.status === "REVIEWED") {
    return { ok: false, skipped: true, reason: `Race ${raceId} is REVIEWED and locked from automatic rating` };
  }

  // Helper to split remarks by pipe delimiter
  const splitRemark = (s) => (s ? String(s).split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean) : []);

  // Prepare entrant data for Python backend
  const engineEntries = [];
  for (const entry of race.entries) {
    const raceExtra = findRaceExtraEntry({
      raceDate: race.raceDate,
      raceNo: race.raceNo,
      horseName: entry.horse.name,
    });

    const raceCurrat = raceExtra?.currat != null ? Number(raceExtra.currat) : null;
    const masterRating = entry.horse.currentRating != null ? Number(entry.horse.currentRating) : null;
    const currentRating = raceCurrat ?? masterRating ?? null;

    engineEntries.push({
      entry_id: entry.id,
      horse_name: entry.horse.name,
      current_rating: currentRating,
      placing: entry.placing ?? null,
      timing: raceExtra?.timing || entry.timing || null,
      verdict: entry.verdict ?? null,
      weight_carried: raceExtra?.weightcd != null ? Number(raceExtra.weightcd) : (entry.weightCarried ?? null),
      horse_weight: entry.horseWeight ?? null,
      shoes: entry.shoes || "A",
      gate: entry.startGate ?? null,
      jockey: entry.jockey ?? "Unknown",
      trainer: entry.trainer || entry.horse.trainer || "Unknown",
      starter_remark: splitRemark(entry.starterRemark).join(" | "),
      vet_remark: splitRemark(entry.veterinaryRemark).join(" | "),
      incident_remark: splitRemark(entry.incidentRemark).join(" | "),
    });
  }

  // Update raceType on Race if currently null
  const detectedType = raceType(race.category);
  if (detectedType && race.raceType !== detectedType) {
    await tx.race.update({
      where: { id: race.id },
      data: { raceType: detectedType },
    });
  }

  // Call Python Backend API
  let results = [];
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/predict-race`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue: race.venue,
        race_date: race.raceDate.toISOString().slice(0, 10),
        season: race.season || "2026-27",
        category: race.category,
        race_no: race.raceNo,
        distance: race.distance,
        entries: engineEntries,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.ratings)) {
        results = data.ratings.map((r) => ({
          status: r.status || "RATED",
          recommendedChange: r.recommended_change,
          recommendedRating: r.recommended_rating,
          reasons: [r.justification],
        }));
      }
    } else {
      console.warn(`[RATE] Python backend returned error status: ${response.status}`);
    }
  } catch (backendErr) {
    console.error(`[RATE] Could not reach Python backend at ${PYTHON_BACKEND_URL}:`, backendErr.message);
  }

  // Fallback if backend returned no results (safe defaults)
  if (results.length === 0) {
    for (const e of engineEntries) {
      results.push({
        status: e.placing != null ? "RATED" : "UNCHANGED",
        recommendedChange: 0,
        recommendedRating: e.current_rating,
        reasons: ["Pending Python backend calculation"],
      });
    }
  }

  // Upsert ratings into database for UI reflection
  for (let i = 0; i < race.entries.length; i++) {
    const entry = race.entries[i];
    const res = results[i];
    if (!res) continue;

    await tx.rating.upsert({
      where: { entryId: entry.id },
      update: {
        status: res.status,
        recommendedChange: res.recommendedChange,
        recommendedRating: res.recommendedRating,
        reasons: res.reasons,
      },
      create: {
        entryId: entry.id,
        status: res.status,
        recommendedChange: res.recommendedChange,
        recommendedRating: res.recommendedRating,
        reasons: res.reasons,
      },
    });
  }

  return {
    ok: true,
    raceId: race.id,
    raceRef: `${race.venue} Race ${race.raceNo}`,
    entriesRated: results.length,
    results,
  };
}

/**
 * Public function to rate and persist a race.
 */
export async function rateAndSaveRace(raceId, tx = null) {
  const client = tx || db;
  return runRating(client, raceId);
}

/**
 * Re-rates all open (non-REVIEWED) races.
 * Typically called after a COEFFICIENT upload.
 */
export async function reRateAllOpenRaces() {
  const openRaces = await db.race.findMany({
    where: { status: { not: "REVIEWED" } },
    select: { id: true },
  });

  const results = [];
  for (const r of openRaces) {
    try {
      const res = await rateAndSaveRace(r.id);
      results.push(res);
    } catch (err) {
      results.push({ ok: false, raceId: r.id, error: err.message });
    }
  }
  return results;
}
