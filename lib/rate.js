// lib/rate.js
// Rating engine transaction integration for HRA

import { db } from "./db.js";
import { rateRace, raceType } from "./rating-engine/index.js";
import { setCoefficients } from "./rating-engine/coefficients.js";

/**
 * Executes rating logic and persists Rating records for a single race.
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

  // 1. Load dynamic coefficients from database and configure rating engine (round ratingChange to integer points)
  const coeffRows = await tx.coefficient.findMany();
  setCoefficients(
    coeffRows.map((c) => ({
      category: c.category,
      distance: c.distance,
      ratingChange: c.ratingChange != null ? Math.round(Number(c.ratingChange)) : null,
    }))
  );

  // 2. Determine report availability from UploadedFile
  const processedFiles = await tx.uploadedFile.findMany({
    where: { status: "PROCESSED" },
    select: { fileType: true },
  });
  const fileTypes = new Set(processedFiles.map((f) => f.fileType));
  const reportsAvailable = {
    starter: fileTypes.has("STARTER"),
    veterinary: fileTypes.has("VETERINARY"),
    incident: fileTypes.has("INCIDENT"),
  };

  // Helper to split remarks by pipe delimiter
  const splitRemark = (s) => (s ? String(s).split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean) : []);

  // 3. Prepare engine input entries
  const engineEntries = [];
  for (const entry of race.entries) {
    // Query prior runs using Postgres previous_runs() helper
    let previousRuns = 0;
    try {
      const res = await tx.$queryRawUnsafe(
        `SELECT previous_runs($1::INT, $2::DATE) AS count`,
        entry.horse.id,
        race.raceDate
      );
      const dbRuns = res?.[0]?.count != null ? Number(res[0].count) : 0;
      previousRuns = Math.max(dbRuns, entry.horse.previousRuns ?? 0);
    } catch {
      previousRuns = entry.horse.previousRuns ?? 0;
    }

    // Query prior rating: look up horse's most recent rating prior to this race date
    let priorRating = null;
    try {
      // 1. Check previous race entries in the system before this race date
      const priorEntry = await tx.raceEntry.findFirst({
        where: {
          horseId: entry.horse.id,
          race: {
            raceDate: { lt: race.raceDate },
          },
        },
        include: {
          decision: { select: { finalRating: true } },
          rating: { select: { recommendedRating: true } },
        },
        orderBy: [
          { race: { raceDate: "desc" } },
          { race: { raceNo: "desc" } },
        ],
      });

      if (priorEntry) {
        priorRating = priorEntry.decision?.finalRating ?? priorEntry.rating?.recommendedRating ?? null;
      }

      // 2. If not found in RaceEntry, check master historical runs in horse_run
      if (priorRating == null) {
        const priorRuns = await tx.horseRun.findMany({
          where: {
            horsePk: entry.horse.id,
            runDate: { lt: race.raceDate },
            ratingText: { not: null },
          },
          orderBy: { runDate: "desc" },
          take: 1,
        });

        if (priorRuns.length > 0 && priorRuns[0].ratingText) {
          const txt = priorRuns[0].ratingText.trim();
          const match = txt.match(/^(\d+)/);
          if (match) {
            priorRating = parseInt(match[1], 10);
          }
        }
      }
    } catch (lookupErr) {
      console.warn(`Prior rating lookup warning for horse #${entry.horse.id}:`, lookupErr.message);
    }

    // Current rating: prior rating from master/history, or entry.currentRating, or horse.currentRating (null means unrated)
    const currentRating = priorRating ?? entry.currentRating ?? entry.horse.currentRating ?? null;
    const sexCategory = entry.horse.sexCategory ?? null;

    engineEntries.push({
      entryId: entry.id,
      horseId: entry.horse.id,
      horseName: entry.horse.name,
      currentRating,
      sexCategory,
      previousRuns,
      placing: entry.placing ?? null,
      weightCarried: entry.weightCarried ?? null,
      weightDeclared: entry.weightDeclare ?? null,
      starter: splitRemark(entry.starterRemark),
      veterinary: splitRemark(entry.veterinaryRemark),
      incident: splitRemark(entry.incidentRemark),
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

  // 4. Call rateRace
  const results = rateRace({
    category: race.category,
    distance: race.distance,
    entries: engineEntries,
    reportsAvailable,
  });

  // 5. Upsert ratings in single transaction
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
 * Public function to rate and persist a race inside a transaction.
 */
export async function rateAndSaveRace(raceId, tx = null) {
  if (tx) {
    return runRating(tx, raceId);
  }
  return db.$transaction(async (newTx) => {
    return runRating(newTx, raceId);
  });
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
