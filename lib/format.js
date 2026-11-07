/**
 * Formatting helpers for dates, numbers, and ratings
 */

export function formatDate(dateStr) {
  if (!dateStr) return "07 Nov 2026";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function formatRatingChange(val) {
  if (val === null || val === undefined || isNaN(val)) return "-";
  const num = Number(val);
  if (num > 0) return `+${num}`;
  if (num === 0) return "0";
  return `${num}`;
}

export function formatNumber(val, decimals = 0) {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return Number(val).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
