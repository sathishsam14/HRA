// worker/file-types.js
// Resolves HRA fileType from incoming file name using simple, centralized naming rules.

/**
 * Determines fileType from a file name.
 *
 * @param {string} fileName The base or relative file name
 * @returns {"MASTER" | "RACE" | "HISTORY" | "STARTER" | "VETERINARY" | "INCIDENT" | null}
 */
export function detectFileType(fileName) {
  if (!fileName || typeof fileName !== "string") return null;

  const lower = fileName.toLowerCase();

  // 0. Coefficient Workbook (e.g., Summary of P-Values & Coefficients with Rating Example.xlsx)
  if (lower.includes("coefficient") || lower.includes("p-value") || lower.includes("rating example")) {
    return "COEFFICIENT";
  }

  // 1. Active Horse Report (e.g., Active Horse Previous perfomance report.xlsx)
  if (lower.includes("active horse") || lower.includes("perfomance") || lower.includes("performance")) {
    return "ACTIVE_HORSE";
  }

  // 2. Master Data (e.g., master.xlsx, master_data.xlsx)
  if (lower.includes("master")) {
    return "MASTER";
  }

  // 3. Incident Report (e.g., incident_05.pdf, incident_report.docx)
  if (lower.includes("incident")) {
    return "INCIDENT";
  }

  // 4. Veterinary Report (e.g., vet_05.pdf, veterinary.docx)
  if (lower.includes("vet") || lower.includes("veterinary")) {
    return "VETERINARY";
  }

  // 5. Starter Report (e.g., starter_05.docx, starter_report.xlsx)
  if (lower.includes("starter")) {
    return "STARTER";
  }

  // 6. Historical Race Ledger (e.g., history.xlsx, bwm, bsm)
  if (lower.includes("history") || lower.includes("bwm") || lower.includes("bsm")) {
    return "HISTORY";
  }

  // 7. Current Race Card (e.g., race_05_07nov.xlsx, race_card.xlsx, btc_scenarios)
  if (lower.includes("race") || lower.includes("card") || lower.includes("scenario")) {
    return "RACE";
  }

  return null;
}
