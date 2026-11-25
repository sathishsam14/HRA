// lib/reports/parseReports.js
// Word Document (.docx) Report Parser for Bangalore Turf Club (BTC)
// Parses STARTER, VETERINARY, INCIDENT, and STIPE reports using mammoth to HTML,
// identifies meeting dates and race numbers, filters harmless clinical notes,
// and links remarks to entrant horses in the corresponding race.

import mammoth from "mammoth";
import db from "../db.js";
import { rateMeeting } from "../rate.js";
import { readReportFile } from "./readReportFile.js";

export const MONTHS = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

export const HARMLESS_PHRASES = [
  "no abnormality",
  "trotting sound",
  "routine sample",
  "nad",
  "no abnormality was reported",
  "warned",
  "reprimanded",
];

export const EXTRA_FLAG_KEYWORDS = [
  "hanging",
  "lugging",
  "swerved",
  "did not raise a fluent gallop",
  "took no part",
  "lost many lengths",
  "lost few lengths",
  "slowly away",
  "fractious",
  "fly jump",
  "planted",
  "lame",
  "eiph",
  "bleeding",
  "clip injury",
  "cut injury",
  "abrasion",
  "bit injury",
  "left capped elbow",
  "interference",
  "bumping",
  "shifting in",
  "shifting out",
  "not given a clear run",
  "could not get a clear run",
];

export const CONSTANT_CONDITIONS = [
  "death",
  "ran riderless",
  "did not finish",
  "dropped the rider",
];

/**
 * Normalizes text to extract meeting date: dd/mm/yyyy or yyyy-mm-dd
 * Handles superscripts and inconsistent whitespace/punctuation.
 */
export function parseMeetingDate(rawHtmlOrText) {
  if (!rawHtmlOrText) return null;
  const clean = String(rawHtmlOrText)
    .replace(/<\/?(?:sup|sub)>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const m = clean.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)[,\s]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/i
  );
  if (!m) {
    // Fallback without weekday
    const m2 = clean.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/i
    );
    if (!m2) return null;
    const day = m2[1].padStart(2, "0");
    const month = MONTHS[m2[2].toLowerCase()];
    const year = m2[3];
    if (!month) return null;
    return `${year}-${month}-${day}`;
  }

  const day = m[2].padStart(2, "0");
  const month = MONTHS[m[3].toLowerCase()];
  const year = m[4];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Checks whether text contains harmless observations unless qualified by a flag/constant.
 */
export function isHarmlessRemark(text, flagKeywords = []) {
  if (!text) return true;
  const lower = String(text).toLowerCase();

  const hasFlag =
    flagKeywords.some((kw) => lower.includes(kw.toLowerCase())) ||
    CONSTANT_CONDITIONS.some((kw) => lower.includes(kw.toLowerCase()));

  if (hasFlag) return false;

  return HARMLESS_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * Calculates Levenshtein distance between two strings
 */
export function levenshteinDistance(a, b) {
  const s1 = String(a || "");
  const s2 = String(b || "");
  const matrix = Array.from({ length: s1.length + 1 }, () =>
    Array(s2.length + 1).fill(0)
  );

  for (let i = 0; i <= s1.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[s1.length][s2.length];
}

/**
 * Matches a candidate horse name against the race's horses:
 * 1. Exact match (case-insensitive)
 * 2. Levenshtein distance 1 if exactly one candidate matches
 */
export function matchHorseName(rawName, horsesInRace = []) {
  if (!rawName || !horsesInRace.length) return null;
  const target = String(rawName).toUpperCase().trim();

  // 1. Exact match
  const exact = horsesInRace.find((h) => h.name.toUpperCase().trim() === target);
  if (exact) return exact;

  // 2. Fuzzy match
  const fuzzy = horsesInRace.filter(
    (h) => levenshteinDistance(h.name.toUpperCase().trim(), target) <= 1
  );
  if (fuzzy.length === 1) return fuzzy[0];

  return null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const STOP_WORDS = new Set([
  "REPORTED", "WAS", "WERE", "IS", "HAD", "HAVE", "FOR", "TRAINED",
  "RIDER", "JOCKEY", "TRAINER", "CLUB", "STEWARDS", "STIPENDIARY",
  "METRES", "RACE", "PLATE", "TROPHY", "CUP", "MEMORIAL", "GRADE",
  "AFTER", "BEFORE", "DURING", "SOON", "ROUNDING", "APPROACHING",
  "PASSING", "ENTERING", "IN", "ON", "AT", "TO", "FROM", "WITH",
  "AND", "OR", "THE", "HIS", "HER", "ITS", "THAT", "HE", "SHE", "IT",
  "BANGALORE", "SUMMER", "WINTER", "MEETING", "DATE", "GOING", "PENETROMETER",
  "RAILING", "POSITION", "RUNNERS", "HORSES", "RATED", "YEARS", "OLD"
]);

export function cleanCandidateName(raw) {
  if (!raw) return null;
  const words = String(raw).trim().split(/\s+/);
  const valid = [];
  for (const w of words) {
    const cleanWord = w.replace(/[^A-Z]/g, "");
    if (!cleanWord || STOP_WORDS.has(cleanWord)) break;
    valid.push(cleanWord);
  }
  if (!valid.length || valid.length > 4) return null;
  const name = valid.join(" ");
  return name.length >= 3 ? name : null;
}

/**
 * Extracts candidate horse names from free-text paragraphs:
 * - UPPERCASE NAME (Jockey Name)
 * - the rider of UPPERCASE NAME
 * - b m / b c / b f / dk b m / ch f UPPERCASE NAME
 * - withdraw / withdrew / declared UPPERCASE NAME
 */
export function extractCandidateNames(text) {
  const candidates = new Set();
  const clean = String(text || "");

  // 1. HORSE NAME (Jockey / Rider)
  const bracketRegex = /\b([A-Z][A-Z\s'\-]{1,30}[A-Z])\s*\(([A-Za-z\s\.]+)\)/g;
  let m;
  while ((m = bracketRegex.exec(clean)) !== null) {
    const cleaned = cleanCandidateName(m[1]);
    if (cleaned) candidates.add(cleaned);
  }

  // 2. the rider of HORSE NAME
  const riderRegex = /\b(?:the\s+rider\s+of|mount)\s+([A-Z][A-Z\s'\-]{1,30}[A-Z])\b/gi;
  while ((m = riderRegex.exec(clean)) !== null) {
    const cleaned = cleanCandidateName(m[1]);
    if (cleaned) candidates.add(cleaned);
  }

  // 3. b m / b c / b f / ch m / gr f HORSE NAME
  const breedRegex = /\b(?:b\s+[mfcg]|ch\s+[mfcg]|dk\s+b\s+[mfcg]|b\s+g|gr\s+[mfcg])\s+([A-Z][A-Z\s'\-]{1,30}[A-Z])\b/gi;
  while ((m = breedRegex.exec(clean)) !== null) {
    const cleaned = cleanCandidateName(m[1]);
    if (cleaned) candidates.add(cleaned);
  }

  // 4. withdraw / declared HORSE NAME
  const actionRegex = /\b(?:withdraw|withdrew|withdrawn|declared)\s+([A-Z][A-Z\s'\-]{1,30}[A-Z])\b/gi;
  while ((m = actionRegex.exec(clean)) !== null) {
    const cleaned = cleanCandidateName(m[1]);
    if (cleaned) candidates.add(cleaned);
  }

  return Array.from(candidates);
}

/**
 * Pure parser that parses converted HTML and maps remarks against provided race entrants.
 */
export function parseReportContent({ html, reportType, getHorsesForRace, flagKeywords = [] }) {
  const linked = [];
  const unmatched = [];
  const allFlagKeywords = Array.from(
    new Set([...flagKeywords.map((k) => k.toLowerCase()), ...EXTRA_FLAG_KEYWORDS])
  );

  const regex = /<(p|h1|h2|h3|table)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  let currentDate = null;
  let currentRaceNo = null;

  while ((match = regex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const raw = match[2];
    const text = raw
      .replace(/<\/?(?:sup|sub)>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Meeting Date Heading check
    const d = parseMeetingDate(raw);
    if (d) {
      currentDate = d;
      currentRaceNo = null;
      continue;
    }

    // Race Heading check: e.g. "1st Race: 35. The Prince Khartoum Plate"
    const raceMatch = text.match(/^\s*(\d+)(?:st|nd|rd|th)?\s*Race\s*:\s*(\d+)/i);
    if (raceMatch && currentDate) {
      currentRaceNo = parseInt(raceMatch[2], 10);
      continue;
    }

    if (!currentDate || !currentRaceNo) continue;

    // Get entrants in this race from the callback
    const horsesInRace = getHorsesForRace(currentDate, currentRaceNo);
    if (!horsesInRace || !horsesInRace.length) continue;

    if (reportType === "VETERINARY" && tag === "table") {
      // Table rows: first column = horse, second column = finding
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      while ((trMatch = trRegex.exec(raw)) !== null) {
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const tds = [];
        let tdMatch;
        while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
          tds.push(
            tdMatch[1]
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          );
        }
        if (tds.length >= 2) {
          const rawHorseName = tds[0].toUpperCase().trim();
          const finding = tds[1].trim();

          if (isHarmlessRemark(finding, allFlagKeywords)) {
            continue;
          }

          const matchedHorse = matchHorseName(rawHorseName, horsesInRace);
          if (matchedHorse) {
            linked.push({
              date: currentDate,
              raceNo: currentRaceNo,
              horse: matchedHorse.name,
              horseId: matchedHorse.horseId,
              entryId: matchedHorse.entryId,
              remark: finding,
              type: reportType,
            });
          } else {
            unmatched.push({
              date: currentDate,
              raceNo: currentRaceNo,
              horse: rawHorseName,
              finding,
              type: reportType,
            });
          }
        }
      }
    } else if (tag !== "table") {
      if (!text || text.toLowerCase() === "level start") continue;

      // Starter / Incidence / Stipe paragraphs
      const candidateNames = extractCandidateNames(text);

      // Check candidates against horsesInRace
      let linkedAny = false;
      for (const horse of horsesInRace) {
        const horseRegex = new RegExp(`\\b${escapeRegex(horse.name)}\\b`, "i");
        if (horseRegex.test(text)) {
          if (!isHarmlessRemark(text, allFlagKeywords)) {
            linked.push({
              date: currentDate,
              raceNo: currentRaceNo,
              horse: horse.name,
              horseId: horse.horseId,
              entryId: horse.entryId,
              remark: text,
              type: reportType,
            });
            linkedAny = true;
          }
        }
      }

      // Record any detected candidate names that were not in the race
      for (const cand of candidateNames) {
        const matched = matchHorseName(cand, horsesInRace);
        if (!matched && !isHarmlessRemark(text, allFlagKeywords)) {
          unmatched.push({
            date: currentDate,
            raceNo: currentRaceNo,
            horse: cand,
            finding: text,
            type: reportType,
          });
        }
      }
    }
  }

  return { linked, unmatched };
}

/**
 * Loads ExceptionKeyword rows from database and parses an uploaded Word report.
 * Updates RaceEntry remark columns and triggers re-rating of affected open races.
 *
 * @param {object} params
 * @param {Buffer} params.buffer File buffer
 * @param {string} params.reportType "STARTER" | "VETERINARY" | "INCIDENT" | "STIPE"
 * @param {object} [params.tx] Optional Prisma transaction
 * @returns {Promise<object>}
 */
export async function processWordReport({ buffer, reportType, fileName = "report.docx", tx = null }) {
  const prisma = tx || db;

  // 1. Load flag keywords from ExceptionKeyword table
  const dbKeywords = await prisma.exceptionKeyword.findMany();
  const flagKeywords = dbKeywords.map((k) => k.text);

  // 2. Read report file into standardized HTML structure using readReportFile (.docx, .doc, .pdf, .txt, .xlsx, .xls, .csv)
  const { html, format } = await readReportFile({
    buffer,
    fileName,
    reportType,
  });

  // 3. Query all OPEN races and entrants from DB to create lookup cache (reports attach to Current/OPEN races only)
  const allRaces = await prisma.race.findMany({
    where: { status: "OPEN" },
    include: {
      entries: {
        include: { horse: true },
      },
    },
  });

  const raceLookup = new Map();
  for (const r of allRaces) {
    const dateStr = r.raceDate.toISOString().slice(0, 10);
    const key = `${dateStr}:${r.raceNo}`;
    raceLookup.set(
      key,
      r.entries.map((e) => ({
        entryId: e.id,
        horseId: e.horse.id,
        name: e.horse.name,
        raceId: r.id,
        raceStatus: r.status,
      }))
    );
  }

  const getHorsesForRace = (dateStr, raceNo) => {
    return raceLookup.get(`${dateStr}:${raceNo}`) || [];
  };

  // 4. Parse report content
  const { linked, unmatched } = parseReportContent({
    html,
    reportType,
    getHorsesForRace,
    flagKeywords,
  });

  // 5. Update RaceEntry remarks
  const affectedRaceIds = new Set();
  const linkedHorses = new Set();

  for (const item of linked) {
    linkedHorses.add(item.horse);
    const entry = await prisma.raceEntry.findUnique({
      where: { id: item.entryId },
      select: {
        id: true,
        raceId: true,
        starterRemark: true,
        veterinaryRemark: true,
        incidentRemark: true,
        race: { select: { status: true } },
      },
    });

    if (!entry || entry.race?.status === "REVIEWED") continue;
    affectedRaceIds.add(entry.raceId);

    const remarkText =
      item.type === "STIPE" ? `[Stipe] ${item.remark}` : item.remark;

    if (item.type === "STARTER") {
      const existing = entry.starterRemark;
      const updated = existing ? `${existing} | ${remarkText}` : remarkText;
      await prisma.raceEntry.update({
        where: { id: entry.id },
        data: { starterRemark: updated },
      });
    } else if (item.type === "VETERINARY") {
      const existing = entry.veterinaryRemark;
      const updated = existing ? `${existing} | ${remarkText}` : remarkText;
      await prisma.raceEntry.update({
        where: { id: entry.id },
        data: { veterinaryRemark: updated },
      });
    } else if (item.type === "INCIDENT" || item.type === "STIPE") {
      const existing = entry.incidentRemark;
      const updated = existing ? `${existing} | ${remarkText}` : remarkText;
      await prisma.raceEntry.update({
        where: { id: entry.id },
        data: { incidentRemark: updated },
      });
    }
  }

  // 6. Re-rate the whole open meeting once after report upload
  if (affectedRaceIds.size > 0) {
    try {
      await rateMeeting(prisma);
    } catch (err) {
      console.warn(`Auto re-rate warning after report upload:`, err.message);
    }
  }

  const uniqueUnmatchedNames = Array.from(
    new Set(unmatched.map((u) => u.horse.toUpperCase().trim()))
  );

  const summary = `${linked.length} remarks linked to ${linkedHorses.size} horses; ${uniqueUnmatchedNames.length} names not found in any race`;

  return {
    success: true,
    linkedCount: linked.length,
    horseCount: linkedHorses.size,
    unmatchedNames: uniqueUnmatchedNames,
    affectedRacesCount: affectedRaceIds.size,
    summary,
    format: format || "Word",
    linked,
    unmatched,
  };
}
