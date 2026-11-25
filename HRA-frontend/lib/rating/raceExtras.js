// lib/rating/raceExtras.js
// Manages sidecar extras storage for current race files in data/race-extras/<uploadedFileId>.json
// Used because RaceEntry schema does not have a dedicated current rating column.
// Keyed by race date + race no + horse name.

import fs from "node:fs";
import path from "node:path";

const EXTRAS_DIR = path.resolve(process.cwd(), "data/race-extras");

function ensureDir() {
  if (!fs.existsSync(EXTRAS_DIR)) {
    fs.mkdirSync(EXTRAS_DIR, { recursive: true });
  }
}

/**
 * Generates key for a race entry: "YYYY-MM-DD_raceNo_HORSE NAME"
 */
export function getEntryKey(raceDate, raceNo, horseName) {
  let d = raceDate;
  if (d instanceof Date) {
    d = d.toISOString().slice(0, 10);
  } else if (typeof d === "string") {
    // If dd/mm/yyyy
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
 * Saves race extras for an uploaded file
 * @param {string|number} fileId
 * @param {object} data Map of entryKey -> { currat, weightcd, timing, placing, ... }
 */
export function saveRaceExtras(fileId, data) {
  ensureDir();
  const filePath = path.join(EXTRAS_DIR, `${fileId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Loads race extras for a specific uploaded file ID
 * @param {string|number} fileId
 * @returns {object|null}
 */
export function loadRaceExtras(fileId) {
  const filePath = path.join(EXTRAS_DIR, `${fileId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Finds the race extras entry matching a given race entry
 * Checks latest or matching JSON files in data/race-extras/
 * @param {object} params
 * @param {Date|string} params.raceDate
 * @param {number} params.raceNo
 * @param {string} params.horseName
 * @returns {object|null} { currat, weightcd, timing, placing }
 */
export function findRaceExtraEntry({ raceDate, raceNo, horseName }) {
  ensureDir();
  const key = getEntryKey(raceDate, raceNo, horseName);

  const files = fs
    .readdirSync(EXTRAS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  for (const f of files) {
    try {
      const content = JSON.parse(
        fs.readFileSync(path.join(EXTRAS_DIR, f), "utf8")
      );
      if (content && content[key] !== undefined) {
        return content[key];
      }
      if (content && content.entries && content.entries[key] !== undefined) {
        return content.entries[key];
      }
    } catch {
      // Continue searching next file
    }
  }

  return null;
}
