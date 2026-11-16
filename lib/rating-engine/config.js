// ONE place for every rule value. Each ASSUMPTION is a gap in the BRD / HRA_Logic
// that BTC must confirm. Change the value here and nothing else in the app changes.
export const CONFIG = {
  minRuns: 3,                       // BRD 5.2 (2a, 3a)
  startRating: { M: 30, F: 27 },    // BRD 5.2 (2b): C&G = male 30, F&M = female 27
  // Reference position: 8 or more finishers -> 4th place; 4 to 7 finishers -> 3rd place (client rule). Exactly 3 finishers: BRD 3-horse rule.
  maxDecrease: 4,                   // BRD 5.2 (3d): decrease below median capped at 4
  capIncrease: false,               // BRD 5.2 (4): no ceiling. HRA_Logic 1.12/2.9 says cap 4 both ways (conflict -> BRD wins)
  pSignificant: 0.05,               // coefficient workbook: component counts only if p <= 0.05
  overallPMax: 0.05,                // overall model p above this = row not reliable -> Handicapper decides
  // BRD 5.2 (2b): all winners are rated. A new horse has 0 previous runs, so without this a new winner could never get the 30/27 start rating.
  winnerExemptFromMinRuns: true,
  weightPointsPerKg: 2,             // BRD 5.2 (2f)
  // DEVELOPER-PROPOSED formulas (BRD/HRA_Logic give the principle, not the formula). Needs Handicapper approval (BRD 5.2.2c).
  //  TERMS    : points = 2 x (weight carried by the horse - weight carried by the reference-position horse)
  //  HANDICAP : first 4 placings only: points = 2 x max(0, weight carried - weight declared)   ("extra weight")
  weightRule: 'off',                // 'off' | 'proposed'. OFF: the dictated Handicap rules do not use weight
  extraWeightPlaces: 4,             // BRD 5.2 (3g)
  rounding: 'nearest',              // ASSUMPTION: not stated anywhere. 'nearest' | 'none'
  // Race type rule (given by the developer/client meeting): categories with YO or Y&O (2YO, 3YO, 3Y&O, 4YO, 4Y&O, 4+YO) and 70+, 80+ are TERMS races.
  // Every other category (00-25, 20-45, 40-65, 60-85) is a HANDICAP race.
  termsPattern: /Y&O|YO/i,
  termsExact: ['70+', '80+'],
  // ASSUMPTION: history file uses 3Y&O / 4Y&O, coefficient workbook uses 3YO / 4YO. Treated as the SAME until BTC confirms.
  categoryAlias: { '3Y&O': '3YO', '4Y&O': '4YO', '4+YO': '4YO', '4YO+': '4YO' },
};
