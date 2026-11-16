# HRA Data Formats Documentation

This document describes the schema, structure, column headers, example rows, formats, special values, and cross-file differences for all data files in the `data/` directory of the Horse Rating Automation (HRA) project.

---

## 1. `data/Active Horse Previous perfomance report.xlsx`

### Overview
* **Sheet Name:** `Sheet1`
* **Total Rows:** 9,205 rows
* **Structure:** Multi-block grouped format. Each horse block contains a 3-row summary card followed by historical race-by-race run records.
* **Horses Represented:** Active horses registered with Bangalore Turf Club (e.g., SERDAR, STAR ADMIRAL, etc.).

### Section A: Horse Summary Block (Repeats per horse)
* **Row 1:** Horse Name (e.g., `SERDAR`)
* **Row 2 Headers (in exact order):**
  1. `Starts`
  2. `First`
  3. `Second`
  4. `Third`
  5. `Fourth`
  6. `Unplaced`
  7. `Total Stakes`
* **Row 3 Data Example:**
  ```json
  {
    "Starts": 19,
    "First": 2,
    "Second": 2,
    "Third": 2,
    "Fourth": 3,
    "Unplaced": 10,
    "Total Stakes": 2052374
  }
  ```

### Section B: Performance History Table (Under each horse)
* **Exact Column Headers in Order (17 columns):**
  1. `Race Date`
  2. `Race No.`
  3. `Category`
  4. `Dist`
  5. `Weight/Cr.`
  6. `Eqp`
  7. `Jockey`
  8. `Bkodds`
  9. `Horse Wt`
  10. `Place`
  11. `Rating`
  12. `Time`
  13. `Time Diff.`
  14. `Lng Diff.`
  15. `Penetro.`
  16. `Shoes`
  17. `Stakes`

### 3 Example Rows
#### Row 1 (SERDAR - Run 1)
```json
{
  "Race Date": "2025-07-13T00:00:00.000Z",
  "Race No.": "BNG124",
  "Category": "40-65",
  "Dist": 1800,
  "Weight/Cr.": 58,
  "Eqp": "(ts) (cnb)",
  "Jockey": "Srinath(5)",
  "Bkodds": "/",
  "Horse Wt": 475,
  "Place": "2026-07-07T00:00:00.000Z",
  "Rating": "56-0",
  "Time": "1899-12-30T00:01:59.448Z",
  "Time Diff.": 10.589,
  "Lng Diff.": 64.5,
  "Penetro.": 4.1,
  "Shoes": "HA HA A A",
  "Stakes": 0
}
```

#### Row 2 (SERDAR - Run 2)
```json
{
  "Race Date": "2025-06-25T00:00:00.000Z",
  "Race No.": "MYS40",
  "Category": "20-45",
  "Dist": 1600,
  "Weight/Cr.": 61,
  "Eqp": "(ts) (cnb)",
  "Jockey": "A Rozario(7)",
  "Bkodds": "2026-10-18T00:00:00.000Z",
  "Horse Wt": 474,
  "Place": "2026-08-01T00:00:00.000Z",
  "Rating": "*-*",
  "Time": "1899-12-30T00:01:39.454Z",
  "Time Diff.": 0,
  "Lng Diff.": 0,
  "Penetro.": 2.79,
  "Shoes": "HA HA A A",
  "Stakes": 225000
}
```

#### Row 3 (SERDAR - Run 3)
```json
{
  "Race Date": "2025-06-18T00:00:00.000Z",
  "Race No.": "MYS34",
  "Category": "40-65",
  "Dist": 1400,
  "Weight/Cr.": "53/49.5",
  "Eqp": "(ts) (cnb)",
  "Jockey": "Abhishek M(8)",
  "Bkodds": "2026-02-09T00:00:00.000Z",
  "Horse Wt": 475,
  "Place": "2026-10-04T00:00:00.000Z",
  "Rating": "*-*",
  "Time": "1899-12-30T00:01:30.023Z",
  "Time Diff.": 0,
  "Lng Diff.": 2.85,
  "Penetro.": 2.7,
  "Shoes": "HA HA A A",
  "Stakes": 35940
}
```

### Formats, Blank Columns & Special Values
* **Date Formats:** ISO timestamps in Excel (`YYYY-MM-DD`). In some rows, fractional odds/placings are parsed as date objects by Excel (e.g. `1/10` becoming a date).
* **Number Formats:** Integer for `Dist`, `Starts`, `Stakes`; Floating point for `Penetro.`, `Time Diff.`, `Lng Diff.`. `Weight/Cr.` can be either single numeric (`58`) or compound string (`53/49.5` representing declared weight / carried weight).
* **Columns Sometimes Blank:** `Stakes`, `Eqp`, `Bkodds`, `Time Diff.`.
* **Special Values:**
  * `*-*`: Unrated / rating not published.
  * `*`: Suffix indicating unrated status.
  * `/`: Bookmaker odds unavailable.
  * `56-0`: Rating change expression (`PreviousRating - Change`).

---

## 2. `data/BTC Scenarios for Mohan.xlsx`

### Overview
* **Sheet Name:** `Sheet1`
* **Total Rows:** 27 rows
* **Purpose:** Test/benchmarking scenarios created by BTC for validating rating calculations and exception handling.

### Scenario 1: Category `00-25`, Distance `1100` (Rows 2–12)
* **Headers in Exact Order (7 columns):**
  1. `Horse Name`
  2. `Current Rating`
  3. `Placing`
  4. `Time (secs)`
  5. `Verdict/Length`
  6. `No.of Previous races performed`
  7. `Starter Remarks `

#### 3 Example Rows (Scenario 1)
```json
// Row 1 (H4 - Winner)
{
  "Horse Name": "H4",
  "Current Rating": 22,
  "Placing": 1,
  "Time (secs)": 66,
  "Verdict/Length": 2.25,
  "No.of Previous races performed": 4,
  "Starter Remarks": null
}

// Row 2 (H1 - 2nd Place)
{
  "Horse Name": "H1",
  "Current Rating": 25,
  "Placing": 2,
  "Time (secs)": 67,
  "Verdict/Length": 3,
  "No.of Previous races performed": 4,
  "Starter Remarks": null
}

// Row 3 (H3 Male - Unrated Runner)
{
  "Horse Name": "H3 (Male)",
  "Current Rating": "*",
  "Placing": 7,
  "Time (secs)": 72,
  "Verdict/Length": 3.75,
  "No.of Previous races performed": 2,
  "Starter Remarks": null
}
```

### Scenario 2: Category `20-45`, Distance `1400` (Rows 14–27)
* **Headers in Exact Order (8 columns):**
  1. `Horse Name`
  2. `Current Rating`
  3. `Placing`
  4. `Time (secs)`
  5. `Verdict/Length`
  6. `No.of Previous races performed`
  7. `Veterinary Remarks `
  8. `Incident Report `

#### 3 Example Rows (Scenario 2)
```json
// Row 1 (H16 - Winner)
{
  "Horse Name": "H16",
  "Current Rating": 24,
  "Placing": 1,
  "Time (secs)": 98,
  "Verdict/Length": 12.5,
  "No.of Previous races performed": 5,
  "Veterinary Remarks": null,
  "Incident Report": null
}

// Row 2 (H14 - Veterinary Exception)
{
  "Horse Name": "H14",
  "Current Rating": 25,
  "Placing": 8,
  "Time (secs)": 93,
  "Verdict/Length": 8.25,
  "No.of Previous races performed": 5,
  "Veterinary Remarks": "Bleeding injury",
  "Incident Report": null
}

// Row 3 (H19 - Incident Exception)
{
  "Horse Name": "H19",
  "Current Rating": 37,
  "Placing": 9,
  "Time (secs)": 87,
  "Verdict/Length": 1.75,
  "No.of Previous races performed": 4,
  "Veterinary Remarks": null,
  "Incident Report": "Not putting sufficient effort"
}
```

### Formats, Blank Columns & Special Values
* **Columns Sometimes Blank:** `Starter Remarks `, `Veterinary Remarks `, `Incident Report `.
* **Special Values:**
  * `*`: Represents an unrated horse (e.g. `H3 (Male)` with `Current Rating = "*"` and 2 runs).
  * `Walked out of the gates`: Starter exception (BRD 5.3.a).
  * `Bleeding injury`: Veterinary exception (BRD 5.3.b).
  * `Not putting sufficient effort`: Incident exception (BRD 5.3.c).

---

## 3. `data/BWM-BSM 22-26-Consolidated (1).xlsx`

### Overview
* **Sheet Name:** `BWM & BSM 22-26 Master`
* **Total Rows:** 14,089 (1 header row + 14,082 data rows)
* **Purpose:** Comprehensive historical master race ledger from 2021 to 2026 across Bangalore Winter Meeting (BWM) and Bangalore Summer Meeting (BSM).

### Exact Column Headers in Order (22 columns)
1. `Venue`
2. `Race Date`
3. `Race Season`
4. `Race Category`
5. `Race No`
6. `Card No`
7. `Distance`
8. `Current Rating`
9. `Horse Name`
10. `Horse Weight`
11. `Shoes`
12. `Start Gate`
13. `Weight Declare`
14. `Jockey`
15. `Weight Carried`
16. `Placing`
17. `Timing`
18. `Verdict`
19. `Change Rating`
20. `Trainer`
21. `Penetrometer  Reading`
22. `Railing Position`

### 3 Example Rows
#### Row 1 (Standard Runner)
```json
{
  "Venue": "BNG",
  "Race Date": "26/11/2021",
  "Race Season": "Bangalore Winter Meeting 2021-2022",
  "Race Category": "00-25",
  "Race No": 59,
  "Card No": 1,
  "Distance": 1400,
  "Current Rating": 16,
  "Horse Name": "RAW GOLD",
  "Horse Weight": 420,
  "Shoes": "A A A A ",
  "Start Gate": 6,
  "Weight Declare": 58,
  "Jockey": "Vivek",
  "Weight Carried": 60,
  "Placing": 2,
  "Timing": "1:29.80",
  "Verdict": "2 1/4",
  "Change Rating": 2,
  "Trainer": "Pradeep Annaiah",
  "Penetrometer  Reading": 3.8,
  "Railing Position": "Railing fixed at average width of 4.0 meters"
}
```

#### Row 2 (Withdrawn / WDR Runner)
```json
{
  "Venue": "BNG",
  "Race Date": "26/11/2021",
  "Race Season": "Bangalore Winter Meeting 2021-2022",
  "Race Category": "00-25",
  "Race No": 59,
  "Card No": 6,
  "Distance": 1400,
  "Current Rating": 12,
  "Horse Name": "PERFECT HALO",
  "Horse Weight": "WDR",
  "Shoes": "A A A A ",
  "Start Gate": 5,
  "Weight Declare": 56,
  "Jockey": "Ahsan Qureshi",
  "Weight Carried": 58,
  "Placing": null,
  "Timing": null,
  "Verdict": null,
  "Change Rating": null,
  "Trainer": "Neil Darashah",
  "Penetrometer  Reading": 3.8,
  "Railing Position": "Railing fixed at average width of 4.0 meters"
}
```

#### Row 3 (Unrated Runner with Legacy -999)
```json
{
  "Venue": "BNG",
  "Race Date": "10/12/2021",
  "Race Season": "Bangalore Winter Meeting 2021-2022",
  "Race Category": "2YO",
  "Race No": 85,
  "Card No": 3,
  "Distance": 1200,
  "Current Rating": -999,
  "Horse Name": "PRINCE ABIR",
  "Horse Weight": 440,
  "Shoes": "A A A A ",
  "Start Gate": 2,
  "Weight Declare": 57,
  "Jockey": "P. Trevor",
  "Weight Carried": 57,
  "Placing": 1,
  "Timing": "1:14.20",
  "Verdict": "3 1/2",
  "Change Rating": 30,
  "Trainer": "S. Attaollahi",
  "Penetrometer  Reading": 3.6,
  "Railing Position": "True"
}
```

### Formats, Blank Columns & Special Values
* **Date Formats:** Formatted as strings (`DD/MM/YYYY`) or Excel Serial Dates.
* **Columns Sometimes Blank:**
  * `Change Rating`: 7,239 / 14,082 (51.4% blank) — runners where rating did not change or was not revised.
  * `Verdict`: 2,057 / 14,082 (14.6% blank) — blank for winners and unplaced/withdrawn horses.
  * `Placing` & `Timing`: 537 / 14,082 (3.8% blank) — withdrawn or did not start.
  * `Shoes`, `Start Gate`, `Jockey`, `Weight Carried`: ~0.5% blank.
* **Special Values:**
  * `-999`: Legacy indicator for unrated horses in `Current Rating` and `Change Rating`. *(HRA Rule: In the new database, unrated must be stored as `null`, never `-999`)*.
  * `WDR`: Stored in `Horse Weight`, `Shoes`, or `Placing` when a horse was officially withdrawn.
  * `0`: Sometimes present in `Horse Weight` or `Change Rating`.
  * `-`: Stored in `Verdict` when lengths behind is zero or not applicable.

---

## 4. `data/Summary of P-Values & Coefficients with Rating Example.xlsx`

### Overview
* **Sheets (2 sheets):**
  1. `Summary of Model Results` (9 rows, statistical regression findings across 51 BTC econometric models)
  2. `Rating Example` (55 rows, coefficient lookup tables across race categories and distances with an 8-horse simulation)

### Sheet 1: `Summary of Model Results`
* **Headers in Exact Order (3 columns):**
  1. `Statistical Finding`
  2. `Evidence from Summary of P-values & Coefficients`
  3. `Business Interpretation`
* **Key Evidence:**
  * 42 of 51 models (≈82%) were statistically significant ($P < 0.05$).
  * Weight Carried is statistically significant in 45 of 51 models (≈88%) with positive coefficients ranging from 1.12 to 2.42 (justifying the approved rule of $1\text{ kg} = 2\text{ rating points}$).

### Sheet 2: `Rating Example`
* **Headers in Exact Order (13 specification columns + 8 runner simulation columns + 4 output columns):**
  1. `S.No.`
  2. `Race Category`
  3. `Distance`
  4. `Weight Carried Coefficient`
  5. `Time (secs) Coefficient`
  6. `Median Time (secs)`
  7. `Length Coefficient`
  8. `Penetrometer Reading Coefficient`
  9. `Rating Change from Median Referance`
  10. `Overall Regression Model P-Value`
  11. `Railing Position`
  12. `Rating Logic`
  13. `H1` to `H8` (Runner times in seconds)
  14. `Horse Reference`
  15. `Time in Sec`
  16. `Rank`
  17. `Change in Rating based on Coefficient`

#### 3 Example Rows (`Rating Example` sheet)
```json
// Example 1: 00-25 / 1100m
{
  "S.No.": 1,
  "Race Category": "00-25",
  "Distance": 1100,
  "Weight Carried Coefficient": 1.413,
  "Time (secs) Coefficient": 0.064,
  "Median Time (secs)": 70,
  "Length Coefficient": 0.029,
  "Penetrometer Reading Coefficient": -1.3,
  "Rating Change from Median Referance": 1.413,
  "Overall Regression Model P-Value": 0,
  "Railing Position": "Insignificant",
  "Horse Reference": "H8",
  "Rank": "R1",
  "Change in Rating based on Coefficient": 4
}

// Example 2: 00-25 / 1200m
{
  "S.No.": 2,
  "Race Category": "00-25",
  "Distance": 1200,
  "Weight Carried Coefficient": 1.5123,
  "Time (secs) Coefficient": -0.266,
  "Median Time (secs)": 77,
  "Length Coefficient": 0.1104,
  "Penetrometer Reading Coefficient": 0.812,
  "Rating Change from Median Referance": 2.1687,
  "Overall Regression Model P-Value": 0,
  "Railing Position": "Insignificant",
  "Horse Reference": "H5",
  "Rank": "R2",
  "Change in Rating based on Coefficient": 3
}

// Example 3: 00-25 / 1400m
{
  "S.No.": 3,
  "Race Category": "00-25",
  "Distance": 1400,
  "Weight Carried Coefficient": 1.5837,
  "Time (secs) Coefficient": -0.0865,
  "Median Time (secs)": 90,
  "Length Coefficient": 0.024,
  "Penetrometer Reading Coefficient": -0.119,
  "Rating Change from Median Referance": 1.5837,
  "Overall Regression Model P-Value": 0,
  "Railing Position": "Insignificant",
  "Horse Reference": "H3",
  "Rank": "R3",
  "Change in Rating based on Coefficient": 2
}
```

---

## 5. `data/sample-data.json` & `data/sample-data_1.json`

### Overview
* **Format:** JSON structure containing 10 top-level arrays/objects: `meta`, `users`, `today`, `dashboard`, `filesByRace`, `master`, `history`, `races`, `horses`, `audit`.
* **Total Counts:** 5 races, 50 horses (8–12 per race), 8 audit records, 3 system users.

### Schema of `horses` Array (28 fields per horse)
1. `raceId` (string, e.g. `"R5"`)
2. `horseName` (string)
3. `sex` (string, `"C&G"` or `"F&M"`)
4. `previousRuns` (integer)
5. `currentRating` (integer or `null`)
6. `placing` (integer)
7. `timing` (string, e.g. `"1:24.6"`)
8. `verdict` (string, e.g. `"1 L"`)
9. `horseWeight` (number)
10. `shoes` (string)
11. `weightDeclare` (number)
12. `weightCarried` (number)
13. `jockey` (string)
14. `trainer` (string)
15. `penetrometer` (number)
16. `railing` (string)
17. `starterObs` (string, `"-"` if none)
18. `vetObs` (string, `"-"` if none)
19. `incidentObs` (string, `"-"` if none)
20. `exception` (string)
21. `recommendedRating` (integer or `null`)
22. `override` (boolean)
23. `overrideRating` (integer or `null`)
24. `finalChange` (integer or `null`)
25. `finalRating` (integer or `null`)
26. `reason` (string)
27. `overrideReason` (string or `null`)
28. `trace` (object: `classification`, `eligibility`, `referencePosition`, `weightAdjustment`, `coefficient`, `exceptionApplied`)

### Differences Between `sample-data.json` and `sample-data_1.json`
A direct comparison between the two JSON files reveals the following differences:
1. **Classification of Race R1:**
   * In `sample-data.json`, Race R1 is classified as a **Terms** race (`type: "Terms"`, category `"2YO"`, 1000m). Winner `Sandstorm` has `currentRating: null` and receives baseline 30 (`reason: "Unrated winner: starts at 30 (C&G)"`). Placed horses have no change.
   * In `sample-data_1.json`, Race R1 is classified as a **Handicap** race (`type: "Handicap"`), and runners are evaluated against a 4th-position reference with negative drops below the median.
2. **Ratings and Overrides on Runners in R1:**
   * Runners such as `Dawn Patrol`, `Olive Branch`, and `Highland Mist` have different current ratings, weight declarations, and override statuses between the two versions.
   * In `sample-data.json`, `unrated: false` is explicitly included on rated runners; in `sample-data_1.json`, this key is omitted.
3. **Audit Trail Entries:**
   * The audit trail in `sample-data.json` matches the Terms race outcomes in R1 and R2, whereas `sample-data_1.json` contains override logs corresponding to Handicap calculations.
