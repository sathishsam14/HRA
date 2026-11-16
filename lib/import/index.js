// lib/import/index.js
// Multi-format ingestion engine for HRA (Horse Rating Automation).
// Supported file types: ACTIVE_HORSE, MASTER, HISTORY, RACE, STARTER, VETERINARY, INCIDENT.
// Validates file signatures, data types, mandatory fields, prevents duplicates by SHA-256 hash,
// saves accepted files in uploads/, and applies all updates in a single Prisma transaction with AuditLog.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import db from "../db.js";
import { raceType, rateRace } from "../rating-engine/index.js";
import { rateAndSaveRace, reRateAllOpenRaces } from "../rate.js";

// ─── Header Normalization & Aliases ──────────────────────────────────────────

export function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const HEADER_ALIASES = {
  venue: ["venue", "race venue"],
  raceDate: ["race date", "date", "racedate", "date of race"],
  raceCategory: ["race category", "category", "race class", "class"],
  raceNo: ["race no", "race no.", "race number", "raceno", "race #"],
  cardNo: ["card no", "card no.", "card number", "cardno"],
  distance: ["distance", "dist", "race distance"],
  currentRating: ["current rating", "rating", "curr rating", "cur rating", "currentrating"],
  horseName: ["horse name", "horse", "horsename", "name of horse", "horse reference"],
  horseWeight: ["horse weight", "horse wt", "horse weight (kgs)", "horse wt."],
  shoes: ["shoes", "shoeing", "eqp"],
  startGate: ["start gate", "gate", "draw", "starting gate"],
  weightDeclare: ["weight declare", "weight declared", "wt declare", "wt dec"],
  jockey: ["jockey", "jockey name"],
  weightCarried: ["weight carried", "weight/cr.", "weight cr", "wt carried", "wt cr"],
  placing: ["placing", "place", "rank", "finish position", "finishing position"],
  timing: ["timing", "time", "time (secs)", "time in sec"],
  verdict: ["verdict", "verdict/length", "length diff", "lng diff.", "margin", "lengths"],
  trainer: ["trainer", "trainer name"],
  penetrometer: ["penetrometer reading", "penetrometer", "penetro.", "penetrometer reading"],
  railing: ["railing position", "railing", "false rails"],
  season: ["race season", "season"],
  previousRuns: [
    "number of previous runs",
    "no.of previous races performed",
    "no of previous races performed",
    "previous runs",
    "starts",
    "previousruns",
  ],
  sexCategory: ["sex category", "sex", "gender", "sex/category"],
  changeRating: ["change rating", "rating change", "change in rating"],
  starterRemark: ["starter remarks", "starter remark", "starter report", "starter obs", "starter"],
  veterinaryRemark: [
    "veterinary remarks",
    "veterinary remark",
    "veterinary report",
    "vet obs",
    "veterinary",
    "vet remarks",
  ],
  incidentRemark: ["incident report", "incident remarks", "incident remark", "incident obs", "incident"],
  remark: ["remark", "remarks", "observation", "report", "details"],
  active: ["active", "status"],
};

function matchHeaderKey(rawHeader) {
  const norm = normalizeHeader(rawHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(norm)) {
      return key;
    }
  }
  return null;
}

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

// ─── File Parsers (.xlsx, .docx, .pdf) ────────────────────────────────────────

async function parseExcelRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { headers: [], rows: [] };

  let headerRowIndex = -1;
  let headerMap = {};

  worksheet.eachRow((row, rowNumber) => {
    if (headerRowIndex !== -1 || rowNumber > 10) return;
    const detected = {};
    let matchedCount = 0;
    row.eachCell((cell, colNumber) => {
      const text = cell.text || String(cell.value || "");
      const key = matchHeaderKey(text);
      if (key) {
        detected[colNumber] = key;
        matchedCount++;
      }
    });
    if (matchedCount >= 2) {
      headerRowIndex = rowNumber;
      headerMap = detected;
    }
  });

  if (headerRowIndex === -1) {
    headerRowIndex = 1;
    const row = worksheet.getRow(1);
    row.eachCell((cell, colNumber) => {
      const text = cell.text || String(cell.value || "");
      const key = matchHeaderKey(text);
      if (key) headerMap[colNumber] = key;
    });
  }

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;

    let hasData = false;
    const rowData = {};
    const rawData = {};

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headerMap[colNumber];
      const val = cell.value;
      if (val !== null && val !== undefined && String(val).trim() !== "") {
        hasData = true;
      }
      if (key) {
        rowData[key] = val;
        rawData[key] = val;
      }
    });

    if (hasData) {
      rows.push({
        rowNumber,
        data: rowData,
        raw: rawData,
      });
    }
  });

  return {
    headers: Object.values(headerMap),
    rows,
  };
}

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
  const parser = new PDFParse({ autoDetect: true });
  const data = await parser.parse(buffer);
  const text = data?.text || "";

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

// ─── Active Horse Report Parser ───────────────────────────────────────────────

async function parseActiveHorseFile(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { horses: [], allRuns: [] };

  const horsesMap = new Map();
  let currentHorse = null;
  let inRuns = false;
  const allRuns = [];

  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cell1 = row.getCell(1);
    const val1 = cell1.value;
    const str1 = val1 ? String(val1).trim() : "";

    // Check if horse name in bold
    if (
      cell1.font &&
      cell1.font.bold &&
      str1 &&
      str1.toLowerCase() !== "starts" &&
      str1.toLowerCase() !== "tarts" &&
      str1.toLowerCase() !== "race date"
    ) {
      currentHorse = str1.replace(/\s+/g, " ");
      if (!horsesMap.has(currentHorse.toUpperCase())) {
        horsesMap.set(currentHorse.toUpperCase(), { name: currentHorse, runs: [] });
      }
      inRuns = false;
      continue;
    }

    const lower = str1.toLowerCase();
    if (lower === "race date") {
      inRuns = true;
      continue;
    }

    if (lower === "starts" || lower === "tarts") {
      inRuns = false;
      continue;
    }

    if (inRuns && val1) {
      const raceDate = parseRaceDate(val1);
      const raceRef = cleanString(row.getCell(2).value);
      if (!raceDate || !raceRef) continue;

      const category = cleanString(row.getCell(3).value);
      const distance = cleanInt(row.getCell(4).value);
      const weightCarried = cleanString(row.getCell(5).value);
      const equipment = cleanString(row.getCell(6).value);
      const jockey = cleanString(row.getCell(7).value);
      const horseWeight = cleanFloat(row.getCell(9).value);
      const ratingText = cleanString(row.getCell(11).value);

      let timeText = null;
      const timeVal = row.getCell(12).value;
      if (timeVal instanceof Date) {
        const m = String(timeVal.getUTCMinutes()).padStart(2, "0");
        const s = String(timeVal.getUTCSeconds()).padStart(2, "0");
        const ms = String(timeVal.getUTCMilliseconds()).padStart(3, "0").slice(0, 2);
        timeText = `${m}:${s}.${ms}`;
      } else if (timeVal !== null && timeVal !== undefined) {
        timeText = cleanString(timeVal);
      }

      const penetrometer = cleanFloat(row.getCell(15).value);
      const shoes = cleanString(row.getCell(16).value);

      const runItem = {
        horseName: currentHorse,
        runDate: raceDate,
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

      allRuns.push(runItem);
      const horseRecord = horsesMap.get(currentHorse?.toUpperCase());
      if (horseRecord) {
        horseRecord.runs.push(runItem);
      }
    }
  }

  return {
    horses: Array.from(horsesMap.values()),
    allRuns,
  };
}

// ─── File Classification Checker ──────────────────────────────────────────────

function checkFileFormatMatchesType(fileType, parsed, fileName) {
  const headers = parsed.headers || [];
  const lowerName = fileName.toLowerCase();

  if (fileType === "ACTIVE_HORSE") {
    // If headers indicate standard tabular race sheet
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

  if (["STARTER", "VETERINARY", "INCIDENT"].includes(fileType)) {
    if (headers.includes("venue") && headers.includes("distance") && headers.includes("raceCategory")) {
      return { matches: false, detectedType: "RACE" };
    }
    return { matches: true };
  }

  return { matches: true };
}

// ─── Main Ingestion Entry Point ───────────────────────────────────────────────

export async function importFile({ fileName, buffer, fileType, uploadedBy, source = "UPLOAD" }) {
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

  // Rule b: Duplicate file detection
  const existingFile = await db.uploadedFile.findUnique({
    where: {
      name_size_hash: {
        name: fileName,
        size,
        hash,
      },
    },
  });

  if (existingFile) {
    return {
      success: true,
      skipped: true,
      savedRows: 0,
      rejectedRows: 0,
      errors: [],
      unmatched: [],
      fileId: existingFile.id,
      message: `File "${fileName}" with identical size and SHA-256 hash has already been uploaded. Skipped.`,
    };
  }

  // Handle ACTIVE_HORSE file type
  if (fileType === "ACTIVE_HORSE") {
    return await handleActiveHorseImport({ fileName, buffer, size, hash, uploadedBy, source });
  }

  // Handle COEFFICIENT file type
  if (fileType === "COEFFICIENT") {
    return await handleCoefficientImport({ fileName, buffer, size, hash, uploadedBy, source });
  }

  // Parse file according to format
  const lowerName = fileName.toLowerCase();
  let parsedResult = { headers: [], rows: [] };

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    parsedResult = await parseExcelRows(buffer);
  } else if (lowerName.endsWith(".docx")) {
    if (!["STARTER", "VETERINARY", "INCIDENT"].includes(fileType)) {
      throw new Error(`Word (.docx) files are only supported for STARTER, VETERINARY, and INCIDENT reports.`);
    }
    parsedResult = await parseDocxReport(buffer);
  } else if (lowerName.endsWith(".pdf")) {
    if (!["STARTER", "VETERINARY", "INCIDENT"].includes(fileType)) {
      throw new Error(`PDF (.pdf) files are only supported for STARTER, VETERINARY, and INCIDENT reports.`);
    }
    parsedResult = await parsePdfReport(buffer);
  } else {
    parsedResult = await parseExcelRows(buffer);
  }

  // Rule a: Check file fits chosen type
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
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: "File is empty or contains no readable data rows" }],
      unmatched: [],
      message: "Validation failed: File contains no data rows.",
    };
  }

  // Rule d: Validate rows
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
      // Rule d: Mandatory per row for RACE and HISTORY: Venue, Race Date, Race Category, Race No, Distance, Horse Name
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

      // Optional columns: Placing, Current Rating, etc. may be blank
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
    } else if (["STARTER", "VETERINARY", "INCIDENT"].includes(fileType)) {
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

  // Rule e: All or nothing
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

  // Rule f: Pre-check: Ensure target races are not REVIEWED
  if (fileType === "RACE" || fileType === "HISTORY") {
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

  // Single database transaction
  const unmatched = [];
  let savedRowsCount = 0;
  let createdUploadedFile = null;

  await db.$transaction(async (tx) => {
    // Save copy of accepted file in uploads/
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const safeDiskFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const destinationPath = path.join(uploadsDir, safeDiskFileName);
    fs.writeFileSync(destinationPath, buffer);

    // Write UploadedFile row
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

    let nextHorseNum = await getMaxHorseNumber(tx);
    const getNextHorseId = () => {
      nextHorseNum++;
      return formatHorseId(nextHorseNum);
    };

    if (fileType === "MASTER") {
      for (const row of processedRows) {
        const existingHorse = await tx.horse.findFirst({
          where: {
            name: {
              equals: row.horseName,
              mode: "insensitive",
            },
          },
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
          await tx.horse.create({
            data: {
              horseId: getNextHorseId(),
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
      // Group rows by race
      const racesMap = new Map();
      for (const row of processedRows) {
        const key = `${row.venue}|${row.raceDate.toISOString().slice(0, 10)}|${row.raceNo}`;
        if (!racesMap.has(key)) {
          racesMap.set(key, {
            venue: row.venue,
            raceDate: row.raceDate,
            season: row.season,
            category: row.raceCategory,
            raceNo: row.raceNo,
            cardNo: row.cardNo,
            distance: row.distance,
            entries: [],
          });
        }
        racesMap.get(key).entries.push(row);
      }

      for (const raceData of racesMap.values()) {
        const raceClassification = raceType(raceData.category);

        const race = await tx.race.upsert({
          where: {
            venue_raceDate_raceNo: {
              venue: raceData.venue,
              raceDate: raceData.raceDate,
              raceNo: raceData.raceNo,
            },
          },
          update: {
            season: raceData.season || undefined,
            category: raceData.category,
            distance: raceData.distance,
            raceType: raceClassification,
            cardNo: raceData.cardNo || undefined,
          },
          create: {
            venue: raceData.venue,
            raceDate: raceData.raceDate,
            season: raceData.season,
            category: raceData.category,
            raceNo: raceData.raceNo,
            cardNo: raceData.cardNo,
            distance: raceData.distance,
            raceType: raceClassification,
            status: "OPEN",
          },
        });

        for (const entryRow of raceData.entries) {
          let horse = await tx.horse.findFirst({
            where: {
              name: {
                equals: entryRow.horseName,
                mode: "insensitive",
              },
            },
          });

          if (!horse) {
            horse = await tx.horse.create({
              data: {
                horseId: getNextHorseId(),
                name: entryRow.horseName,
                previousRuns: entryRow.previousRuns,
                currentRating: entryRow.currentRating,
                trainer: entryRow.trainer,
              },
            });
          } else {
            await tx.horse.update({
              where: { id: horse.id },
              data: {
                currentRating: entryRow.currentRating !== null ? entryRow.currentRating : horse.currentRating,
                trainer: entryRow.trainer || horse.trainer,
              },
            });
          }

          const entry = await tx.raceEntry.upsert({
            where: {
              raceId_horseId: {
                raceId: race.id,
                horseId: horse.id,
              },
            },
            update: {
              horseWeight: entryRow.horseWeight,
              shoes: entryRow.shoes,
              startGate: entryRow.startGate,
              weightDeclare: entryRow.weightDeclare,
              weightCarried: entryRow.weightCarried,
              jockey: entryRow.jockey,
              placing: entryRow.placing,
              timing: entryRow.timing,
              verdict: entryRow.verdict,
              trainer: entryRow.trainer,
              penetrometer: entryRow.penetrometer,
              railing: entryRow.railing,
            },
            create: {
              raceId: race.id,
              horseId: horse.id,
              horseWeight: entryRow.horseWeight,
              shoes: entryRow.shoes,
              startGate: entryRow.startGate,
              weightDeclare: entryRow.weightDeclare,
              weightCarried: entryRow.weightCarried,
              jockey: entryRow.jockey,
              placing: entryRow.placing,
              timing: entryRow.timing,
              verdict: entryRow.verdict,
              trainer: entryRow.trainer,
              penetrometer: entryRow.penetrometer,
              railing: entryRow.railing,
            },
          });

          // For HISTORY: insert run row into horse_run
          if (fileType === "HISTORY") {
            const raceRef = `${raceData.venue}${raceData.raceNo}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO horse_run (horse_pk, run_date, race_ref, category, distance, weight_carried, equipment, jockey, horse_weight, rating_text, time_text, penetrometer, shoes, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               ON CONFLICT (horse_pk, run_date, race_ref) DO NOTHING`,
              horse.id,
              raceData.raceDate,
              raceRef,
              raceData.category,
              raceData.distance,
              entryRow.weightCarried ? String(entryRow.weightCarried) : null,
              null,
              entryRow.jockey,
              entryRow.horseWeight,
              entryRow.currentRating ? String(entryRow.currentRating) : null,
              entryRow.timing,
              entryRow.penetrometer,
              entryRow.shoes,
              "HISTORY"
            );
          }

          savedRowsCount++;
        }

        // For RACE: call rateAndSaveRace automatically
        if (fileType === "RACE") {
          await rateAndSaveRace(race.id, tx);
        }
      }
    } else if (["STARTER", "VETERINARY", "INCIDENT"].includes(fileType)) {
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

            const existingRemark = entry[remarkField];
            const updatedRemark = existingRemark
              ? `${existingRemark} | ${reportRow.remark}`
              : reportRow.remark;

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

      // Re-rate affected races automatically
      for (const raceId of affectedRaces) {
        await rateAndSaveRace(raceId, tx);
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
  });

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

async function handleActiveHorseImport({ fileName, buffer, size, hash, uploadedBy, source = "UPLOAD" }) {
  const { horses, allRuns } = await parseActiveHorseFile(buffer);

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

  // Deduplicate runs in the file (6,253 rows contain 2 exact duplicates -> 6,251 distinct runs)
  const distinctRunsMap = new Map();
  for (const r of allRuns) {
    const key = `${r.horseName.toUpperCase()}|${r.runDate.toISOString().slice(0, 10)}|${r.raceRef}`;
    if (!distinctRunsMap.has(key)) {
      distinctRunsMap.set(key, r);
    }
  }
  const distinctRuns = Array.from(distinctRunsMap.values());

  let createdUploadedFile = null;

  await db.$transaction(
    async (tx) => {
      // 1. Save copy of accepted file in uploads/
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const safeDiskFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const destinationPath = path.join(uploadsDir, safeDiskFileName);
      fs.writeFileSync(destinationPath, buffer);

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

      // 3. Resolve and upsert horses
      let nextHorseNum = await getMaxHorseNumber(tx);
      const getNextHorseId = () => {
        nextHorseNum++;
        return formatHorseId(nextHorseNum);
      };

      const horsePkMap = new Map();

      for (const h of horses) {
        const normName = h.name.trim();
        const runCount = h.runs ? h.runs.length : 0;
        let existing = await tx.horse.findFirst({
          where: {
            name: {
              equals: normName,
              mode: "insensitive",
            },
          },
          select: { id: true, name: true, previousRuns: true },
        });

        if (!existing) {
          existing = await tx.horse.create({
            data: {
              horseId: getNextHorseId(),
              name: normName,
              previousRuns: runCount,
              active: true,
            },
            select: { id: true, name: true, previousRuns: true },
          });
        } else {
          await tx.horse.update({
            where: { id: existing.id },
            data: {
              previousRuns: Math.max(existing.previousRuns || 0, runCount),
            },
          });
        }
        horsePkMap.set(normName.toUpperCase(), existing.id);
      }

      // 4. Batch insert distinct run rows into horse_run using ON CONFLICT DO NOTHING
      const chunkSize = 500;
      for (let i = 0; i < distinctRuns.length; i += chunkSize) {
        const chunk = distinctRuns.slice(i, i + chunkSize);
        for (const run of chunk) {
          const horsePk = horsePkMap.get(run.horseName.toUpperCase());
          if (!horsePk) continue;

          await tx.$executeRawUnsafe(
            `INSERT INTO horse_run (
               horse_pk, run_date, race_ref, category, distance, weight_carried,
               equipment, jockey, horse_weight, rating_text, time_text, penetrometer, shoes, source
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
             ) ON CONFLICT (horse_pk, run_date, race_ref) DO NOTHING`,
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
      timeout: 120000,
    }
  );

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

// Helper to read the exact display value as shown on screen in Excel (respecting cell numFmt)
function getExcelDisplayValue(cell) {
  if (!cell) return null;
  const raw = cell.value;
  if (raw === null || raw === undefined || raw === "" || raw === "-") return null;

  let val = typeof raw === "object" && raw.result !== undefined ? raw.result : raw;
  if (typeof val !== "number") {
    const parsed = Number(String(val).trim());
    if (!Number.isFinite(parsed)) return null;
    val = parsed;
  }

  // Check Excel number format (e.g. '0', '#,##0', etc.) to match exact Excel on-screen display
  const numFmt = cell.numFmt || cell.style?.numFmt;
  if (numFmt) {
    const fmt = String(numFmt).trim();
    if (fmt === "0" || fmt === "#,##0") {
      return Math.round(val);
    }
    const decMatch = fmt.match(/\.([0#]+)/);
    if (decMatch) {
      return Number(val.toFixed(decMatch[1].length));
    }
  }

  return Math.round(val);
}

// ─── Dynamic Coefficient Workbook Ingestion ──────────────────────────────────

async function handleCoefficientImport({ fileName, buffer, size, hash, uploadedBy, source = "UPLOAD" }) {
  const lowerName = fileName.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: "Dynamic Coefficients file must be an Excel workbook (.xlsx or .xls)" }],
      unmatched: [],
      message: "Validation failed: Unsupported file extension.",
    };
  }

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch (err) {
    return {
      success: false,
      savedRows: 0,
      rejectedRows: 0,
      errors: [{ row: 0, column: "File", reason: `Unable to read Excel workbook: ${err.message}` }],
      unmatched: [],
      message: "Validation failed: Corrupt or unreadable Excel file.",
    };
  }

  // Find target sheet with required columns
  let targetWs = null;
  let headerRowIdx = -1;
  let catCol = -1, distCol = -1, rcCol = -1;
  let weightCol = -1, timeCol = -1, lengthCol = -1, peneCol = -1, pValCol = -1;

  for (const ws of workbook.worksheets) {
    ws.eachRow((row, r) => {
      let cCat = -1, cDist = -1, cRc = -1;
      let cWeight = -1, cTime = -1, cLength = -1, cPene = -1, cPVal = -1;
      for (let c = 1; c <= row.cellCount; c++) {
        const val = row.getCell(c).value;
        const text = String(val && typeof val === "object" ? val.result || val.text || "" : val || "").trim().toLowerCase();
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
        targetWs = ws;
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
    });
    if (targetWs) break;
  }

  if (!targetWs) {
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

  // Parse and validate rows
  const errors = [];
  const processedRows = [];
  const seenCombinations = new Set();

  for (let r = headerRowIdx + 1; r <= targetWs.rowCount; r++) {
    const row = targetWs.getRow(r);
    const catVal = row.getCell(catCol).value;
    const cat = cleanString(catVal);
    const distVal = row.getCell(distCol).value;
    const dist = cleanInt(distVal);

    // Skip empty lines, footnote/note rows, or non-data rows without a distance
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

    // Rating Change from Median Reference: extract exact Excel display value (as seen on screen)
    const ratingChange = getExcelDisplayValue(row.getCell(rcCol));

    const parseOptionalFloat = (col) => {
      if (col === -1) return 0;
      const v = row.getCell(col).value;
      if (v === null || v === undefined || v === "" || v === "-") return 0;
      if (typeof v === "number") return Number.isFinite(v) ? v : 0;
      if (typeof v === "object" && v.result !== undefined) {
        const n = Number(v.result);
        return Number.isFinite(n) ? n : 0;
      }
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

  // Single transaction: Replace all rows in Coefficient table, record in uploaded_file
  let createdUploadedFile = null;
  await db.$transaction(
    async (tx) => {
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const safeDiskFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      fs.writeFileSync(path.join(uploadsDir, safeDiskFileName), buffer);

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

      // Wipe and replace coefficient table
      await tx.coefficient.deleteMany();

      for (const row of processedRows) {
        await tx.coefficient.create({
          data: {
            category: row.category,
            distance: row.distance,
            ratingChange: row.ratingChange,
            weight: row.weight,
            time: row.time,
            length: row.length,
            penetrometer: row.penetrometer,
            overall: row.overall,
          },
        });
      }

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
    { timeout: 60000 }
  );

  // After COEFFICIENT upload, re-rate all open (non-REVIEWED) races
  let reRatedCount = 0;
  try {
    const reRated = await reRateAllOpenRaces();
    reRatedCount = reRated.filter((r) => r.ok).length;
  } catch (err) {
    console.error("Error during reRateAllOpenRaces after COEFFICIENT upload:", err);
  }

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

