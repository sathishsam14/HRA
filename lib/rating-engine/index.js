import { CONFIG } from './config.js';
import { STARTER, VETERINARY, INCIDENT, CONSTANT, findKeywords } from './keywords.js';
import { stepValue } from './coefficients.js';

const round = (x) => (CONFIG.rounding === 'nearest' ? Math.sign(x) * Math.round(Math.abs(x)) : x);

export function raceType(category) {
  const c = String(category ?? '').trim();
  if (!c) return null;
  if (CONFIG.termsExact.includes(c) || CONFIG.termsPattern.test(c)) return 'TERMS';
  return 'HANDICAP';
}

// Reference ("median") position. BRD 5.2 (3f): 8+ runners -> 4th, 5-7 -> 3rd. 3 runners handled separately.
export function referencePosition(runners) {
  if (runners >= 8) return 4;
  if (runners >= 4) return 3;
  return null; // 3 runners has its own rule; fewer than 3 is not defined
}

/**
 * Fixed order of checks (the same order is printed in `reasons`, numbered, so the Handicapper reads the logic top to bottom):
 *  1 Race type (Terms or Handicap)      2 Minimum 3 runs            3 Finished? constant conditions
 *  4 Existing rating or new horse       5 Coefficient lookup        6 Place versus reference position
 *  7 Winner beat a higher-rated horse   8 Weight (1 kg = 2 points)  9 Limits (4-point decrease cap, Terms no decrease)
 * 10 Exceptions (starter / veterinary / incident)                  11 Recommendation
 */
function out(entry, status, reasons, extra = {}) {
  return { horseId: entry.horseId ?? null, horseName: entry.horseName, status,
    recommendedChange: null, recommendedRating: null, reasons, ...extra };
}

/**
 * race   = { category, distance, entries: [...], reportsAvailable?: { starter, veterinary, incident } }
 * entry  = { horseId, horseName, currentRating|null, sexCategory 'C&G'|'F&M'|null, previousRuns, placing|null,
 *            weightCarried, weightDeclared, starter:[text], veterinary:[text], incident:[text] }
 * Checks run in a fixed order and every result lists them as "Step N: ...":
 *  1 race type + finished   2 new or rated horse   3 minimum 3 runs   4 constant conditions (stop)   5 exceptions found (no decrease)
 *  6 coefficient   7 place vs reference   8 beaten higher-rated base   9 weight   10 limits   11 recommendation
 * Never throws for missing data: it returns NEEDS_HANDICAPPER with the reason.
 */
export function rateRace(race) {
  const type = raceType(race.category);
  const ranked = race.entries.filter((e) => Number.isFinite(e.placing) && e.placing > 0);
  const n = ranked.length;
  const results = [];
  const rep = race.reportsAvailable;

  for (const e of race.entries) {
    const reasons = [];
    const base = { raceType: type };
    const stop = (status, why, extra = {}) => results.push(out(e, status, [...reasons, why], { ...base, ...extra }));

    // STEP 1. Race set-up: Terms or Handicap, and did the horse finish?
    if (!type) { stop('NEEDS_HANDICAPPER', `Step 1: cannot tell if category "${race.category}" is Terms or Handicap`); continue; }
    reasons.push(`Step 1: ${type === 'TERMS' ? 'Terms' : 'Handicap'} race (category ${race.category}, ${race.distance} m, ${n} finishers)`);
    if (!Number.isFinite(e.placing) || e.placing < 1) { stop('NOT_RATED', 'Step 1: no finishing position, so the horse is not rated'); continue; }
    const isWinner = e.placing === 1;

    // STEP 2. New (unrated) horse or already rated?
    let current = e.currentRating;
    let unratedStart = false;
    if (current == null) {
      if (e.sexCategory === 'C&G' || e.sexCategory === 'F&M') {
        current = CONFIG.startRating[e.sexCategory === 'C&G' ? 'M' : 'F'];
        unratedStart = true;
        reasons.push(`Step 2: new horse (no rating), starts at ${current} (${e.sexCategory === 'C&G' ? 'male' : 'female'}), then the process continues`);
      } else {
        stop('NEEDS_HANDICAPPER', 'Step 2: new horse (no rating) but the sex category is missing, so the start rating (30 male / 27 female) cannot be set'); continue;
      }
    } else reasons.push(`Step 2: already rated, current rating ${current}`);

    // STEP 3. Eligibility: minimum 3 previous runs (winners are always rated)
    const runs = Number(e.previousRuns);
    if (!(runs >= CONFIG.minRuns)) {
      const exempt = isWinner && CONFIG.winnerExemptFromMinRuns && type === 'TERMS';
      if (!exempt) { stop('NOT_ELIGIBLE', `Step 3: only ${Number.isFinite(runs) ? runs : 'unknown'} previous runs, minimum is ${CONFIG.minRuns}`); continue; }
      reasons.push(`Step 3: ${runs} previous runs, but a winner is always rated`);
    } else reasons.push(`Step 3: ${runs} previous runs, eligible`);

    // STEP 4. Constant rating conditions: rating unchanged, no calculation needed
    const all = [...(e.starter ?? []), ...(e.veterinary ?? []), ...(e.incident ?? [])].join(' | ');
    const constant = findKeywords(all, CONSTANT);
    if (constant.length) {
      stop('UNCHANGED', `Step 4: constant condition (${constant.join(', ')}), rating unchanged`, { recommendedChange: 0, recommendedRating: current });
      continue;
    }

    // STEP 5. Starter, Veterinary, Incident exceptions: found BEFORE the calculation, applied to its result
    const hits = [...findKeywords((e.starter ?? []).join(' | '), STARTER).map((k) => `Starter: ${k}`),
                  ...findKeywords((e.veterinary ?? []).join(' | '), VETERINARY).map((k) => `Veterinary: ${k}`),
                  ...findKeywords((e.incident ?? []).join(' | '), INCIDENT).map((k) => `Incident: ${k}`)];
    const noDecrease = hits.length > 0;
    reasons.push(noDecrease ? `Step 5: exception found (${hits.join('; ')}), the rating will not decrease but may increase`
                            : 'Step 5: no starter, veterinary or incident exception found');
    if (rep) for (const [k, label] of [['starter', 'Starter'], ['veterinary', 'Veterinary'], ['incident', 'Incident']])
      if (rep[k] === false) reasons.push(`Step 5: ${label} report not supplied for this race, its exceptions were not checked`);

    // STEP 6. Coefficient for this category and distance
    const sv = stepValue(race.category, race.distance);
    if (!sv.ok) { stop('NEEDS_HANDICAPPER', `Step 6: ${sv.reason}`); continue; }
    reasons.push(`Step 6: step value ${sv.step.toFixed(4)} = ${Object.entries(sv.parts).map(([k, v]) => `${k} ${v}`).join(' + ')}`);

    // STEP 7. Finishing place against the reference position
    let change;
    if (n === 3) {
      change = e.placing === 1 ? sv.step : e.placing === 2 ? 0 : -sv.step;
      reasons.push(`Step 7: 3-horse race, ${e.placing === 1 ? 'winner rated up' : e.placing === 2 ? 'second unchanged' : 'third reduced'}`);
    } else {
      const ref = referencePosition(n);
      if (!ref) { stop('NEEDS_HANDICAPPER', `Step 7: ${n} runners, the BRD does not define a reference position`); continue; }
      change = (ref - e.placing) * sv.step;
      reasons.push(`Step 7: reference position ${ref}, finished ${e.placing}, ${ref - e.placing} step(s) = ${change.toFixed(2)}`);
    }

    // STEP 8. Winner beat a higher-rated horse: that horse is the base
    let baseShift = 0;
    if (isWinner && type === 'TERMS') {
      const beaten = ranked.filter((x) => x !== e && Number.isFinite(x.currentRating)).map((x) => x.currentRating);
      const top = beaten.length ? Math.max(...beaten) : null;
      if (top != null && top > current) { baseShift = top - current; reasons.push(`Step 8: beat a higher-rated horse (${top}), used as the base`); }
    }

    // STEP 9. Weight rule (developer-proposed formula, see config.js)
    let weightPts = 0;
    if (CONFIG.weightRule === 'proposed') {
      if (type === 'TERMS') {
        const refHorse = ranked.find((x) => x.placing === (referencePosition(n) ?? 2));
        if (refHorse && Number.isFinite(e.weightCarried) && Number.isFinite(refHorse.weightCarried))
          weightPts = CONFIG.weightPointsPerKg * (e.weightCarried - refHorse.weightCarried);
      } else if (e.placing <= CONFIG.extraWeightPlaces && Number.isFinite(e.weightCarried) && Number.isFinite(e.weightDeclared)) {
        weightPts = CONFIG.weightPointsPerKg * Math.max(0, e.weightCarried - e.weightDeclared);
      }
      if (weightPts) reasons.push(`Step 9: weight adjustment ${weightPts > 0 ? '+' : ''}${weightPts} points`);
    }
    let total = baseShift + change + weightPts;

    // STEP 10. Limits: exception (no decrease), maximum decrease of 4, Terms race no decrease
    if (noDecrease && total < 0) { total = 0; reasons.push('Step 10: exception from Step 5 applies, so the decrease is removed'); }
    if (total < 0 && -total > CONFIG.maxDecrease) { total = -CONFIG.maxDecrease; reasons.push(`Step 10: decrease limited to ${CONFIG.maxDecrease} points`); }
    if (CONFIG.capIncrease && total > CONFIG.maxDecrease) total = CONFIG.maxDecrease;
    if (type === 'TERMS' && total < 0) { total = 0; reasons.push('Step 10: Terms race, not performed to potential, so no decrease'); }

    // STEP 11. Recommendation
    const finalChange = round(total);
    results.push({ horseId: e.horseId ?? null, horseName: e.horseName, status: 'RATED', raceType: type,
      recommendedChange: finalChange, recommendedRating: round(current + finalChange), unratedStart,
      reasons: [...reasons, `Step 11: recommended change ${finalChange > 0 ? '+' : ''}${finalChange}, recommended rating ${round(current + finalChange)}`] });
  }
  return results;
}

// BRD 5.4: override needs final change, reason, user and time.
export function applyOverride(result, { finalChange, reason, userId, at = new Date() }) {
  if (!Number.isFinite(finalChange)) throw new Error('Override needs a final rating change');
  if (!reason || !String(reason).trim()) throw new Error('Override needs a reason');
  if (!userId) throw new Error('Override needs the user');
  const start = (result.recommendedRating ?? 0) - (result.recommendedChange ?? 0);
  return { ...result, override: { finalChange, reason: String(reason).trim(), userId, at },
    finalChange, finalRating: start + finalChange };
}
