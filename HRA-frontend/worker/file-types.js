// worker/file-types.js
// Resolves HRA fileType from incoming file name using centralized naming rules.
// Kept file types:
// 1) Master History (BSM) -> HISTORY
// 2) Current Race (BWM) -> RACE
// 3) Starter -> STARTER (Word, PDF, Excel, CSV, text)
// 4) Veterinary -> VETERINARY (Word, PDF, Excel, CSV, text)
// 5) Incidence -> INCIDENT (Word, PDF, Excel, CSV, text)
// 6) Stipendiary Stewards -> STIPE (Word, PDF, Excel, CSV, text)

export const REPORT_EXTENSIONS = [".docx", ".doc", ".pdf", ".txt", ".xlsx", ".xls", ".csv"];

/**
 * Determines fileType from a file name.
 *
 * @param {string} fileName The base or relative file name
 * @returns {"HISTORY" | "RACE" | "STARTER" | "VETERINARY" | "INCIDENT" | "STIPE" | null}
 */
export function detectFileType(fileName) {
  if (!fileName || typeof fileName !== "string") return null;

  const lower = fileName.toLowerCase();
  const isReportExt = REPORT_EXTENSIONS.some((ext) => lower.endsWith(ext));

  // 1. Master History (BSM / Consolidated master) -> HISTORY
  if (lower.includes("bsm") || lower.includes("consolidated") || lower.includes("master")) {
    return "HISTORY";
  }

  // 2. Current Race (BWM / Current race meeting) -> RACE
  if (lower.includes("bwm") || lower.includes("current") || lower.includes("race")) {
    return "RACE";
  }

  // 3. Starter -> STARTER (accepts Word, PDF, Excel, CSV, text)
  if (lower.includes("starter") && isReportExt) {
    return "STARTER";
  }

  // 4. Veterinary -> VETERINARY (accepts Word, PDF, Excel, CSV, text)
  if ((lower.includes("veterinary") || lower.includes("vet")) && isReportExt) {
    return "VETERINARY";
  }

  // 5. Incidence -> INCIDENT (accepts Word, PDF, Excel, CSV, text)
  if ((lower.includes("incident") || lower.includes("incidents") || lower.includes("incidence")) && isReportExt) {
    return "INCIDENT";
  }

  // 6. Stipendiary Stewards -> STIPE (accepts Word, PDF, Excel, CSV, text)
  if ((lower.includes("stipe") || lower.includes("stipendiary")) && isReportExt) {
    return "STIPE";
  }

  // Unknown names return null and are skipped
  return null;
}
