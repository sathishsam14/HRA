// lib/serverCache.js
// Ultra-fast in-memory cache for Rating Engine, Dashboard, and MIS endpoints.
// Checks the DB for new file uploads or decisions to invalidate and refresh.

import db from "./db.js";

const memoryCache = new Map();
let lastVersionCheck = 0;
let cachedDataVersion = "v_initial";

/**
 * Gets the current data version by checking latest UploadedFile and Decision in DB.
 * Memoized for 1.5 seconds to prevent DB overhead on concurrent requests.
 */
export async function getDataVersion() {
  const now = Date.now();
  if (now - lastVersionCheck < 1500 && cachedDataVersion !== "v_initial") {
    return cachedDataVersion;
  }

  try {
    const [fileStats, decisionStats, raceStats] = await Promise.all([
      db.uploadedFile.aggregate({
        _max: { id: true, uploadedAt: true },
        _count: { id: true },
      }),
      db.decision.aggregate({
        _max: { id: true, decidedAt: true },
        _count: { id: true },
      }),
      db.race.aggregate({
        _max: { id: true },
        _count: { id: true },
      }),
    ]);

    const maxFile = fileStats._max.id ?? 0;
    const fileCount = fileStats._count.id ?? 0;
    const maxDec = decisionStats._max.id ?? 0;
    const decCount = decisionStats._count.id ?? 0;
    const maxRace = raceStats._max.id ?? 0;
    const raceCount = raceStats._count.id ?? 0;

    cachedDataVersion = `v_${maxFile}_${fileCount}_${maxDec}_${decCount}_${maxRace}_${raceCount}`;
    lastVersionCheck = now;
    return cachedDataVersion;
  } catch (err) {
    console.warn("Could not determine DB data version for cache:", err.message);
    return `v_fallback_${Date.now()}`;
  }
}

/**
 * Retrieves data from memory cache if version matches; otherwise executes fetchFn and caches result.
 */
export async function getCachedData(namespace, paramsKey, fetchFn) {
  const currentVersion = await getDataVersion();
  const fullKey = `${namespace}::${paramsKey}`;

  const cached = memoryCache.get(fullKey);
  if (cached && cached.version === currentVersion) {
    return cached.data;
  }

  // Not in cache or stale version -> fetch from DB
  const freshData = await fetchFn();
  memoryCache.set(fullKey, {
    version: currentVersion,
    timestamp: Date.now(),
    data: freshData,
  });

  return freshData;
}

/**
 * Force invalidates the server cache.
 */
export function invalidateServerCache() {
  memoryCache.clear();
  lastVersionCheck = 0;
  cachedDataVersion = `v_${Date.now()}`;
}
