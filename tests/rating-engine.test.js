// tests/rating-engine.test.js
// Automated tests for HRA Rating Engine (BRD-BTC-HRA_Application.pdf)

import { test, expect } from "vitest";
import { rateRace, raceType, referencePosition } from "../lib/rating-engine/index.js";
import { CONFIG } from "../lib/rating-engine/config.js";

test("Race Type: Identifies Terms and Handicap categories", () => {
  expect(raceType("2YO")).toBe("TERMS");
  expect(raceType("3YO")).toBe("TERMS");
  expect(raceType("60-85")).toBe("HANDICAP");
  expect(raceType("40-65")).toBe("HANDICAP");
  expect(raceType("00-25")).toBe("HANDICAP");
});

test("Reference Position: 4th for >=8 runners, 3rd for 5-7 runners (BRD 5.2.3.f)", () => {
  expect(referencePosition(8)).toBe(4);
  expect(referencePosition(12)).toBe(4);
  expect(referencePosition(7)).toBe(3);
  expect(referencePosition(5)).toBe(3);
});

test("Handicap Race: 8 runners rating assessment with reference at 4th position", () => {
  const entries = [
    { horseName: "H1", placing: 1, currentRating: 52, previousRuns: 11, weightCarried: 60 },
    { horseName: "H2", placing: 2, currentRating: 48, previousRuns: 12, weightCarried: 58 },
    { horseName: "H3", placing: 3, currentRating: 55, previousRuns: 3, weightCarried: 57 },
    { horseName: "H4", placing: 4, currentRating: 50, previousRuns: 4, weightCarried: 56 },
    { horseName: "H5", placing: 5, currentRating: 46, previousRuns: 8, weightCarried: 55 },
    { horseName: "H6", placing: 6, currentRating: 58, previousRuns: 11, weightCarried: 54, starter: ["Slowly away"] },
    { horseName: "H7", placing: 7, currentRating: 44, previousRuns: 3, weightCarried: 53, veterinary: ["Lame"] },
    { horseName: "H8", placing: 8, currentRating: 41, previousRuns: 11, weightCarried: 52 },
  ];

  const results = rateRace({ category: "60-85", distance: 1400, entries });

  // 4th position is reference -> recommendedChange is 0
  const h4 = results.find((r) => r.horseName === "H4");
  expect(h4.recommendedChange).toBe(0);
  expect(h4.recommendedRating).toBe(50);

  // 6th position has starter remark "Slowly away" -> rating shall not decrease
  const h6 = results.find((r) => r.horseName === "H6");
  expect(h6.recommendedChange).toBe(0);
  expect(h6.recommendedRating).toBe(58);

  // 7th position has veterinary remark "Lame" -> rating shall not decrease
  const h7 = results.find((r) => r.horseName === "H7");
  expect(h7.recommendedChange).toBe(0);
  expect(h7.recommendedRating).toBe(44);

  // 8th position is below median -> decrease limited to 4 points (BRD 5.2.3.d)
  const h8 = results.find((r) => r.horseName === "H8");
  expect(h8.recommendedChange).toBe(-4);
  expect(h8.recommendedRating).toBe(37);
});

test("Constant Rating Conditions: Dropped the rider keeps rating unchanged (BRD 5.3.d)", () => {
  const entries = [
    { horseName: "H1", placing: 1, currentRating: 50, previousRuns: 5, weightCarried: 56 },
    { horseName: "H2", placing: 2, currentRating: 45, previousRuns: 5, weightCarried: 55 },
    { horseName: "H3", placing: 3, currentRating: 42, previousRuns: 5, weightCarried: 54 },
    { horseName: "H4", placing: 4, currentRating: 40, previousRuns: 5, weightCarried: 53 },
    { horseName: "H5", placing: 5, currentRating: 38, previousRuns: 5, weightCarried: 52, incident: ["Dropped the rider"] },
  ];

  const results = rateRace({ category: "40-65", distance: 1200, entries });
  const h5 = results.find((r) => r.horseName === "H5");
  expect(h5.status).toBe("UNCHANGED");
  expect(h5.recommendedChange).toBe(0);
  expect(h5.recommendedRating).toBe(38);
});
