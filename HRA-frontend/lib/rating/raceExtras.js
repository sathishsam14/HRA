// lib/rating/raceExtras.js
// Manages extras storage (currat, weightcd, timing, placing) for current race files
// in PostgreSQL (AuditLog table, action = "RACE_EXTRAS") instead of local disk.
// Keyed by race date + race no + horse name: "YYYY-MM-DD_raceNo_HORSE NAME".

import db from "../db.js";

const RACE_EXTRAS_ACTION = "RACE_EXTRAS";

/**
 * Generates key for a race entry: "YYYY-MM-DD_raceNo_HORSE NAME"
 */
export function getEntryKey(raceDate, raceNo, horseName) {
  let d = raceDate;
  if (d instanceof Date) {
    d = d.toISOString().slice(0, 10);
  } else if (typeof d === "string") {
    if (d.includes("/")) {
      const parts = d.split("/");
      if (parts.length === 3) {
        d = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    } else {
      d = d.trim().slice(0, 10);
    }
  }
  const cleanHorse = String(horseName || "").trim().toUpperCase();
  return `${d}_${raceNo}_${cleanHorse}`;
}

/**
 * Saves race extras for an uploaded file in AuditLog (action = "RACE_EXTRAS").
 * @param {string|number} fileId
 * @param {object} data Map of entryKey -> { currat, weightcd, timing, placing, ... }
 * @param {object} [client] Optional Prisma client or transaction
 */
export async function saveRaceExtras(fileId, data, client = db) {
  try {
    await client.auditLog.create({
      data: {
        action: RACE_EXTRAS_ACTION,
        entity: "UploadedFile",
        entityId: String(fileId),
        after: data,
      },
    });
  } catch (err) {
    if (client !== db) {
      throw err;
    }
    console.warn("Could not save race extras to database:", err?.message || err);
  }
}

/**
 * Loads race extras for a specific uploaded file ID from AuditLog.
 * @param {string|number} fileId
 * @param {object} [client]
 * @returns {Promise<object|null>}
 */
export async function loadRaceExtras(fileId, client = db) {
  try {
    const row = await client.auditLog.findFirst({
      where: {
        action: RACE_EXTRAS_ACTION,
        entityId: String(fileId),
      },
      orderBy: { at: "desc" },
      select: { after: true },
    });
    return row?.after && typeof row.after === "object" ? row.after : null;
  } catch (err) {
    console.warn("Could not load race extras from database:", err?.message || err);
    return null;
  }
}

/**
 * Loads all saved race extras from AuditLog once per request and returns a fast lookup function.
 * Newest uploads take precedence for any given entry key.
 * @param {object} [client]
 * @returns {Promise<(params: { raceDate: Date|string, raceNo: number, horseName: string }) => object|null>}
 */
export async function loadRaceExtrasLookup(client = db) {
  const merged = new Map();
  try {
    const rows = await client.auditLog.findMany({
      where: { action: RACE_EXTRAS_ACTION },
      orderBy: { at: "desc" },
      select: { after: true },
    });

    for (const row of rows) {
      const content = row?.after;
      if (!content || typeof content !== "object") continue;
      const source =
        content.entries && typeof content.entries === "object"
          ? content.entries
          : content;
      for (const [k, v] of Object.entries(source)) {
        if (!merged.has(k) && v !== undefined) {
          merged.set(k, v);
        }
      }
    }
  } catch (err) {
    console.warn("Could not query race extras from database:", err?.message || err);
  }

  return function getRaceExtra({ raceDate, raceNo, horseName }) {
    const key = getEntryKey(raceDate, raceNo, horseName);
    return merged.get(key) ?? null;
  };
}

/**
 * Finds the race extras entry matching a given race entry from AuditLog.
 * @param {object} params
 * @param {Date|string} params.raceDate
 * @param {number} params.raceNo
 * @param {string} params.horseName
 * @param {object} [client]
 * @returns {Promise<object|null>} { currat, weightcd, timing, placing }
 */
export async function findRaceExtraEntry({ raceDate, raceNo, horseName }, client = db) {
  const lookup = await loadRaceExtrasLookup(client);
  return lookup({ raceDate, raceNo, horseName });
}
