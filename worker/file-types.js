// worker/file-types.js
// Resolves HRA fileType from incoming file name using centralized naming rules.
// Mapping rules:
// - Consolidated -> HISTORY
// - Active Horse -> ACTIVE_HORSE
// - Coefficient -> COEFFICIENT
// - Starter -> STARTER
// - Veterinary -> VETERINARY
// - Incident -> INCIDENT
// Unknown names return null and are skipped.

/**
 * Determines fileType from a file name.
 *
 * @param {string} fileName The base or relative file name
 * @returns {"COEFFICIENT" | "HISTORY" | "ACTIVE_HORSE" | "STARTER" | "VETERINARY" | "INCIDENT" | null}
 */
export function detectFileType(fileName) {
  if (!fileName || typeof fileName !== "string") return null;

  const lower = fileName.toLowerCase();

  // 1. Coefficient -> COEFFICIENT
  if (lower.includes("coefficient") || lower.includes("p-value") || lower.includes("rating example")) {
    return "COEFFICIENT";
  }

  // 2. Consolidated -> HISTORY
  if (lower.includes("consolidated") || lower.includes("history") || lower.includes("bwm") || lower.includes("bsm")) {
    return "HISTORY";
  }

  // 3. Active Horse -> ACTIVE_HORSE
  if (lower.includes("active horse") || lower.includes("perfomance") || lower.includes("performance")) {
    return "ACTIVE_HORSE";
  }

  // 4. Starter -> STARTER
  if (lower.includes("starter")) {
    return "STARTER";
  }

  // 5. Veterinary -> VETERINARY
  if (lower.includes("veterinary") || lower.includes("vet")) {
    return "VETERINARY";
  }

  // 6. Incident -> INCIDENT
  if (lower.includes("incident")) {
    return "INCIDENT";
  }

  // Unknown names return null and are skipped
  return null;
}
