# HRA Rating Rules & Engine Specification

## Executive Summary

Race type: categories with YO or Y&O and 70+, 80+ are Terms; all others Handicap.
Steps:
1. Race type and finishers
2. New or rated horse
3. Minimum 3 previous runs
4. Constant conditions stop (unchanged)
5. Starter/veterinary/incident exception found = no decrease
6. Step value = Rating Change from Median Reference for the category and distance
7. Place against the reference (8+ finishers: 4th; 4 to 7: 3rd; exactly 3: winner up, 2nd unchanged, 3rd down), each place above is one step up (no limit), each place below one step down (total decrease at most 4)
8. Terms only: beaten higher-rated horse is the base
9. Weight rule off
10. Limits
11. Recommendation = previous rating + change

---

## 1. Race Classification

- **Terms Races**:
  - Categories containing `YO` or `Y&O` (case-insensitive), e.g. `2YO`, `3YO`, `3Y&O`, `4YO`, `4Y&O`, `4+YO`, `4YO+`.
  - Categories exactly matching `70+` or `80+`.
- **Handicap Races**:
  - All other race categories (e.g., `00-25`, `20-45`, `40-65`, `60-85`, etc.).

---

## 2. The 11 Rating Steps

Every horse entered in a race is evaluated strictly through the 11 steps below. The reasons generated at each step are appended to the horse's trace and displayed in the **Reason Explanation** column in the Rating Engine UI.

### Step 1: Race Type & Finishers
- Determine whether the race is a Terms or Handicap race from the category.
- Verify whether the horse actually finished the race with a valid placing ($> 0$).
- If no finishing position exists (e.g. withdrawn, scratched, did not start), status is marked `NOT_RATED` and evaluation stops.

### Step 2: New (Unrated) Horse or Already Rated
- If `currentRating` is present and valid, the current rating is adopted.
- If `currentRating` is `NULL` (unrated):
  - Male (`C&G`): Starts at base rating **30**.
  - Female (`F&M`): Starts at base rating **27**.
  - If sex category is missing or invalid: status is marked `NEEDS_HANDICAPPER`.

### Step 3: Eligibility (Minimum 3 Previous Runs)
- Evaluates the prior run count using `previous_runs(horse_pk, race_date)`.
- A horse must have at least **3 previous runs** to be eligible for automated rating adjustment.
- Exception: In a Terms race, the **winner (1st place)** is always rated regardless of run count.
- If fewer than 3 previous runs (and not an exempt winner), status is marked `NOT_ELIGIBLE` and evaluation stops.

### Step 4: Constant Rating Conditions (Immediate Stop)
- Checks whether any starter, veterinary, or incident observation contains a constant condition keyword.
- If a constant condition is detected, the horse's rating is completely **unchanged** (`status: UNCHANGED`, recommended change = 0, recommended rating = current rating).
- Constant condition keywords (4 conditions):
  1. `Death`
  2. `Ran riderless`
  3. `Did not finish`
  4. `Dropped the rider`

### Step 5: Starter, Veterinary & Incident Exceptions (No Decrease)
- Searches for approved exception phrases in the official reports/remarks for the runner.
- If any exception keyword is found, the horse **cannot have its rating decreased** (maximum drop becomes 0, but it may still increase).
- If reports are not supplied for the race, an informational note is added.

### Step 6: Step Value (Dynamic Coefficient Lookup)
- Queries the dynamic `Coefficient` table loaded from the client's Excel workbook for the given `category` and `distance`.
- Applies category aliases (`3Y&O` $\to$ `3YO`, `4Y&O` $\to$ `4YO`, `4+YO` / `4YO+` $\to$ `4YO`).
- Retrieves the **Rating Change from Median Reference**.
- If no matching row exists or the cell was blank, calculation stops and status is marked `NEEDS_HANDICAPPER`.

### Step 7: Placing Against Reference Position
- **8 or more finishers ($N \ge 8$)**:
  - Reference position is **4th place**.
  - 4th place receives a 0 change.
  - Each place above 4th: $+1 \times \text{stepValue}$ per place (3rd = $+1$, 2nd = $+2$, 1st = $+3$ steps).
  - Each place below 4th: $-1 \times \text{stepValue}$ per place (5th = $-1$, 6th = $-2$ steps, etc.).
- **4 to 7 finishers ($4 \le N \le 7$)**:
  - Reference position is **3rd place**.
  - 3rd place receives a 0 change.
  - Each place above 3rd gets $+1$ step; each place below gets $-1$ step.
- **Exactly 3 finishers ($N = 3$)**:
  - 1st place: $+1 \times \text{stepValue}$ (winner up).
  - 2nd place: $0$ (unchanged).
  - 3rd place: $-1 \times \text{stepValue}$ (third down).
- **Fewer than 3 finishers ($N < 3$)**:
  - Marked `NEEDS_HANDICAPPER` (insufficient field size to calculate median).

### Step 8: Terms Race Only – Higher-Rated Beaten Horse Base
- In a Terms race, if the winner beats a horse with a higher current rating, the highest beaten rating becomes the baseline calculation reference.

### Step 9: Weight Adjustment Rule (Currently Off)
- Weight rule configuration is set to `'off'` per approved BTC Handicap specifications.

### Step 10: Limits and Caps
- **Maximum Decrease**: A horse's rating decrease is capped at a maximum reduction of **4 points** (`total = max(total, -4)`).
- **Exception Protection**: If an exception from Step 5 was triggered, any negative total is reset to **0** (`total = max(0, total)`).
- **Terms Races**: In Terms races, ratings never decrease (`total = max(0, total)`).
- **Ceiling**: No upper limit on increases (`capIncrease: false`).

### Step 11: Final Recommendation
- $\text{recommendedChange} = \text{round}(\text{total})$.
- $\text{recommendedRating} = \text{round}(\text{currentRating} + \text{recommendedChange})$.
- Final status is marked `RATED`.

---

## 3. Approved Exception Keywords

Case-insensitive, whole-phrase matching against official remarks:

### A. Starter Remarks (6 Conditions – No Decrease)
1. `Slowly away`
2. `Lost few lengths`
3. `Walked out of the gates`
4. `Planted`
5. `Stopped galloping`
6. `Lost many lengths`

### B. Veterinary Remarks (6 Conditions – No Decrease)
1. `Lame`
2. `Large cut injury`
3. `EIPH`
4. `Stopped galloping`
5. `Bleeding injury`
6. `Clip injury`

### C. Incident Remarks (19 Conditions – No Decrease)
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

### D. Constant Rating Conditions (4 Conditions – Rating Unchanged)
1. `Death`
2. `Ran riderless`
3. `Did not finish`
4. `Dropped the rider`

---

## 4. UI & Workflow Interactions

1. **Automatic Rating**:
   - `rateAndSaveRace(raceId)` is invoked automatically whenever `RACE`, `STARTER`, `VETERINARY`, `INCIDENT`, or `COEFFICIENT` files are imported.
   - Races with `status: 'REVIEWED'` are locked and never automatically re-rated.
2. **Flagged Rows**:
   - `NEEDS_HANDICAPPER`: Requires manual review and decision input by the Handicapper before race submission.
   - `NOT_ELIGIBLE`: Indicates horse has $< 3$ previous runs.
   - `NOT_RATED`: Indicates unrated horse or runner did not finish.
3. **Audit Trail**:
   - Captures any Handicapper manual overrides or decisions, including old rating, new rating, reason, user, and timestamp.
