// lib/reports/readReportFile.js
// Report Reader for Bangalore Turf Club (BTC)
// Turns tabular/text report files (.txt, .xlsx, .xls, .csv) into standardized lines and tables.
// PDF and Word (.doc/.docx) reports are handled by the Python backend (/api/upload-report).

import * as XLSX from "xlsx";
import { parseMeetingDate } from "./parseReports.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Checks if a string looks like a numeric date (dd/mm/yyyy or yyyy-mm-dd)
 * and formats it into text date (e.g. "17 May 2025") so parseMeetingDate recognizes it.
 */
function normalizeDateHeading(str) {
  if (!str) return null;
  const trimmed = String(str).trim();

  // dd/mm/yyyy or dd-mm-yyyy
  const m1 = trimmed.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const monthIdx = parseInt(m1[2], 10) - 1;
    const year = m1[3];
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${trimmed} (Meeting Date: ${day} ${MONTH_NAMES[monthIdx]} ${year})`;
    }
  }

  // yyyy-mm-dd
  const m2 = trimmed.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (m2) {
    const year = m2[1];
    const monthIdx = parseInt(m2[2], 10) - 1;
    const day = parseInt(m2[3], 10);
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${trimmed} (Meeting Date: ${day} ${MONTH_NAMES[monthIdx]} ${year})`;
    }
  }

  return null;
}

/**
 * Normalizes race heading strings (e.g. "Race 1" -> "1st Race: 1")
 * so parseReports.js regex (/^\s*(\d+)(?:st|nd|rd|th)?\s*Race\s*:\s*(\d+)/i) recognizes it.
 */
function normalizeRaceHeading(str) {
  if (!str) return null;
  const trimmed = String(str).trim();

  // Already standard format: "1st Race: 35" or "1 Race: 1"
  if (/^\s*(\d+)(?:st|nd|rd|th)?\s*Race\s*:\s*(\d+)/i.test(trimmed)) {
    return trimmed;
  }

  // "Race 1: Title" or "Race 1 - Title" or "Race 1"
  const m1 = trimmed.match(/^\s*Race\s*[:\-#]?\s*(\d+)(?:\s*[:\-]\s*(.*))?$/i);
  if (m1) {
    const rNo = parseInt(m1[1], 10);
    const title = m1[2] ? ` ${m1[2]}` : "";
    return `${rNo}st Race: ${rNo}.${title}`;
  }

  // "1st Race - Title" or "1st Race"
  const m2 = trimmed.match(/^\s*(\d+)(?:st|nd|rd|th)\s*Race(?:\s*[:\-]\s*(.*))?$/i);
  if (m2) {
    const rNo = parseInt(m2[1], 10);
    const title = m2[2] ? ` ${m2[2]}` : "";
    return `${rNo}st Race: ${rNo}.${title}`;
  }

  return null;
}

function isDateHeading(str) {
  if (!str) return null;
  const parsed = parseMeetingDate(str);
  if (parsed) return str;
  return normalizeDateHeading(str);
}

/**
 * Converts lines of plain text into HTML paragraphs and tables.
 */
function linesToHtml(lines) {
  const htmlParts = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for tab-separated columns
    if (trimmed.includes("\t")) {
      const cols = trimmed.split("\t").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 2) {
        const tds = cols.map((c) => `<td>${escapeHtml(c)}</td>`).join("");
        htmlParts.push(`<table><tr>${tds}</tr></table>`);
        continue;
      }
    }

    const dateNorm = isDateHeading(trimmed);
    const raceNorm = normalizeRaceHeading(trimmed);
    const lineText = dateNorm || raceNorm || trimmed;

    htmlParts.push(`<p>${escapeHtml(lineText)}</p>`);
  }

  return htmlParts.join("\n");
}

/**
 * Converts tabular rows (from .xlsx, .xls, .csv) into HTML.
 * Date headings and race headings become <p> tags.
 * Horse finding rows become table rows (or <p> tags for non-Veterinary reports).
 */
function rowsToHtml(rows, reportType) {
  const htmlParts = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const nonNullCells = row
      .map((c) => (c !== null && c !== undefined ? String(c).trim() : ""))
      .filter(Boolean);

    if (nonNullCells.length === 0) continue;

    const rowStr = nonNullCells.join(" ");

    // 1. Date Heading check
    const dateNorm = isDateHeading(rowStr);
    if (dateNorm) {
      htmlParts.push(`<p>${escapeHtml(dateNorm)}</p>`);
      continue;
    }

    // 2. Race Heading check
    const raceNorm = normalizeRaceHeading(rowStr);
    if (raceNorm) {
      htmlParts.push(`<p>${escapeHtml(raceNorm)}</p>`);
      continue;
    }

    // 3. Skip header rows (e.g. ["Horse Name", "Remark"])
    const firstCell = nonNullCells[0].toLowerCase();
    const secondCell = nonNullCells[1] ? nonNullCells[1].toLowerCase() : "";
    if (
      (firstCell.includes("horse") || firstCell === "sl no" || firstCell === "no") &&
      (secondCell.includes("remark") || secondCell.includes("finding") || secondCell.includes("obs") || secondCell.includes("horse"))
    ) {
      continue;
    }

    // 4. Data row: first column = horse, remaining columns = finding
    const horseName = nonNullCells[0];
    const finding = nonNullCells.slice(1).join(" | ").trim();

    if (!finding) {
      // Single-cell text: output as line paragraph
      htmlParts.push(`<p>${escapeHtml(horseName)}</p>`);
      continue;
    }

    if (reportType === "VETERINARY") {
      htmlParts.push(
        `<table><tr><td>${escapeHtml(horseName)}</td><td>${escapeHtml(finding)}</td></tr></table>`
      );
    } else if (reportType) {
      // Starter, Incidence, Stipe
      htmlParts.push(`<p>${escapeHtml(horseName)}: ${escapeHtml(finding)}</p>`);
    } else {
      // Fallback if reportType not specified: emit table row
      htmlParts.push(
        `<table><tr><td>${escapeHtml(horseName)}</td><td>${escapeHtml(finding)}</td></tr></table>`
      );
    }
  }

  return htmlParts.join("\n");
}

/**
 * Reads any accepted report file (.docx, .doc, .pdf, .txt, .xlsx, .xls, .csv)
 * and returns standardized HTML and the format name.
 *
 * @param {object} params
 * @param {Buffer} params.buffer File buffer
 * @param {string} params.fileName File name with extension
 * @param {string} [params.reportType] "STARTER" | "VETERINARY" | "INCIDENT" | "STIPE"
 * @returns {Promise<{ html: string, format: "Word" | "PDF" | "Excel" | "CSV" | "Text", rawText?: string }>}
 */
export async function readReportFile({ buffer, fileName, reportType }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Invalid buffer provided to readReportFile");
  }

  const name = String(fileName || "").toLowerCase();

  if (name.endsWith(".docx") || name.endsWith(".doc") || name.endsWith(".pdf")) {
    throw new Error("PDF and Word reports are parsed by the Python backend (/api/upload-report).");
  }

  // .txt (Text)
  if (name.endsWith(".txt")) {
    const text = buffer.toString("utf-8");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const html = linesToHtml(lines);
    return { html, format: "Text", rawText: text };
  }

  // 5. .xlsx, .xls (Excel) or .csv (CSV)
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const format = name.endsWith(".csv") ? "CSV" : "Excel";
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) {
      throw new Error(`Empty workbook in ${fileName}`);
    }

    const sheet = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      dateNF: "dd/mm/yyyy",
    });

    const html = rowsToHtml(rows, reportType);
    return { html, format };
  }

  throw new Error("Invalid file format. Accepted formats: Word, PDF, Excel, CSV, text.");
}
