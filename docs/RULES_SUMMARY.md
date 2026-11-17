# HRA Rules Summary

This document provides a comprehensive, clause-by-clause summary of the official rating rules from `docs/BRD-BTC-HRA_Application.pdf` (Version 1.0, 17th Oct. 2026), followed by an exhaustive analysis of discrepancies and conflicts found in `docs/HRA Logic.docx`.

Per **Rule 9 of AGENTS.md**: *"Source of truth: docs/BRD-BTC-HRA_Application.pdf. If documents conflict, the BRD wins."*

---

## Part 1: Official BRD Rating Rules (Numbered with Clause Numbers)

### 1. Functional Scope & Modules (BRD Clause 3.1, 4.0)
* **Rule 1 (Clause 3.1 & 4.0):** The HRA Application comprises exactly three core functional modules:
  1. **Rating Engine** (Input processing, performance rating, exception handling, system recommendation, override, final rating)
  2. **MIS** (Management Information System reporting across 29 statutory columns)
  3. **Audit Trail** (Tamper-evident, immutable history of all rating assessments and overrides)
* **Rule 2 (Clause 3.2):** Betting prediction, race winner forecasting, race scheduling, and automatic unreviewed publication of ratings are strictly out of scope.

---

### 2. General Eligibility & Inputs (BRD Clause 5.1, 5.2.2.a, 5.2.3.a)
* **Rule 3 (Clause 5.1):** The system shall process master horse data (Sex category, Number of Previous Runs) and current race inputs (Venue, Date, Season, Category, Race No, Card No, Distance, Current Rating, Horse Name, Horse Weight, Shoes, Start Gate, Weight Declared, Jockey, Weight Carried, Placing, Timing, Verdict, Trainer, Penetrometer Reading, Railing Position, Starter Report, Veterinary Report, Incident Report).
* **Rule 4 (Clause 5.2.2.a & 5.2.3.a):** **Minimum Run Eligibility:** Only horses with **at least 3 previous runs** shall be considered for rating adjustments, with the sole exception of race winners.
* **Rule 5 (Clause 5.2.2.b & 5.2.2.a):** **All race winners must be rated**, regardless of previous runs.

---

### 3. Terms Race Category Rules (BRD Clause 5.2.2)
* **Rule 6 (Clause 5.2.2.b & 5.2.1 Scenario 1):** **Baseline Initial Rating for Unrated Winners:**
  * Unrated Male winner (C&G - Colt & Gelding) receives **30** as initial baseline rating.
  * Unrated Female winner (F&M - Filly & Mare) receives **27** as initial baseline rating.
* **Rule 7 (Clause 5.2.2.c):** **Beaten Horse Reference:** If the winning horse beats a higher-rated horse, the rating of the beaten horse serves as the base for revising the winner's rating upward.
* **Rule 8 (Clause 5.2.2.d & 5.2.1 Scenario 7):** **Performance Not to Potential:** If a horse previously rated at a certain level does not perform to its potential in the current race, the horse retains its existing rating without any downward change.
* **Rule 9 (Clause 5.2.2.e):** **Report Verbatim Priority in Terms Races:** Notwithstanding verbatim remarks from Incident, Starter, or Veterinary reports, ratings may increase if performance is better; otherwise, the rating remains unchanged.
* **Rule 10 (Clause 5.2.2.f & 5.2.1 Scenario 4):** **Weight Equivalence Conversion:** Every 1 kg difference in weight carried corresponds to **2 rating points** ($1\text{ kg} = 2\text{ points}$).

---

### 4. Handicap Race Category Rules (BRD Clause 5.2.3, 5.2.4)
* **Rule 11 (Clause 5.2.3.b):** **Median from Placing:** The median benchmark shall be determined from the official race placing / finishing ranking.
* **Rule 12 (Clause 5.2.3.f & 5.2.1 Scenario 3):** **Starting Reference Position:**
  * For races with **8 or more runners**, the **4th position horse** is the starting reference point.
  * For races with **5 to 7 runners**, the **3rd position horse** is the starting reference point.
* **Rule 13 (Clause 5.2.3.e & 5.2.1 Scenario 5):** **Cumulative Increase Above Median:** For eligible horses finishing above the reference median (positions 1st, 2nd, 3rd), ratings increase cumulatively based on the approved Category & Distance coefficients up to the winner.
* **Rule 14 (Clause 5.2.3.d):** **Maximum Downward Drop Limit:** A rating drop for horses finishing below the reference median **cannot exceed a maximum of 4 points** (drop is capped at $-4$).
* **Rule 15 (Clause 5.2.4 & 5.2.1 Scenario 8):** **No Rating Ceiling:** The system-generated rating **shall not have any ceiling value** (ratings can increase by more than 4 points if justified by coefficients, weights, and margins).
* **Rule 16 (Clause 5.2.3.c & 5.2.1 Scenario 6):** **Three-Horse Race Rule:** In a race with only 3 runners:
  * The winner (1st) is rated up.
  * The 2nd-place horse receives **no rating change** ($0$).
  * The 3rd-place horse has its rating reduced according to the category/distance coefficient.
* **Rule 17 (Clause 5.2.3.g):** **Extra Weight Consideration:** Additional weight carried shall be factored into rating adjustments for the first 4 winning positions.

---

### 5. Approved Exception Logic (BRD Clause 5.3)
Before applying any downward rating adjustment, the system must evaluate official race-impacting exception reports:

* **Rule 18 (Clause 5.3.a): Starter Remarks — 6 Conditions (Rating shall NOT decrease; rating may increase):**
  1. `Slowly away`
  2. `Lost few lengths`
  3. `Walked out of the gates`
  4. `Planted`
  5. `Stopped galloping`
  6. `Lost many lengths`

* **Rule 19 (Clause 5.3.b): Veterinary Remarks — 6 Conditions (Rating shall NOT decrease; rating may increase):**
  1. `Lame`
  2. `Large cut injury`
  3. `EIPH` (Exercise-Induced Pulmonary Hemorrhage)
  4. `Stopped galloping`
  5. `Bleeding injury`
  6. `Clip injury`

* **Rule 20 (Clause 5.3.c): Incident Report — 19 Conditions (Rating shall NOT decrease; rating may increase):**
  1. `Enquiry opened`
  2. `Hanging in`
  3. `Hanging out`
  4. `Lugging in`
  5. `Lugging out`
  6. `Running green`
  7. `Running wide`
  8. `Taking a huge lead`
  9. `Stopped galloping`
  10. `Horse not galloping`
  11. `Dropping hands`
  12. `Saddle shifted`
  13. `Not improving his position`
  14. `Not putting sufficient effort`
  15. `Running in patches`
  16. `Whipped around after jumping out`
  17. `Reversal of form`
  18. `Snapped reins`
  19. `Broken Stirrups`

* **Rule 21 (Clause 5.3.d): Constant Rating Conditions — 4 Conditions (Rating remains strictly UNCHANGED, Change = 0):**
  1. `Death`
  2. `Ran riderless`
  3. `Did not finish`
  4. `Dropped the rider`

---

### 6. Handicapper Override & Audit Trail (BRD Clause 5.4, 7.0)
* **Rule 22 (Clause 5.4):** Only an authorized user (**Handicapper**) may override the system recommendation. Every override requires:
  1. `Final rating change`
  2. `Override reason / remarks`
  3. `User identification`
  4. `Date and time`
* **Rule 23 (Clause 5.4 & 7.0):** Every override must be written immediately to the immutable, append-only **Audit Trail**, preserving both the original system recommendation and the human justification.

---

### 7. Statutory MIS Output Standards (BRD Clause 5.5, 6.1)
* **Rule 24 (Clause 6.1):** The MIS reporting table must generate exactly **29 columns in standard order**:
  `Venue`, `Race Date`, `Race Season`, `Race Type`, `Race Category`, `Race No`, `Card No`, `Distance`, `Current Rating`, `Horse Name`, `Horse Weight`, `Shoes`, `Weight Declare`, `Jockey`, `Weight Carried`, `Placing`, `Timing`, `Verdict`, `Trainer`, `Penetrometer Reading`, `Railing Position`, `Starter Report observations`, `Veterinary Report observations`, `Incident Report observations`, `Recommended Rating`, `Override`, `Final Rating Change`, `Final Rating`, `Reason Explanation for decision`.

---

## Part 2: Conflicts & Discrepancies in `docs/HRA Logic.docx`

A thorough line-by-line comparison between `docs/HRA Logic.docx` and `docs/BRD-BTC-HRA_Application.pdf` reveals the following major conflicts:

| Area | BRD Specification (Source of Truth) | `HRA Logic.docx` Specification | Conflict Severity & Resolution |
| :--- | :--- | :--- | :--- |
| **1. Rating Increase Ceiling** | **Clause 5.2.4 & Clause 5.2.1 Scenario 8:**<br> *"The rating shall not have any ceiling value."* | **Step 1.12 & Step 2.9:**<br> *"Ensure no horse goes above 4 point increase or decrease"* | **CRITICAL CONFLICT.**<br>`HRA Logic.docx` artificially imposes an upper ceiling cap of $+4$ on increases. **BRD wins:** There is no ceiling on increases. Only the downward drop below median is capped at $-4$ (Clause 5.2.3.d). |
| **2. Terms Race Median Application** | **Clause 5.2.2:**<br> Terms races use baseline ratings (30/27), beating higher-rated horses, or retaining rating. Median reference position is strictly a Handicap concept (Clause 5.2.3). | **Step 1.5, 1.10, 1.11:**<br> Applies median reference and ranking placement to Terms races (*"Determine the Median based on the winning position / placing / ranking"*). | **HIGH CONFLICT.**<br>`HRA Logic.docx` conflates Terms and Handicap algorithms. **BRD wins:** Terms races do not use a 4th-position median drop. |
| **3. Blanket Keyword Freeze** | **Clause 5.3:**<br> Distinguishes between conditions where rating **cannot decrease but may increase** (6 Starter, 6 Vet, 19 Incident) and conditions where rating **remains unchanged** (4 Constant). | **Step 3.4:**<br> *"If any of the keywords found, do not change the rating"* | **HIGH CONFLICT.**<br>`HRA Logic.docx` freezes ratings entirely for any keyword, which would incorrectly prevent a winning or placing horse with a remark from receiving its earned rating increase. **BRD wins:** Rating may increase; only drops are prevented. |
| **4. Keyword Enumeration** | **Clause 5.3.a, b, c, d:**<br> Enumerates all 35 approved conditions across 4 precise legal categories. | **Step 3.1, 3.2, 3.3:**<br> Vaguely references *"Check listed Key words"* without enumerating the approved conditions. | **MODERATE CONFLICT.**<br>`HRA Logic.docx` is incomplete. **BRD wins:** All 35 approved conditions in BRD 5.3 are implemented. |
| **5. User Roles & Enforcement** | **AGENTS.md & BRD Clause 8:**<br> Roles are **Admin**, **Handicapper**, **Manger**. Manager is read-only, enforced on the server. Only Handicapper can override. | **Step 4.2:**<br> Only references *"an authorized user (Handicapper)"* without defining Admin or Manager boundaries. | **MODERATE.**<br>**AGENTS.md wins:** Server-enforced RBAC for Admin, Handicapper, and Manager. |

---

## Part 3: Operational Resolution Order

When implementing rating engine calculations and server validations:
1. **BRD-BTC-HRA_Application.pdf** is the primary source of truth.
2. In particular, **never cap rating increases at $+4$**; allow cumulative increases based on approved coefficients as required by Clause 5.2.4.
3. In Terms races, do not apply handicap median drops below 4th place.
4. For Starter, Veterinary, and Incident remarks, prevent negative drops while allowing legitimate rating increases for winning and placed runners.
5. Apply constant rating freeze ($\Delta = 0$) strictly to the 4 defined conditions: Death, Ran riderless, Did not finish, Dropped the rider.
