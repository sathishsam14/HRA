// lib/import/aliases.js
// Header aliases for Excel imports in HRA (Horse Rating Automation).

export function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export const HEADER_ALIASES = {
  venue: ["venue", "race venue"],
  raceDate: ["race date", "date", "racedate", "date of race"],
  raceCategory: ["race category", "category", "race class", "class", "racecat", "race cat"],
  raceNo: ["race no", "race no.", "race number", "raceno", "race #"],
  cardNo: ["card no", "card no.", "card number", "cardno"],
  distance: ["distance", "dist", "race distance"],
  currentRating: ["current rating", "rating", "curr rating", "cur rating", "currentrating", "currat", "cur rat"],
  horseName: ["horse name", "horse", "horsename", "name of horse", "horse reference"],
  horseWeight: ["horse weight", "horse wt", "horse weight (kgs)", "horse wt.", "horswgt", "hors wgt"],
  shoes: ["shoes", "shoeing", "eqp", "shoe"],
  startGate: ["start gate", "gate", "draw", "starting gate", "startstall", "start stall", "stall"],
  weightDeclare: ["weight declare", "weight declared", "wt declare", "wt dec"],
  jockey: ["jockey", "jockey name"],
  weightCarried: ["weight carried", "weight/cr.", "weight cr", "wt carried", "wt cr", "weightcd", "weight cd"],
  placing: ["placing", "place", "rank", "finish position", "finishing position"],
  timing: ["timing", "time", "time (secs)", "time in sec"],
  verdict: ["verdict", "verdict/length", "length diff", "lng diff.", "margin", "lengths"],
  trainer: ["trainer", "trainer name"],
  penetrometer: ["penetrometer reading", "penetrometer", "penetro.", "penetrometer reading", "pent"],
  railing: ["railing position", "railing", "false rails"],
  season: ["race season", "season", "raceseason"],
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

export function matchHeaderKey(rawHeader) {
  const norm = normalizeHeader(rawHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(norm)) {
      return key;
    }
  }
  return null;
}
