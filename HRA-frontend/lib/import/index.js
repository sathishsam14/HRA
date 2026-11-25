// lib/import/index.js
// Multi-format high-performance ingestion engine for HRA (Horse Rating Automation).
// Supported file types: ACTIVE_HORSE, MASTER, HISTORY, RACE, STARTER, VETERINARY, INCIDENT.
// Validates file signatures, data types, mandatory fields, prevents duplicates by size + SHA-256 hash,
// saves accepted files in uploads/, and applies all bulk updates in high-efficiency batch queries with AuditLog.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import unzipper from "unzipper";
import mammoth from "mammoth";
import db from "../db.js";
import { raceType } from "../rate.js";
import { rateAndSaveRace, reRateAllOpenRaces } from "../rate.js";
import { normalizeHeader, HEADER_ALIASES, matchHeaderKey } from "./aliases.js";
import { processWordReport } from "../reports/parseReports.js";
import { saveRaceExtras, getEntryKey } from "../rating/raceExtras.js";

export { normalizeHeader, HEADER_ALIASES, matchHeaderKey };

// ─── Value Sanitization & Parsing ─────────────────────────────────────────────

export function cleanString(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && val.text) val = val.text;
  const s = String(val).trim();
  if (s === "" || s.toUpperCase() === "WDR" || s === "-999" || s === "*" || s === "*-*") {
    return null;
  }
  return s;
}

export function cleanInt(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    if (val === -999 || isNaN(val)) return null;
    return Math.round(val);
  }
  const s = String(val).trim();
  if (s === "" || s.toUpperCase() === "WDR" || s === "-999" || s === "*" || s === "*-*") {
    return null;
  }
  const parsed = parseInt(s, 10);
  return isNaN(parsed) ? null : parsed;
}

export function cleanFloat(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    if (val === -999 || isNaN(val)) return null;
    return val;
  }
  const s = String(val).trim();
  if (s === "" || s.toUpperCase() === "WDR" || s === "-999" || s === "*" || s === "*-*") {
    return null;
  }
  if (s.includes("/")) {
    const parts = s.split("/");
    const num = parseFloat(parts[0]);
    return isNaN(num) ? null : num;
  }
  const parsed = parseFloat(s);
  return isNaN(parsed) ? null : parsed;
}

export function parseRaceDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return new Date(Date.UTC(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate()));
  }
  if (typeof val === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = val * 86400000;
    const d = new Date(excelEpoch.getTime() + ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const str = String(val).trim();
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    return new Date(Date.UTC(year, month, day));
  }
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(Date.UTC(year, month, day));
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }
  return null;
}

// ─── Horse ID Sequence Generator ──────────────────────────────────────────────

async function getMaxHorseNumber(tx) {
  const lastHorse = await tx.horse.findFirst({
    where: { horseId: { startsWith: "HRS-" } },
    orderBy: { horseId: "desc" },
    select: { horseId: true },
  });
  if (!lastHorse?.horseId) return 0;
  const match = lastHorse.horseId.match(/HRS-(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function formatHorseId(num) {
  return `HRS-${String(num).padStart(6, "0")}`;
}

// ─── Fast Streaming Shared Strings Extractor ──────────────────────────────────

async function extractSharedStrings(buffer) {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const file = directory.files.find((d) => d.path === "xl/sharedStrings.xml");
    if (!file) return [];
    const content = (await file.buffer()).toString("utf8");
    const strings = [];
    const re = /<si>(.*?)<\/si>/gs;
    let m;
    while ((m = re.exec(content)) !== null) {
      const tMatches = m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs);
      let s = "";
      for (const tm of tMatches) s += tm[1];
      strings.push(
        s
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      );
    }
    return strings;
  } catch {
    return [];
  }
}

// ─── Fast Workbook Sheets Metadata Extractor ──────────────────────────────────

async function extractWorkbookSheets(buffer) {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const file = directory.files.find((d) => d.path === "xl/workbook.xml");
    if (!file) return [];
    const content = (await file.buffer()).toString("utf8");
    const sheetMatches = [...content.matchAll(/<sheet\s+([^>]*)\/?>/gi)];
    return sheetMatches.map((m, idx) => {
      const attrs = m[1];
      const nameMatch = attrs.match(/name="([^"]*)"/i);
      const sheetIdMatch = attrs.match(/sheetId="([^"]*)"/i);
      const rIdMatch = attrs.match(/r:id="([^"]*)"/i);
      let name = nameMatch ? nameMatch[1] : `Sheet${idx + 1}`;
      name = name
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      return {
        position: idx,
        name,
        sheetId: sheetIdMatch ? sheetIdMatch[1] : String(idx + 1),
        rId: rIdMatch ? rIdMatch[1] : "",
      };
    });
  } catch {
    return [];
  }
}

// ─── Streaming Excel Rows Parser (.xlsx, .xls) ────────────────────────────────
// Reads ONLY the first sheet by position in the workbook. Ignores all other sheets.

async function parseExcelRows(buffer) {
  const sharedStrings = await extractSharedStrings(buffer);
  const sheets = await extractWorkbookSheets(buffer);
  const targetSheet = sheets.length > 0 ? sheets[0] : null;
  const targetSheetName = targetSheet ? targetSheet.name : null;
  const targetSheetId = targetSheet ? targetSheet.sheetId : null;
  const sheetsSkipped = sheets.length > 1 ? sheets.slice(1).map((s) => s.name) : [];

  const tmpPath = path.join(os.tmpdir(), `hra_stream_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmpPath, buffer);

  let headerRowIndex = -1;
  let headerMap = {};
  const rows = [];
  let sheetNameUsed = targetSheetName || "Sheet1";
  let streamingSucceeded = false;

  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(tmpPath, {
      sharedStrings: "ignore",
      worksheets: "emit",
    });
    reader.model = { sheets: [] };

    for await (const worksheet of reader) {
      // 1. Take ONLY the first worksheet of the workbook by position, not by name
      const isFirstSheet = targetSheet
        ? (String(worksheet.id) === String(targetSheetId) || worksheet.name === targetSheetName)
        : true;

      if (!isFirstSheet) {
        continue;
      }

      sheetNameUsed = worksheet.name || targetSheetName || "Sheet1";

      for await (const row of worksheet) {
        const rowNumber = row.number;
        if (headerRowIndex !== -1 && rowNumber <= headerRowIndex) continue;

        const cellValues = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          let val = cell.value;
          if (val && typeof val === "object") {
            if ("sharedString" in val && sharedStrings[val.sharedString] !== undefined) {
              val = sharedStrings[val.sharedString];
            } else if (val.result !== undefined) {
              val = val.result;
            } else if (val.text !== undefined) {
              val = val.text;
            }
          }
          cellValues[colNumber] = val;
        });

        if (headerRowIndex === -1) {
          if (rowNumber > 10) continue;
          const detected = {};
          let matchedCount = 0;
          for (const [colStr, val] of Object.entries(cellValues)) {
            const colNumber = parseInt(colStr, 10);
            const key = matchHeaderKey(val);
            if (key) {
              detected[colNumber] = key;
              matchedCount++;
            }
          }
          if (matchedCount >= 2) {
            headerRowIndex = rowNumber;
            headerMap = detected;
          }
          continue;
        }

        let hasData = false;
        const rowData = {};
        const rawData = {};
        for (const [colStr, val] of Object.entries(cellValues)) {
          const colNumber = parseInt(colStr, 10);
          const key = headerMap[colNumber];
          if (val !== null && val !== undefined && String(val).trim() !== "") {
            hasData = true;
          }
          if (key) {
            rowData[key] = val;
            rawData[key] = val;
          }
        }

        if (hasData) {
          rows.push({
            rowNumber,
            data: rowData,
            raw: rawData,
          });
        }
      }

      streamingSucceeded = true;
      break; // Stop after first sheet: do NOT loop over all sheets and do NOT use the last sheet
    }
  } catch (streamErr) {
    console.warn(`[PARSER:EXCEL] Streaming reader error (${streamErr.message}), falling back to in-memory workbook reader...`);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }

  // ── Fallback Reader (when streaming fails) ──
  if (!streamingSucceeded) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (!wb.worksheets || wb.worksheets.length === 0) {
      throw new Error("Validation failed: Workbook contains no worksheets.");
    }

    // Take ONLY the first worksheet of the workbook by position, not by name
    const worksheet = wb.worksheets[0];
    sheetNameUsed = worksheet.name;
    const fallbackSkipped = wb.worksheets.slice(1).map((w) => w.name);
    if (fallbackSkipped.length > 0) {
      sheetsSkipped.length = 0;
      sheetsSkipped.push(...fallbackSkipped);
    }

    headerRowIndex = -1;
    headerMap = {};
    rows.length = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (headerRowIndex !== -1 && rowNumber <= headerRowIndex) return;

      const cellValues = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        if (val && typeof val === "object") {
          if (val.result !== undefined) val = val.result;
          else if (val.text !== undefined) val = val.text;
        }
        cellValues[colNumber] = val;
      });

      if (headerRowIndex === -1) {
        if (rowNumber > 10) return;
        const detected = {};
        let matchedCount = 0;
        for (const [colStr, val] of Object.entries(cellValues)) {
          const colNumber = parseInt(colStr, 10);
          const key = matchHeaderKey(val);
          if (key) {
            detected[colNumber] = key;
            matchedCount++;
          }
        }
        if (matchedCount >= 2) {
          headerRowIndex = rowNumber;
          headerMap = detected;
        }
        return;
      }

      let hasData = false;
      const rowData = {};
      const rawData = {};
      for (const [colStr, val] of Object.entries(cellValues)) {
        const colNumber = parseInt(colStr, 10);
        const key = headerMap[colNumber];
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          hasData = true;
        }
        if (key) {
          rowData[key] = val;
          rawData[key] = val;
        }
      }

      if (hasData) {
        rows.push({
          rowNumber,
          data: rowData,
          raw: rawData,
        });
      }
    });
  }

  // 2. Log the sheet name used, the sheets skipped, and the number of data rows read
  const skippedDesc = sheetsSkipped.length > 0 ? sheetsSkipped.join(", ") : "none";
  console.log(`📋 [PARSER:EXCEL] Sheet used: "${sheetNameUsed}". Sheets skipped: [${skippedDesc}]. Data rows read: ${rows.length}.`);

  // 3. If the first sheet has no data rows, fail with a clear message instead of reading another sheet
  if (rows.length === 0) {
    throw new Error(`Validation failed: The first sheet "${sheetNameUsed}" contains no data rows.`);
  }

  return {
    headers: Object.values(headerMap),
    rows,
    sheetName: sheetNameUsed,
    skippedSheets: sheetsSkipped,
  };
}

// ─── Word & PDF Document Parsers ──────────────────────────────────────────────

async function parseDocxReport(buffer) {
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  let rowNumber = 1;

  for (const line of lines) {
    const parts = line.split(/[,\t|]+/).map((s) => s.trim());
    if (parts.length < 3) continue;

    let raceDate = null;
    let raceNo = null;
    let horseName = null;
    let remark = null;

    for (const part of parts) {
      if (!raceDate && parseRaceDate(part)) {
        raceDate = part;
      } else if (!raceNo && /^\d+$/.test(part)) {
        raceNo = parseInt(part, 10);
      } else if (!horseName && part.length > 1 && !/^\d+$/.test(part)) {
        horseName = part;
      } else if (!remark && part.length > 2) {
        remark = part;
      }
    }

    if (parts.length >= 4) {
      remark = parts.slice(3).join(" ");
    }

    if (horseName && remark) {
      rows.push({
        rowNumber: rowNumber++,
        data: {
          raceDate,
          raceNo,
          horseName,
          remark,
        },
        raw: { raceDate, raceNo, horseName, remark },
      });
    }
  }

  return { headers: ["raceDate", "raceNo", "horseName", "remark"], rows };
}

async function parsePdfReport(buffer) {
  let text = "";
  try {
    const pdfParseMod = eval('require("pdf-parse")');
    const PDFParser = pdfParseMod.PDFParse || pdfParseMod;
    if (typeof PDFParser === "function") {
      try {
        const parser = new PDFParser({ autoDetect: true });
        const data = await parser.parse(buffer);
        text = data?.text || "";
      } catch {
        const data = await PDFParser(buffer);
        text = data?.text || "";
      }
    }
  } catch (err) {
    console.warn("PDF parsing fallback:", err?.message);
    text = buffer.toString("latin1").replace(/[^\x20-\x7E\n]/g, " ");
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  let rowNumber = 1;

  for (const line of lines) {
    const match = line.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d+)\s+([A-Za-z\s'.]+?)\s{2,}(.+)$/);
    if (match) {
      rows.push({
        rowNumber: rowNumber++,
        data: {
          raceDate: match[1],
          raceNo: parseInt(match[2], 10),
          horseName: match[3].trim(),
          remark: match[4].trim(),
        },
        raw: {
          raceDate: match[1],
          raceNo: match[2],
          horseName: match[3],
          remark: match[4],
        },
      });
    }
  }

  return { headers: ["raceDate", "raceNo", "horseName", "remark"], rows };
}

// ─── Streaming Active Horse Report Parser ─────────────────────────────────────
// Layout for every horse:
// 1. Horse name row (horse name in first non-empty cell).
// 2. "Starts" row (accepts "Starts" or "tarts", case-insensitive) - SKIP.
// 3. Values under Starts - SKIP.
// 4. Column headers row (Race, Bkodds, Place, etc.) - SKIP.
// 5. Run rows: one row per race the horse ran - COUNT these rows only.
// 6. An EMPTY row ends the horse runs (or at the next block start).
// Validates date in date column. Ignores Place and Bkodds columns.
// Deduplicates on horse + run date + race reference.

async function parseActiveHorseFile(buffer) {
  const sharedStrings = await extractSharedStrings(buffer);
  const tmpPath = path.join(os.tmpdir(), `hra_active_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmpPath, buffer);

  const rawRows = [];
  let streamingSucceeded = false;

  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(tmpPath, {
      sharedStrings: "ignore",
      worksheets: "emit",
    });
    reader.model = { sheets: [] };

    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        const cells = {};
        let firstVal = null;
        let hasVal = false;
        row.eachCell({ includeEmpty: true }, (c, colNumber) => {
          let v = c.value;
          if (v && typeof v === "object") {
            if ("sharedString" in v && sharedStrings[v.sharedString] !== undefined) {
              v = sharedStrings[v.sharedString];
            } else if (v.result !== undefined) {
              v = v.result;
            } else if (v.text !== undefined) {
              v = v.text;
            }
          }
          if (v !== null && v !== undefined && String(v).trim() !== "") {
            hasVal = true;
            cells[colNumber] = v;
            if (firstVal === null) firstVal = v;
          }
        });
        rawRows.push({ rowNumber: row.number, cells, isEmpty: !hasVal, firstVal });
      }
      streamingSucceeded = true;
      break; // Only first worksheet
    }
  } catch (streamErr) {
    console.warn(`[PARSER:ACTIVE_HORSE] Streaming reader error (${streamErr.message}), falling back to in-memory workbook reader...`);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }

  // Fallback to in-memory workbook if streaming fails
  if (!streamingSucceeded || rawRows.length === 0) {
    rawRows.length = 0;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const worksheet = wb.worksheets[0];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells = {};
      let firstVal = null;
      let hasVal = false;
      row.eachCell({ includeEmpty: true }, (c, colNumber) => {
        let v = c.value;
        if (v && typeof v === "object") {
          if (v.result !== undefined) v = v.result;
          else if (v.text !== undefined) v = v.text;
        }
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          hasVal = true;
          cells[colNumber] = v;
          if (firstVal === null) firstVal = v;
        }
      });
      rawRows.push({ rowNumber, cells, isEmpty: !hasVal, firstVal });
    });
  }

  // 1. Detect all "Starts" / "tarts" rows
  const startsIndices = [];
  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    if (!row.isEmpty) {
      let isStarts = false;
      for (const c of Object.values(row.cells)) {
        const text = String(c || "").trim().toLowerCase();
        if (text === "starts" || text === "tarts") {
          isStarts = true;
          break;
        }
      }
      if (isStarts) {
        startsIndices.push(idx);
      }
    }
  }

  const startsSet = new Set(startsIndices);
  const horses = [];
  const allRuns = [];
  const distinctRunsMap = new Map();

  // 2. Parse horse blocks
  for (let sIdx = 0; sIdx < startsIndices.length; sIdx++) {
    const startsRowPos = startsIndices[sIdx];
    const nextStartsRowPos = sIdx + 1 < startsIndices.length ? startsIndices[sIdx + 1] : rawRows.length;

    // Detect block start: horse name is the row above "Starts" (first non-empty cell above it)
    let horsePos = startsRowPos - 1;
    let horseName = null;
    while (horsePos >= 0) {
      if (!rawRows[horsePos].isEmpty && rawRows[horsePos].firstVal) {
        horseName = String(rawRows[horsePos].firstVal).trim();
        break;
      }
      horsePos--;
    }

    if (!horseName) continue;

    const horseRuns = [];
    const horseObj = { name: horseName, runs: horseRuns };
    horses.push(horseObj);

    // Layout:
    // horseName at horsePos
    // startsRowPos: "Starts" (SKIP)
    // startsRowPos + 1: values under Starts (SKIP)
    // startsRowPos + 2: column header row (SKIP)
    // startsRowPos + 3: run rows start
    let runPos = startsRowPos + 3;

    while (runPos < nextStartsRowPos) {
      const r = rawRows[runPos];
      if (r.isEmpty) {
        // An EMPTY row ends the horse runs
        break;
      }

      // Or at the next block start if there is no empty row
      if (startsSet.has(runPos + 1) || startsSet.has(runPos + 2)) {
        break;
      }

      // Each run row must have a valid date in the date column
      const dateVal = r.cells[1];
      const runDate = parseRaceDate(dateVal);
      if (!runDate) {
        console.log(`[INVALID DATE] Row ${r.rowNumber} in run block for "${horseName}" has no valid date: "${dateVal}"`);
        runPos++;
        continue;
      }

      const raceRef = String(r.cells[2] || "").trim();
      const category = r.cells[3] ? String(r.cells[3]).trim() : null;
      const distance = r.cells[4] ? parseInt(r.cells[4], 10) || null : null;
      const weightCarried = r.cells[5] ? String(r.cells[5]).trim() : null;
      const equipment = r.cells[6] ? String(r.cells[6]).trim() : null;
      const jockey = r.cells[7] ? String(r.cells[7]).trim() : null;
      const horseWeight = r.cells[9] ? parseFloat(r.cells[9]) || null : null;
      const ratingText = r.cells[11] ? String(r.cells[11]).trim() : null;

      let timeText = null;
      const timeVal = r.cells[12];
      if (timeVal instanceof Date) {
        const m = String(timeVal.getUTCMinutes()).padStart(2, "0");
        const s = String(timeVal.getUTCSeconds()).padStart(2, "0");
        const ms = String(timeVal.getUTCMilliseconds()).padStart(3, "0").slice(0, 2);
        timeText = `${m}:${s}.${ms}`;
      } else if (timeVal !== null && timeVal !== undefined) {
        timeText = String(timeVal).trim();
      }

      const penetrometer = r.cells[15] ? parseFloat(r.cells[15]) || null : null;
      const shoes = r.cells[16] ? String(r.cells[16]).trim() : null;

      const runItem = {
        horseName,
        runDate,
        raceRef,
        category,
        distance,
        weightCarried,
        equipment,
        jockey,
        horseWeight,
        ratingText,
        timeText,
        penetrometer,
        shoes,
      };

      horseRuns.push(runItem);
      allRuns.push(runItem);

      // Deduplicate only on horse + run date + race reference
      const dedupeKey = `${horseName.toUpperCase()}|${runDate.toISOString().slice(0, 10)}|${raceRef}`;
      if (!distinctRunsMap.has(dedupeKey)) {
        distinctRunsMap.set(dedupeKey, runItem);
      }

      runPos++;
    }
  }

  const distinctRuns = Array.from(distinctRunsMap.values());
  const fewerThan3 = horses.filter((h) => (h.runs?.length || 0) < 3).length;

  // Log: horses found, run rows read, distinct runs, and the number of horses with fewer than 3 runs
  console.log(
    `📋 [PARSER:ACTIVE_HORSE] Horses found: ${horses.length}, Run rows read: ${allRuns.length}, Distinct runs: ${distinctRuns.length}, Horses with <3 runs: ${fewerThan3}`
  );

  return {
    horses,
    allRuns,
    distinctRuns,
  };
}

// ─── File Classification Checker ──────────────────────────────────────────────

function checkFileFormatMatchesType(fileType, parsed, fileName) {
  const headers = parsed.headers || [];

  if (fileType === "ACTIVE_HORSE") {
    if (headers.includes("venue") && headers.includes("distance") && headers.includes("raceCategory")) {
      return { matches: false, detectedType: headers.includes("changeRating") ? "HISTORY" : "RACE" };
    }
    return { matches: true };
  }

  if (fileType === "MASTER") {
    if (headers.includes("venue") && headers.includes("distance")) {
      return { matches: false, detectedType: headers.includes("changeRating") ? "HISTORY" : "RACE" };
    }
    if (headers.includes("starterRemark") || headers.includes("veterinaryRemark") || headers.includes("incidentRemark")) {
      return { matches: false, detectedType: "REPORT" };
    }
    if (!headers.includes("horseName") && !headers.includes("sexCategory")) {
      return { matches: false, detectedType: "UNKNOWN" };
    }
    return { matches: true };
  }

  if (fileType === "RACE") {
    if (headers.includes("changeRating")) {
      return { matches: false, detectedType: "HISTORY" };
    }
    return { matches: true };
  }

  if (fileType === "HISTORY") {
    return { matches: true };
  }

  if (["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
    if (headers.includes("venue") && headers.includes("distance") && headers.includes("raceCategory")) {
      return { matches: false, detectedType: "RACE" };
    }
    return { matches: true };
  }

  return { matches: true };
}

// ─── Main Ingestion Entry Point ───────────────────────────────────────────────

export async function importFile({ fileName, buffer, fileType, uploadedBy, source = "UPLOAD" }) {
  const t0 = Date.now();

  if (!buffer || buffer.length === 0) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: "Uploaded file is empty" }],
      unmatched: [],
      message: "Validation failed: File is empty.",
    };
  }

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const size = buffer.length;

  // Duplicate check: bypassed for RACE and report files to allow replacing previous uploads
  if (fileType !== "RACE" && !["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
    const existingFile = await db.uploadedFile.findFirst({
      where: {
        size,
        hash,
      },
    });

    if (existingFile) {
      console.log(`ℹ️ [IMPORT:${fileType}] Duplicate file detected (size: ${size}, hash: ${hash.slice(0, 8)}..., previously "${existingFile.name}"). Skipped.`);
      return {
        success: true,
        skipped: true,
        savedRows: 0,
        rejectedRows: 0,
        errors: [],
        unmatched: [],
        fileId: existingFile.id,
        message: `File with identical size (${size} bytes) and SHA-256 hash has already been uploaded (as "${existingFile.name}"). Skipped.`,
      };
    }
  }

  // Handle Master History (the BSM file): Python backend owns the master & retraining
  if (fileType === "HISTORY" || fileType === "MASTER") {
    const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8000";
    try {
      const formData = new FormData();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      formData.append("file", blob, fileName);

      const pyRes = await fetch(`${PYTHON_BACKEND_URL}/api/upload-master`, {
        method: "POST",
        body: formData,
      });

      if (!pyRes.ok) {
        throw new Error(`Python backend master upload failed: HTTP ${pyRes.status}`);
      }

      const pyData = await pyRes.json();
      const savedCount = pyData.master_entries || 0;

      const createdUploadedFile = await db.uploadedFile.create({
        data: {
          name: fileName,
          size,
          hash,
          fileType: "HISTORY",
          status: "PROCESSED",
          uploadedBy: typeof uploadedBy === "number" ? uploadedBy : null,
        },
      });

      return {
        success: true,
        fileId: createdUploadedFile.id,
        savedRows: savedCount,
        rejectedRows: 0,
        errors: [],
        unmatched: [],
        message: `Master history loaded into Python rating engine (${savedCount.toLocaleString()} historical entries). Model retrained.`,
      };
    } catch (masterErr) {
      return {
        success: false,
        savedRows: 0,
        rejectedRows: 0,
        errors: [{ row: 0, column: "Master", reason: masterErr.message }],
        unmatched: [],
        message: `Failed to upload master file to Python backend: ${masterErr.message}`,
      };
    }
  }

  // Parse file according to format with streaming reader
  const lowerName = fileName.toLowerCase();

  // Reports: STARTER, VETERINARY, INCIDENT, STIPE (.docx, .doc, .pdf, .txt, .xlsx, .xls, .csv)
  const REPORT_EXTENSIONS = [".docx", ".doc", ".pdf", ".txt", ".xlsx", ".xls", ".csv"];
  if (["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
    const isSupportedReportExt = REPORT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!isSupportedReportExt) {
      return {
        success: false,
        savedRows: 0,
        rejectedRows: 0,
        errors: [{ row: 0, column: "File", reason: "Invalid file format. Accepted formats: Word, PDF, Excel, CSV, text." }],
        unmatched: [],
        message: "Invalid file format. Accepted formats: Word, PDF, Excel, CSV, text.",
      };
    }

    const reportRes = await processWordReport({ buffer, reportType: fileType, fileName });

    const createdUploadedFile = await db.uploadedFile.create({
      data: {
        name: fileName,
        size,
        hash,
        fileType,
        status: "PROCESSED",
        uploadedBy: typeof uploadedBy === "number" ? uploadedBy : null,
      },
    });

    await db.auditLog.create({
      data: {
        userId: typeof uploadedBy === "number" ? uploadedBy : null,
        action: "FILE_IMPORT",
        entity: "UploadedFile",
        entityId: String(createdUploadedFile.id),
        after: {
          fileId: createdUploadedFile.id,
          fileName,
          fileType,
          format: reportRes.format || "Word",
          linkedCount: reportRes.linkedCount,
          horseCount: reportRes.horseCount,
          unmatchedCount: reportRes.unmatchedNames.length,
          source,
        },
        reason: `Imported ${fileType} ${reportRes.format || "Word"} report "${fileName}": ${reportRes.summary}`,
      },
    });

    const unmatchedRows = (reportRes.unmatched || []).map((u, idx) => ({
      row: idx + 1,
      raceDate: u.date,
      raceNo: u.raceNo,
      horseName: u.horse,
      remark: u.finding || "",
      reason: `Horse "${u.horse}" not found in Race #${u.raceNo} on ${u.date}.`,
    }));

    return {
      success: true,
      fileId: createdUploadedFile.id,
      savedRows: reportRes.linkedCount,
      rejectedRows: 0,
      errors: [],
      unmatched: unmatchedRows,
      message: reportRes.summary,
      format: reportRes.format || "Word",
      totalRemarks: (reportRes.linked?.length || 0) + (reportRes.unmatched?.length || 0),
      linkedCount: reportRes.linkedCount,
      horseCount: reportRes.horseCount,
      unmatchedNames: reportRes.unmatchedNames || [],
    };
  }

  let parsedResult = { headers: [], rows: [] };

  try {
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      parsedResult = await parseExcelRows(buffer);
    } else if (lowerName.endsWith(".docx")) {
      if (!["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
        throw new Error(`Word (.docx) files are only supported for STARTER, VETERINARY, INCIDENT, and STIPE reports.`);
      }
      parsedResult = await parseDocxReport(buffer);
    } else if (lowerName.endsWith(".pdf")) {
      if (!["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
        throw new Error(`PDF (.pdf) files are only supported for STARTER, VETERINARY, INCIDENT, and STIPE reports.`);
      }
      parsedResult = await parsePdfReport(buffer);
    } else {
      parsedResult = await parseExcelRows(buffer);
    }
  } catch (parseErr) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: parseErr.message }],
      unmatched: [],
      message: parseErr.message,
    };
  }

  const tParsed = Date.now();
  console.log(`⏱️ [IMPORT:${fileType}] Parsed "${fileName}" in ${tParsed - t0}ms (${parsedResult.rows?.length || 0} rows)`);

  // Check file fits chosen type
  const formatCheck = checkFileFormatMatchesType(fileType, parsedResult, fileName);
  if (!formatCheck.matches) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [
        {
          row: 1,
          column: "Header",
          reason: `File columns do not match expected format for ${fileType}. It appears to be a ${formatCheck.detectedType} file.`,
        },
      ],
      unmatched: [],
      message: `Validation failed: File looks like ${formatCheck.detectedType}, not ${fileType}.`,
    };
  }

  const { rows } = parsedResult;

  if (rows.length === 0) {
    const detail = parsedResult.sheetName
      ? `The first sheet "${parsedResult.sheetName}" contains no data rows.`
      : "File contains no data rows.";
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: detail }],
      unmatched: [],
      message: `Validation failed: ${detail}`,
    };
  }

  // Validate rows
  const errors = [];
  const processedRows = [];

  for (const item of rows) {
    const { rowNumber, data, raw } = item;
    const rowErrors = [];

    if (fileType === "MASTER") {
      const horseName = cleanString(data.horseName);
      if (!horseName) {
        rowErrors.push({ row: rowNumber, column: "Horse Name", reason: "Horse Name is mandatory" });
      }

      let previousRuns = 0;
      if (data.previousRuns !== undefined && data.previousRuns !== null) {
        const pRuns = cleanInt(data.previousRuns);
        if (pRuns === null && String(data.previousRuns).trim() !== "") {
          rowErrors.push({ row: rowNumber, column: "Number of Previous Runs", reason: "Invalid Number of Previous Runs" });
        } else {
          previousRuns = pRuns || 0;
        }
      }

      const sexCat = cleanString(data.sexCategory);
      const currentRating = cleanInt(data.currentRating);
      const trainer = cleanString(data.trainer);
      const activeVal = data.active !== undefined ? String(data.active).trim().toLowerCase() : "true";
      const active = activeVal === "true" || activeVal === "active" || activeVal === "1";

      processedRows.push({
        rowNumber,
        horseName,
        sexCategory: sexCat,
        previousRuns,
        currentRating,
        trainer,
        active,
      });
    } else if (fileType === "RACE" || fileType === "HISTORY") {
      const venue = cleanString(data.venue);
      if (!venue) {
        rowErrors.push({ row: rowNumber, column: "Venue", reason: "Venue is mandatory" });
      }

      const raceDate = parseRaceDate(data.raceDate);
      if (!raceDate) {
        rowErrors.push({ row: rowNumber, column: "Race Date", reason: "Valid Race Date is mandatory (dd/mm/yyyy)" });
      }

      const raceCategory = cleanString(data.raceCategory);
      if (!raceCategory) {
        rowErrors.push({ row: rowNumber, column: "Race Category", reason: "Race Category is mandatory" });
      }

      const raceNo = cleanInt(data.raceNo);
      if (!raceNo || raceNo <= 0) {
        rowErrors.push({ row: rowNumber, column: "Race No", reason: "Race No is mandatory and must be a positive integer" });
      }

      const distance = cleanInt(data.distance);
      if (!distance || distance <= 0) {
        rowErrors.push({ row: rowNumber, column: "Distance", reason: "Distance is mandatory and must be a positive integer" });
      }

      const horseName = cleanString(data.horseName);
      if (!horseName) {
        rowErrors.push({ row: rowNumber, column: "Horse Name", reason: "Horse Name is mandatory" });
      }

      const placing = cleanInt(data.placing);
      const currentRating = cleanInt(data.currentRating);
      const previousRuns = cleanInt(data.previousRuns) || 0;

      processedRows.push({
        rowNumber,
        venue,
        raceDate,
        raceDateText: String(raw.raceDate || ""),
        season: cleanString(data.season),
        raceCategory,
        raceNo,
        cardNo: cleanInt(data.cardNo),
        distance,
        currentRating,
        previousRuns,
        horseName,
        horseWeight: cleanFloat(data.horseWeight),
        shoes: cleanString(data.shoes),
        startGate: cleanInt(data.startGate),
        weightDeclare: cleanFloat(data.weightDeclare),
        jockey: cleanString(data.jockey),
        weightCarried: cleanFloat(data.weightCarried),
        placing,
        timing: cleanString(data.timing),
        verdict: cleanString(data.verdict),
        trainer: cleanString(data.trainer),
        penetrometer: cleanFloat(data.penetrometer),
        railing: cleanString(data.railing),
        changeRating: cleanInt(data.changeRating),
      });
    } else if (["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
      const raceDate = parseRaceDate(data.raceDate);
      if (!raceDate) {
        rowErrors.push({ row: rowNumber, column: "Race Date", reason: "Valid Race Date is mandatory (dd/mm/yyyy)" });
      }

      const raceNo = cleanInt(data.raceNo);
      if (!raceNo || raceNo <= 0) {
        rowErrors.push({ row: rowNumber, column: "Race No", reason: "Race No is mandatory and must be a positive integer" });
      }

      const horseName = cleanString(data.horseName);
      if (!horseName) {
        rowErrors.push({ row: rowNumber, column: "Horse Name", reason: "Horse Name is mandatory" });
      }

      const remark =
        cleanString(data.remark) ||
        cleanString(data.starterRemark) ||
        cleanString(data.veterinaryRemark) ||
        cleanString(data.incidentRemark);

      if (!remark) {
        rowErrors.push({ row: rowNumber, column: "Remark", reason: "Remark is mandatory" });
      }

      processedRows.push({
        rowNumber,
        raceDate,
        raceDateText: String(raw.raceDate || ""),
        raceNo,
        horseName,
        remark,
        venue: cleanString(data.venue),
      });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
  }

  const tValidated = Date.now();
  console.log(`⏱️ [IMPORT:${fileType}] Validated in ${tValidated - tParsed}ms (${errors.length} error(s))`);

  // All or nothing on validation failure
  if (errors.length > 0) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: rows.length,
      errors,
      unmatched: [],
      message: `Validation failed: ${errors.length} error(s) found across ${rows.length} rows. No data was saved.`,
    };
  }

  // Pre-check: Ensure target races are not REVIEWED (for HISTORY imports only; Current Race files replace cleanly)
  if (fileType === "HISTORY") {
    const reviewedRaces = await db.race.findMany({
      where: { status: "REVIEWED" },
      select: { venue: true, raceDate: true, raceNo: true },
    });
    if (reviewedRaces.length > 0) {
      const reviewedSet = new Set(
        reviewedRaces.map((r) => `${r.venue}|${r.raceDate.toISOString().slice(0, 10)}|${r.raceNo}`)
      );
      for (const r of processedRows) {
        const key = `${r.venue}|${r.raceDate.toISOString().slice(0, 10)}|${r.raceNo}`;
        if (reviewedSet.has(key)) {
          return {
            success: false,
            savedRows: 0,
            rejectedRows: rows.length,
            errors: [
              {
                row: r.rowNumber,
                column: "Status",
                reason: `Race ${r.venue} #${r.raceNo} on ${r.raceDate.toISOString().slice(0, 10)} has status REVIEWED and cannot be modified.`,
              },
            ],
            unmatched: [],
            message: "Modification blocked: Target race status is REVIEWED.",
          };
        }
      }
    }
  }

  // Requirement 6: Set an explicit transaction timeout of at least 10 minutes on every transaction
  const unmatched = [];
  let savedRowsCount = 0;
  let createdUploadedFile = null;
  const racesToAutoRate = [];

  await db.$transaction(
    async (tx) => {
      // Save copy of accepted file in uploads/ if filesystem is writable
      try {
        const uploadsDir = path.resolve(process.cwd(), "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const safeDiskFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        fs.writeFileSync(path.join(uploadsDir, safeDiskFileName), buffer);
      } catch (diskErr) {
        console.warn("Could not save copy to uploads/ directory:", diskErr.message);
      }

      createdUploadedFile = await tx.uploadedFile.create({
        data: {
          name: fileName,
          size,
          hash,
          fileType,
          status: "PROCESSED",
          uploadedBy: typeof uploadedBy === "number" ? uploadedBy : null,
        },
      });

      if (fileType === "MASTER") {
        for (const row of processedRows) {
          const existingHorse = await tx.horse.findFirst({
            where: { name: { equals: row.horseName, mode: "insensitive" } },
          });

          if (existingHorse) {
            await tx.horse.update({
              where: { id: existingHorse.id },
              data: {
                sexCategory: row.sexCategory || existingHorse.sexCategory,
                previousRuns: row.previousRuns !== undefined ? row.previousRuns : existingHorse.previousRuns,
                currentRating: row.currentRating !== undefined ? row.currentRating : existingHorse.currentRating,
                trainer: row.trainer || existingHorse.trainer,
                active: row.active,
              },
            });
          } else {
            let nextNum = await getMaxHorseNumber(tx);
            await tx.horse.create({
              data: {
                horseId: formatHorseId(nextNum + 1),
                name: row.horseName,
                sexCategory: row.sexCategory,
                previousRuns: row.previousRuns,
                currentRating: row.currentRating,
                trainer: row.trainer,
                active: row.active,
              },
            });
          }
          savedRowsCount++;
        }
      } else if (fileType === "RACE" || fileType === "HISTORY") {
        // Requirement 1: Load all existing horses by name into a Map with ONE query
        const horseNames = Array.from(new Set(processedRows.map((r) => r.horseName.trim()).filter(Boolean)));
        const existingHorses = await tx.horse.findMany({
          where: {
            name: { in: horseNames, mode: "insensitive" },
          },
          select: { id: true, name: true, currentRating: true },
        });

        const horseMap = new Map();
        for (const h of existingHorses) {
          horseMap.set(h.name.trim().toLowerCase(), h);
        }

        // Requirement 1: Create missing horses with createMany (skipDuplicates)
        const missingNames = horseNames.filter((n) => !horseMap.has(n.toLowerCase()));
        if (missingNames.length > 0) {
          let nextHorseNum = await getMaxHorseNumber(tx);
          const newHorsesData = missingNames.map((name) => {
            nextHorseNum++;
            return {
              horseId: formatHorseId(nextHorseNum),
              name,
              active: true,
            };
          });

          for (let i = 0; i < newHorsesData.length; i += 1000) {
            await tx.horse.createMany({
              data: newHorsesData.slice(i, i + 1000),
              skipDuplicates: true,
            });
          }

          const createdHorses = await tx.horse.findMany({
            where: {
              name: { in: missingNames, mode: "insensitive" },
            },
            select: { id: true, name: true, currentRating: true },
          });
          for (const h of createdHorses) {
            horseMap.set(h.name.trim().toLowerCase(), h);
          }
        }

        // Requirement 1: Create races with createMany (skipDuplicates) and read back their ids
        const raceGroupMap = new Map();
        for (const row of processedRows) {
          const key = `${row.venue}|${row.raceDate.toISOString().slice(0, 10)}|${row.raceNo}`;
          if (!raceGroupMap.has(key)) {
            raceGroupMap.set(key, {
              venue: row.venue,
              raceDate: row.raceDate,
              season: row.season || null,
              category: row.raceCategory,
              raceNo: row.raceNo,
              cardNo: row.cardNo || null,
              distance: row.distance,
              raceType: raceType(row.raceCategory),
              status: fileType === "HISTORY" ? "REVIEWED" : "OPEN",
            });
          }
        }

        const racesToCreate = Array.from(raceGroupMap.values());
        for (let i = 0; i < racesToCreate.length; i += 1000) {
          await tx.race.createMany({
            data: racesToCreate.slice(i, i + 1000),
            skipDuplicates: true,
          });
        }

        const distinctVenues = Array.from(new Set(racesToCreate.map((r) => r.venue)));
        const distinctDates = Array.from(new Set(racesToCreate.map((r) => r.raceDate)));
        const fetchedRaces = await tx.race.findMany({
          where: {
            venue: { in: distinctVenues },
            raceDate: { in: distinctDates },
          },
          select: { id: true, venue: true, raceDate: true, raceNo: true, category: true, distance: true, raceType: true },
        });

        const raceIdMap = new Map();
        for (const r of fetchedRaces) {
          const key = `${r.venue}|${r.raceDate.toISOString().slice(0, 10)}|${r.raceNo}`;
          raceIdMap.set(key, r);
          if (fileType === "RACE") {
            racesToAutoRate.push(r.id);
          }
        }

        // When uploading Current Race (RACE): replace previous race entries and reset race status to OPEN so the new file overwrites cleanly
        if (fileType === "RACE") {
          const targetRaceIds = fetchedRaces.map((r) => r.id);
          if (targetRaceIds.length > 0) {
            // Reset race status to OPEN if previously reviewed so fresh current race can be rated
            await tx.race.updateMany({
              where: { id: { in: targetRaceIds } },
              data: { status: "OPEN" },
            });

            const oldEntries = await tx.raceEntry.findMany({
              where: { raceId: { in: targetRaceIds } },
              select: { id: true },
            });
            const oldEntryIds = oldEntries.map((e) => e.id);
            if (oldEntryIds.length > 0) {
              await tx.decision.deleteMany({ where: { entryId: { in: oldEntryIds } } });
              await tx.handicapDecision.deleteMany({ where: { entryId: { in: oldEntryIds } } });
              await tx.rating.deleteMany({ where: { entryId: { in: oldEntryIds } } });
              await tx.raceEntry.deleteMany({ where: { id: { in: oldEntryIds } } });
            }
          }
        }

        // Requirement 1: Create race entries with createMany (skipDuplicates)
        const raceEntriesToCreate = [];
        const seenEntries = new Set();
        for (const row of processedRows) {
          const raceKey = `${row.venue}|${row.raceDate.toISOString().slice(0, 10)}|${row.raceNo}`;
          const race = raceIdMap.get(raceKey);
          const horse = horseMap.get(row.horseName.trim().toLowerCase());
          if (!race || !horse) continue;

          const rhKey = `${race.id}|${horse.id}`;
          if (seenEntries.has(rhKey)) continue;
          seenEntries.add(rhKey);

          raceEntriesToCreate.push({
            raceId: race.id,
            horseId: horse.id,
            horseWeight: row.horseWeight,
            shoes: row.shoes,
            startGate: row.startGate,
            weightDeclare: row.weightDeclare,
            weightCarried: row.weightCarried,
            jockey: row.jockey,
            placing: row.placing,
            timing: row.timing,
            verdict: row.verdict,
            trainer: row.trainer,
            penetrometer: row.penetrometer,
            railing: row.railing,
          });
        }

        for (let i = 0; i < raceEntriesToCreate.length; i += 1000) {
          await tx.raceEntry.createMany({
            data: raceEntriesToCreate.slice(i, i + 1000),
            skipDuplicates: true,
          });
        }

        // For Current Race file: save currat and race entry extras in data/race-extras/<fileId>.json
        // Do NOT overwrite Horse.currentRating in master table
        if (fileType === "RACE") {
          const extrasMap = {};
          for (const row of processedRows) {
            const key = getEntryKey(row.raceDate, row.raceNo, row.horseName);
            extrasMap[key] = {
              currat: row.currentRating,
              weightcd: row.weightCarried,
              timing: row.timing,
              placing: row.placing,
              horseName: row.horseName,
              raceDate: row.raceDateText || row.raceDate,
              raceNo: row.raceNo,
            };
          }
          saveRaceExtras(createdUploadedFile.id, extrasMap);
        } else {
          // For HISTORY/MASTER: update horse currentRating
          const horseUpdatesMap = new Map();
          for (const row of processedRows) {
            if (row.currentRating !== null && row.currentRating !== undefined) {
              const horse = horseMap.get(row.horseName.trim().toLowerCase());
              if (horse) {
                horseUpdatesMap.set(horse.id, {
                  id: horse.id,
                  currentRating: row.currentRating,
                  trainer: row.trainer || null,
                });
              }
            }
          }

          const horseUpdates = Array.from(horseUpdatesMap.values());
          for (let i = 0; i < horseUpdates.length; i += 500) {
            const chunk = horseUpdates.slice(i, i + 500);
            const valuesClauses = [];
            const params = [];
            chunk.forEach((item, idx) => {
              const offset = idx * 3;
              valuesClauses.push(`($${offset + 1}::int, $${offset + 2}::int, $${offset + 3}::text)`);
              params.push(item.id, item.currentRating, item.trainer);
            });

            const updateSql = `
              UPDATE "Horse" AS h
              SET "currentRating" = v.current_rating,
                  "trainer" = COALESCE(v.trainer, h.trainer),
                  "updatedAt" = CURRENT_TIMESTAMP
              FROM (VALUES ${valuesClauses.join(", ")}) AS v(id, current_rating, trainer)
              WHERE h.id = v.id
            `;
            await tx.$executeRawUnsafe(updateSql, ...params);
          }
        }

        // Requirement 2: HISTORY and RACE must NOT insert into horse_run. Removed completely!
        savedRowsCount = processedRows.length;
      } else if (["STARTER", "VETERINARY", "INCIDENT", "STIPE"].includes(fileType)) {
        const affectedRaces = new Set();

        for (const reportRow of processedRows) {
          const potentialRaces = await tx.race.findMany({
            where: {
              raceDate: reportRow.raceDate,
              raceNo: reportRow.raceNo,
              ...(reportRow.venue ? { venue: reportRow.venue } : {}),
            },
            include: {
              entries: {
                include: { horse: true },
              },
            },
          });

          let matched = false;
          for (const r of potentialRaces) {
            const entry = r.entries.find(
              (e) => e.horse.name.trim().toLowerCase() === reportRow.horseName.trim().toLowerCase()
            );

            if (entry) {
              matched = true;
              affectedRaces.add(r.id);

              const remarkField =
                fileType === "STARTER"
                  ? "starterRemark"
                  : fileType === "VETERINARY"
                  ? "veterinaryRemark"
                  : "incidentRemark";

              const formattedRemark = fileType === "STIPE" ? `[Stipe] ${reportRow.remark}` : reportRow.remark;
              const existingRemark = entry[remarkField];
              const updatedRemark = existingRemark ? `${existingRemark} | ${formattedRemark}` : formattedRemark;

              await tx.raceEntry.update({
                where: { id: entry.id },
                data: { [remarkField]: updatedRemark },
              });
              savedRowsCount++;
              break;
            }
          }

          if (!matched) {
            unmatched.push({
              row: reportRow.rowNumber,
              raceDate: reportRow.raceDateText,
              raceNo: reportRow.raceNo,
              horseName: reportRow.horseName,
              remark: reportRow.remark,
              reason: `Horse "${reportRow.horseName}" is not an entrant in Race #${reportRow.raceNo} on ${reportRow.raceDateText}.`,
            });
          }
        }

        for (const raceId of affectedRaces) {
          racesToAutoRate.push(raceId);
        }
      }

      // Write AuditLog row
      await tx.auditLog.create({
        data: {
          userId: typeof uploadedBy === "number" ? uploadedBy : null,
          action: "FILE_IMPORT",
          entity: "UploadedFile",
          entityId: String(createdUploadedFile.id),
          after: {
            fileId: createdUploadedFile.id,
            fileName,
            fileType,
            savedRows: savedRowsCount,
            unmatchedCount: unmatched.length,
            source,
          },
          reason: `Imported ${fileType} file "${fileName}" (${savedRowsCount} row(s) saved, source: ${source}).`,
        },
      });
    },
    { maxWait: 600000, timeout: 600000 }
  );

  const tSaved = Date.now();
  console.log(`⏱️ [IMPORT:${fileType}] Saved to database in ${tSaved - tValidated}ms`);

  // Data ingested and report remarks linked. Ratings are computed when the user clicks 'Generate Rating'
  let ratedCount = 0;

  const tRated = Date.now();
  console.log(`⏱️ [IMPORT:${fileType}] Auto-rated in ${tRated - tSaved}ms (${ratedCount} race(s)). Total: ${tRated - t0}ms`);

  // After every HISTORY import: re-rate only OPEN races via Python backend
  if (fileType === "HISTORY") {
    try {
      console.log("🔄 [IMPORT:HISTORY] Re-rating only OPEN races with Python backend...");
      await reRateAllOpenRaces();
    } catch (err) {
      console.warn("Could not re-rate open races after HISTORY import:", err.message);
    }
  }

  return {
    success: true,
    savedRows: savedRowsCount,
    rejectedRows: 0,
    errors: [],
    unmatched,
    fileId: createdUploadedFile?.id,
    message: `File "${fileName}" successfully processed: ${savedRowsCount} row(s) saved.${
      unmatched.length > 0 ? ` (${unmatched.length} unmatched remark(s))` : ""
    }`,
  };
}

// ─── ACTIVE_HORSE Import Handler ──────────────────────────────────────────────

async function handleActiveHorseImport({ fileName, buffer, size, hash, uploadedBy, source = "UPLOAD", t0 = Date.now() }) {
  const { horses, allRuns, distinctRuns } = await parseActiveHorseFile(buffer);
  const tParsed = Date.now();
  console.log(`⏱️ [IMPORT:ACTIVE_HORSE] Parsed "${fileName}" in ${tParsed - t0}ms (${horses.length} horses, ${allRuns.length} runs, ${distinctRuns.length} distinct runs)`);

  if (horses.length === 0) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: "No horse blocks found in ACTIVE_HORSE report" }],
      unmatched: [],
      message: "Validation failed: No active horse records found.",
    };
  }

  const tValidated = Date.now();

  let createdUploadedFile = null;

  await db.$transaction(
    async (tx) => {
      // 1. Save copy of accepted file in uploads/ if filesystem is writable
      try {
        const uploadsDir = path.resolve(process.cwd(), "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const safeDiskFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        fs.writeFileSync(path.join(uploadsDir, safeDiskFileName), buffer);
      } catch (diskErr) {
        console.warn("Could not save copy to uploads/ directory:", diskErr.message);
      }

      // 2. Write UploadedFile record
      createdUploadedFile = await tx.uploadedFile.create({
        data: {
          name: fileName,
          size,
          hash,
          fileType: "ACTIVE_HORSE",
          status: "PROCESSED",
          uploadedBy: typeof uploadedBy === "number" ? uploadedBy : null,
        },
      });

      // Requirement 3: createMany horses (skipDuplicates)
      let nextHorseNum = await getMaxHorseNumber(tx);
      const horsesData = horses.map((h) => {
        nextHorseNum++;
        return {
          horseId: formatHorseId(nextHorseNum),
          name: h.name.trim(),
          previousRuns: h.runs ? h.runs.length : 0,
          active: true,
        };
      });

      for (let i = 0; i < horsesData.length; i += 1000) {
        await tx.horse.createMany({
          data: horsesData.slice(i, i + 1000),
          skipDuplicates: true,
        });
      }

      // Requirement 3: one query to get the id map
      const allHorsesInDb = await tx.horse.findMany({
        where: {
          name: { in: horses.map((h) => h.name.trim()), mode: "insensitive" },
        },
        select: { id: true, name: true, previousRuns: true },
      });
      const horsePkMap = new Map();
      for (const h of allHorsesInDb) {
        horsePkMap.set(h.name.trim().toUpperCase(), h.id);
      }

      // Requirement 3: insert runs with multi-row INSERT ... ON CONFLICT DO NOTHING in chunks of 1,000
      const chunkSize = 1000;
      for (let i = 0; i < distinctRuns.length; i += chunkSize) {
        const chunk = distinctRuns.slice(i, i + chunkSize);
        const valueClauses = [];
        const params = [];
        let pIdx = 1;

        for (const run of chunk) {
          const horsePk = horsePkMap.get(run.horseName.toUpperCase());
          if (!horsePk) continue;

          valueClauses.push(
            `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
          );
          params.push(
            horsePk,
            run.runDate,
            run.raceRef,
            run.category,
            run.distance,
            run.weightCarried,
            run.equipment,
            run.jockey,
            run.horseWeight,
            run.ratingText,
            run.timeText,
            run.penetrometer,
            run.shoes,
            source || "ACTIVE_HORSE"
          );
        }

        if (valueClauses.length > 0) {
          const query = `
            INSERT INTO horse_run (
              horse_pk, run_date, race_ref, category, distance, weight_carried,
              equipment, jockey, horse_weight, rating_text, time_text, penetrometer, shoes, source
            )
            VALUES ${valueClauses.join(",\n")}
            ON CONFLICT (horse_pk, run_date, race_ref) DO NOTHING
          `;
          await tx.$executeRawUnsafe(query, ...params);
        }
      }

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          userId: typeof uploadedBy === "number" ? uploadedBy : null,
          action: "FILE_IMPORT",
          entity: "UploadedFile",
          entityId: String(createdUploadedFile.id),
          after: {
            fileId: createdUploadedFile.id,
            fileName,
            fileType: "ACTIVE_HORSE",
            horsesCount: horses.length,
            totalRunsInFile: allRuns.length,
            distinctRunsSaved: distinctRuns.length,
            source,
          },
          reason: `Imported ACTIVE_HORSE file: ${distinctRuns.length} distinct run(s) saved across ${horses.length} horse(s).`,
        },
      });
    },
    {
      maxWait: 600000,
      timeout: 600000,
    }
  );

  const tSaved = Date.now();
  console.log(`⏱️ [IMPORT:ACTIVE_HORSE] Saved to database in ${tSaved - tValidated}ms. Total: ${tSaved - t0}ms`);

  return {
    success: true,
    savedRows: distinctRuns.length,
    horsesCount: horses.length,
    totalRuns: allRuns.length,
    rejectedRows: 0,
    errors: [],
    unmatched: [],
    fileId: createdUploadedFile?.id,
    message: `ACTIVE_HORSE file processed: ${horses.length} horses, ${distinctRuns.length} distinct runs saved.`,
  };
}

// ─── Dynamic Coefficient Workbook Ingestion ──────────────────────────────────

async function parseCoefficientFile(buffer) {
  const sharedStrings = await extractSharedStrings(buffer);
  const tmpPath = path.join(os.tmpdir(), `hra_coeff_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmpPath, buffer);

  let headerRowIdx = -1;
  let catCol = -1, distCol = -1, rcCol = -1;
  let weightCol = -1, timeCol = -1, lengthCol = -1, peneCol = -1, pValCol = -1;
  const processedRows = [];
  const errors = [];
  const seenCombinations = new Set();

  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(tmpPath, {
      sharedStrings: "ignore",
      worksheets: "emit",
    });
    reader.model = { sheets: [] };

    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        const r = row.number;
        const cellValues = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          let val = cell.value;
          if (val && typeof val === "object") {
            if ("sharedString" in val && sharedStrings[val.sharedString] !== undefined) {
              val = sharedStrings[val.sharedString];
            } else if (val.result !== undefined) {
              val = val.result;
            } else if (val.text !== undefined) {
              val = val.text;
            }
          }
          cellValues[colNumber] = val;
        });

        if (headerRowIdx === -1) {
          let cCat = -1, cDist = -1, cRc = -1;
          let cWeight = -1, cTime = -1, cLength = -1, cPene = -1, cPVal = -1;
          for (const [cStr, val] of Object.entries(cellValues)) {
            const c = parseInt(cStr, 10);
            const text = String(val ?? "").trim().toLowerCase();
            if (/race\s*category/.test(text)) cCat = c;
            else if (/^distance/.test(text)) cDist = c;
            else if (/rating\s*change\s*from\s*median\s*refer/.test(text)) cRc = c;
            else if (/weight\s*carried.*coeff/i.test(text)) cWeight = c;
            else if (/time.*coeff/i.test(text)) cTime = c;
            else if (/length.*coeff/i.test(text)) cLength = c;
            else if (/penetrometer.*coeff/i.test(text)) cPene = c;
            else if (/overall.*p-value/i.test(text)) cPVal = c;
          }
          if (cCat !== -1 && cDist !== -1 && cRc !== -1) {
            headerRowIdx = r;
            catCol = cCat;
            distCol = cDist;
            rcCol = cRc;
            weightCol = cWeight;
            timeCol = cTime;
            lengthCol = cLength;
            peneCol = cPene;
            pValCol = cPVal;
          }
          continue;
        }

        const cat = cleanString(cellValues[catCol]);
        const dist = cleanInt(cellValues[distCol]);

        if (!cat && !dist) continue;
        if (!dist) continue;
        if (cat && (/^note[:\s]/i.test(cat) || cat.toLowerCase().includes("note"))) continue;

        if (!cat) {
          errors.push({ row: r, column: "Race Category", reason: "Race Category is mandatory" });
        }
        if (!dist || dist <= 0) {
          errors.push({ row: r, column: "Distance", reason: "Distance is mandatory and must be a positive integer" });
        }
        if (cat && dist) {
          const key = `${cat}_${dist}`;
          if (seenCombinations.has(key)) {
            errors.push({ row: r, column: "Race Category / Distance", reason: `Duplicate category and distance combination: ${cat} / ${dist}m` });
          }
          seenCombinations.add(key);
        }

        const rawRc = cellValues[rcCol];
        let ratingChange = null;
        if (rawRc !== null && rawRc !== undefined && rawRc !== "" && rawRc !== "-") {
          const num = Number(String(rawRc).trim());
          if (Number.isFinite(num)) ratingChange = Math.round(num);
        }

        const parseOptionalFloat = (col) => {
          if (col === -1) return 0;
          const v = cellValues[col];
          if (v === null || v === undefined || v === "" || v === "-") return 0;
          const n = Number(String(v).trim());
          return Number.isFinite(n) ? n : 0;
        };

        processedRows.push({
          rowNumber: r,
          category: cat,
          distance: dist,
          ratingChange,
          weight: parseOptionalFloat(weightCol),
          time: parseOptionalFloat(timeCol),
          length: parseOptionalFloat(lengthCol),
          penetrometer: parseOptionalFloat(peneCol),
          overall: pValCol !== -1 ? parseOptionalFloat(pValCol) : null,
        });
      }
      if (headerRowIdx !== -1) break;
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }

  return { headerRowIdx, processedRows, errors };
}

async function handleCoefficientImport({ fileName, buffer, size, hash, uploadedBy, source = "UPLOAD", t0 = Date.now() }) {
  const { headerRowIdx, processedRows, errors } = await parseCoefficientFile(buffer);
  const tParsed = Date.now();
  console.log(`⏱️ [IMPORT:COEFFICIENT] Parsed "${fileName}" in ${tParsed - t0}ms (${processedRows.length} rows)`);

  if (headerRowIdx === -1) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [
        {
          row: 1,
          column: "Header",
          reason: "Required columns missing in workbook. Must include 'Race Category', 'Distance', and 'Rating Change from Median Reference'.",
        },
      ],
      unmatched: [],
      message: "Validation failed: Required coefficient columns missing.",
    };
  }

  if (processedRows.length === 0) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: "Workbook contains no data rows" }],
      unmatched: [],
      message: "Validation failed: File contains no data rows.",
    };
  }

  if (errors.length > 0) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: processedRows.length,
      errors,
      unmatched: [],
      message: `Validation failed: ${errors.length} error(s) found. No data was saved.`,
    };
  }

  const tValidated = Date.now();
  console.log(`⏱️ [IMPORT:COEFFICIENT] Validated in ${tValidated - tParsed}ms`);

  let createdUploadedFile = null;
  await db.$transaction(
    async (tx) => {
      try {
        const uploadsDir = path.resolve(process.cwd(), "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const safeDiskFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        fs.writeFileSync(path.join(uploadsDir, safeDiskFileName), buffer);
      } catch (diskErr) {
        console.warn("Could not save copy to uploads/ directory:", diskErr.message);
      }

      createdUploadedFile = await tx.uploadedFile.create({
        data: {
          name: fileName,
          size,
          hash,
          fileType: "COEFFICIENT",
          status: "PROCESSED",
          uploadedBy: typeof uploadedBy === "number" ? uploadedBy : null,
        },
      });

      // Requirement 4: deleteMany, then one createMany
      await tx.coefficient.deleteMany();
      await tx.coefficient.createMany({
        data: processedRows.map((row) => ({
          category: row.category,
          distance: row.distance,
          ratingChange: row.ratingChange,
          weight: row.weight,
          time: row.time,
          length: row.length,
          penetrometer: row.penetrometer,
          overall: row.overall,
        })),
        skipDuplicates: true,
      });

      await tx.auditLog.create({
        data: {
          userId: typeof uploadedBy === "number" ? uploadedBy : null,
          action: "FILE_IMPORT",
          entity: "UploadedFile",
          entityId: String(createdUploadedFile.id),
          after: {
            fileId: createdUploadedFile.id,
            fileName,
            fileType: "COEFFICIENT",
            replacedRows: processedRows.length,
            source,
          },
          reason: `Imported dynamic coefficients from "${fileName}": replaced ${processedRows.length} rows in Coefficient table.`,
        },
      });
    },
    { maxWait: 600000, timeout: 600000 }
  );

  const tSaved = Date.now();
  console.log(`⏱️ [IMPORT:COEFFICIENT] Saved to database in ${tSaved - tValidated}ms`);

  // After COEFFICIENT upload, re-rate all open (non-REVIEWED) races
  let reRatedCount = 0;
  try {
    const reRated = await reRateAllOpenRaces();
    reRatedCount = reRated.filter((r) => r.ok).length;
  } catch (err) {
    console.error("Error during reRateAllOpenRaces after COEFFICIENT upload:", err);
  }

  const tRated = Date.now();
  console.log(`⏱️ [IMPORT:COEFFICIENT] Re-rated open races in ${tRated - tSaved}ms. Total: ${tRated - t0}ms`);

  return {
    success: true,
    savedRows: processedRows.length,
    rejectedRows: 0,
    errors: [],
    unmatched: [],
    reRatedRaces: reRatedCount,
    fileId: createdUploadedFile?.id,
    message: `COEFFICIENT workbook processed: ${processedRows.length} coefficient rows loaded. ${reRatedCount} open race(s) re-rated.`,
  };
}
