// lib/rating/staleCheck.js
// Determines whether ratings for open races (or a specific race) are stale
// by comparing the latest GENERATE_RATINGS AuditLog entry against the latest
// UploadedFile.uploadedAt for RACE, STARTER, VETERINARY, INCIDENT, and STIPE (ignoring MASTER).

import db from "../db.js";

export const RELEVANT_UPLOAD_TYPES = [
  "RACE",
  "STARTER",
  "VETERINARY",
  "INCIDENT",
  "STIPE",
];

/**
 * Checks whether ratings are stale for the given raceIds (or overall).
 * @param {number[]|null} raceIds
 * @returns {Promise<{ ratingsStale: boolean, lastUploadAt: string|null, lastGenerateAt: string|null }>}
 */
export async function getStaleRatingsStatus(raceIds = null) {
  const [latestUpload, genLogs] = await Promise.all([
    db.uploadedFile.findFirst({
      where: {
        fileType: { in: RELEVANT_UPLOAD_TYPES },
      },
      orderBy: { uploadedAt: "desc" },
      select: { uploadedAt: true, fileType: true },
    }),
    db.auditLog.findMany({
      where: { action: "GENERATE_RATINGS" },
      orderBy: { at: "desc" },
      take: 25,
      select: { at: true, after: true },
    }),
  ]);

  let matchingGen = null;
  if (Array.isArray(raceIds) && raceIds.length > 0) {
    const targetSet = new Set(raceIds.map((id) => Number(id)));
    for (const log of genLogs) {
      const ratedIds = Array.isArray(log.after?.raceIds)
        ? log.after.raceIds.map((id) => Number(id))
        : [];
      if (ratedIds.some((id) => targetSet.has(id))) {
        matchingGen = log;
        break;
      }
    }
  } else {
    matchingGen = genLogs[0] || null;
  }

  const lastUploadAt = latestUpload?.uploadedAt ?? null;
  const lastGenerateAt = matchingGen?.at ?? null;

  let ratingsStale = false;
  if (lastUploadAt) {
    if (!lastGenerateAt) {
      ratingsStale = true;
    } else if (lastUploadAt.getTime() > lastGenerateAt.getTime()) {
      ratingsStale = true;
    }
  }

  return {
    ratingsStale,
    lastUploadAt: lastUploadAt ? lastUploadAt.toISOString() : null,
    lastGenerateAt: lastGenerateAt ? lastGenerateAt.toISOString() : null,
  };
}
