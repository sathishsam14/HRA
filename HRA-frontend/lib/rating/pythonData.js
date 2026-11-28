// lib/rating/pythonData.js
// Shared helpers for fetching read-only report evidence and BSM horse history
// from the Python backend without caching failed or empty responses.

/**
 * Calls Python POST /api/report-evidence for a list of horse names.
 * Returns { ok, byHorse: Map<UPPER_NAME, Array<{ report_date, source, flag, remark }>> }.
 */
export async function fetchReportEvidenceMap(horseNames, pythonApiUrl) {
  const uniqueHorses = Array.from(
    new Set((horseNames || []).map((h) => String(h || "").trim()).filter(Boolean))
  );
  const byHorse = new Map();
  if (uniqueHorses.length === 0) {
    return { ok: true, byHorse };
  }

  try {
    const res = await fetch(`${pythonApiUrl}/api/report-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horses: uniqueHorses }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, byHorse };
    }
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.evidence)) {
      return { ok: false, byHorse };
    }
    for (const ev of data.evidence) {
      const key = String(ev.horse || "").trim().toUpperCase();
      if (!key) continue;
      if (!byHorse.has(key)) byHorse.set(key, []);
      byHorse.get(key).push(ev);
    }
    return { ok: true, byHorse };
  } catch {
    return { ok: false, byHorse };
  }
}

/**
 * Filters report events to those dated on or before raceDateStr, up to 12 months (365 days) back.
 */
export function getHorseReportEventsInWindow(events, raceDateStr) {
  if (!Array.isArray(events) || events.length === 0 || !raceDateStr) return [];
  const raceDt = new Date(`${String(raceDateStr).slice(0, 10)}T00:00:00Z`);
  if (isNaN(raceDt.getTime())) return [];
  const minDt = new Date(raceDt.getTime() - 365 * 24 * 60 * 60 * 1000);

  return events.filter((ev) => {
    if (!ev?.report_date) return false;
    const evDt = new Date(`${String(ev.report_date).slice(0, 10)}T00:00:00Z`);
    if (isNaN(evDt.getTime())) return false;
    return evDt.getTime() <= raceDt.getTime() && evDt.getTime() >= minDt.getTime();
  });
}

function formatEventText(ev) {
  const parts = [];
  if (ev.flag) parts.push(String(ev.flag).trim());
  if (ev.remark) parts.push(String(ev.remark).trim());
  const body = parts.join(": ");
  return ev.report_date ? `${body} (${ev.report_date})` : body;
}

/**
 * Formats filtered report events into starterRemark, veterinaryRemark, incidentRemark, and combined exception.
 */
export function formatReportRemarksForEntry(events, raceDateStr) {
  const inWindow = getHorseReportEventsInWindow(events, raceDateStr);
  const starterItems = [];
  const vetItems = [];
  const incidentItems = [];
  const stipeItems = [];
  const seen = new Set();

  for (const ev of inWindow) {
    const src = String(ev.source || "").toLowerCase();
    const txt = formatEventText(ev);
    if (!txt) continue;
    const dedupKey = `${src}|${txt}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    if (src === "starter") starterItems.push(txt);
    else if (src === "vet") vetItems.push(txt);
    else if (src === "stewards") stipeItems.push(txt);
    else incidentItems.push(txt);
  }

  const starterRemark = starterItems.length > 0 ? starterItems.join(" | ") : null;
  const veterinaryRemark = vetItems.length > 0 ? vetItems.join(" | ") : null;
  const combinedIncident = [
    ...stipeItems.map((t) => `[Stipe] ${t}`),
    ...incidentItems,
  ];
  const incidentRemark = combinedIncident.length > 0 ? combinedIncident.join(" | ") : null;

  const exceptionParts = [
    starterRemark ? `[Starter] ${starterRemark}` : null,
    veterinaryRemark ? `[Vet] ${veterinaryRemark}` : null,
    ...stipeItems.map((t) => `[Stipe] ${t}`),
    ...incidentItems.map((t) => `[Incidents] ${t}`),
  ].filter(Boolean);

  return {
    starterRemark,
    veterinaryRemark,
    incidentRemark,
    exception: exceptionParts.length > 0 ? exceptionParts.join(" · ") : "None",
  };
}

/**
 * Calls Python POST /api/horse-history-summary for display-only career_runs, last_run_date, and layoff_days.
 */
export async function fetchHorseHistorySummary(entries, pythonApiUrl) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: true, summaries: {} };
  }
  try {
    const res = await fetch(`${pythonApiUrl}/api/horse-history-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, summaries: {} };
    }
    const data = await res.json();
    if (!data?.success || !data.summaries) {
      return { ok: false, summaries: {} };
    }
    return { ok: true, summaries: data.summaries };
  } catch {
    return { ok: false, summaries: {} };
  }
}
