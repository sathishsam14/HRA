// BRD 5.3 approved exception conditions. Matching is case-insensitive, whole phrase.
export const STARTER = ['Slowly away','Lost few lengths','Walked out of the gates','Planted','Stopped galloping','Lost many lengths'];
export const VETERINARY = ['Lame','Large cut injury','EIPH','Stopped galloping','Bleeding injury','Clip injury'];
export const INCIDENT = ['Enquiry opened','Hanging in','Hanging out','Lugging in','Lugging out','Running green','Running wide','Taking a huge lead','Stopped galloping','Horse not galloping','Dropping hands','Saddle shifted','Not improving his position','Not putting sufficient effort','Running in patches','Whipped around after jumping out','Reversal of form','Snapped reins','Broken Stirrups'];
export const CONSTANT = ['Death','Ran riderless','Did not finish','Dropped the rider'];

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
export function findKeywords(text, list) {
  const t = ' ' + norm(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  return list.filter((k) => t.includes(' ' + norm(k).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' '));
}
