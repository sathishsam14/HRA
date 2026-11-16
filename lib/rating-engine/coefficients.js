import { CONFIG } from './config.js';

let rows = [];

export function setCoefficients(newRows) {
  rows = Array.isArray(newRows) ? newRows : [];
}

export function getCoefficients() {
  return rows;
}

// The client's table gives "Rating Change from Median Reference" for each Race Category + Distance
// (sheet "Rating Example", column J). That value is the STEP used for every place above or below the reference.
// 10 rows of that column differ from the sum of the significant coefficients; the client's column is used as given.
export function stepValue(category, distance) {
  const cat = CONFIG.categoryAlias[category] ?? category;
  const r = rows.find((x) => {
    const rowCat = CONFIG.categoryAlias[x.category] ?? x.category;
    return rowCat === cat && Number(x.distance) === Number(distance);
  });
  if (!r) return { ok: false, reason: `No row for category ${category} at ${distance} m in the coefficient table` };
  if (r.ratingChange == null || r.ratingChange === '')
    return { ok: false, reason: `"Rating Change from Median Reference" is blank for ${cat} at ${distance} m (model not significant or not estimated)` };
  return { ok: true, step: Number(r.ratingChange), parts: { 'rating change from median reference': Number(r.ratingChange) } };
}
