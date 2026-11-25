-- db/seed.sql
-- Seeds exception keywords and default system rules for HRA.
-- NOTE: The Coefficient table is intentionally NOT seeded here so that it starts empty.
-- Coefficients must come exclusively from dynamic client Excel uploads (COEFFICIENT file type).

-- ─── Exception Keywords ──────────────────────────────────────────────────────

-- 1. Starter Remarks (6 Conditions - Rating shall not decrease; rating may increase)
INSERT INTO "ExceptionKeyword" (type, text, active) VALUES
  ('STARTER', 'Slowly away', true),
  ('STARTER', 'Lost few lengths', true),
  ('STARTER', 'Walked out of the gates', true),
  ('STARTER', 'Planted', true),
  ('STARTER', 'Stopped galloping', true),
  ('STARTER', 'Lost many lengths', true)
ON CONFLICT (type, text) DO UPDATE SET active = true;

-- 2. Veterinary Remarks (6 Conditions - Rating shall not decrease; rating may increase)
INSERT INTO "ExceptionKeyword" (type, text, active) VALUES
  ('VETERINARY', 'Lame', true),
  ('VETERINARY', 'Large cut injury', true),
  ('VETERINARY', 'EIPH', true),
  ('VETERINARY', 'Stopped galloping', true),
  ('VETERINARY', 'Bleeding injury', true),
  ('VETERINARY', 'Clip injury', true)
ON CONFLICT (type, text) DO UPDATE SET active = true;

-- 3. Incident Report (19 Conditions - Rating shall not decrease; rating may increase)
INSERT INTO "ExceptionKeyword" (type, text, active) VALUES
  ('INCIDENT', 'Enquiry opened', true),
  ('INCIDENT', 'Hanging in', true),
  ('INCIDENT', 'Hanging out', true),
  ('INCIDENT', 'Lugging in', true),
  ('INCIDENT', 'Lugging out', true),
  ('INCIDENT', 'Running green', true),
  ('INCIDENT', 'Running wide', true),
  ('INCIDENT', 'Taking a huge lead', true),
  ('INCIDENT', 'Stopped galloping', true),
  ('INCIDENT', 'Horse not galloping', true),
  ('INCIDENT', 'Dropping hands', true),
  ('INCIDENT', 'Saddle shifted', true),
  ('INCIDENT', 'Not improving his position', true),
  ('INCIDENT', 'Not putting sufficient effort', true),
  ('INCIDENT', 'Running in patches', true),
  ('INCIDENT', 'Whipped around after jumping out', true),
  ('INCIDENT', 'Reversal of form', true),
  ('INCIDENT', 'Snapped reins', true),
  ('INCIDENT', 'Broken Stirrups', true)
ON CONFLICT (type, text) DO UPDATE SET active = true;

-- 4. Constant Rating Conditions (4 Conditions - Rating remains unchanged)
INSERT INTO "ExceptionKeyword" (type, text, active) VALUES
  ('CONSTANT', 'Death', true),
  ('CONSTANT', 'Ran riderless', true),
  ('CONSTANT', 'Did not finish', true),
  ('CONSTANT', 'Dropped the rider', true)
ON CONFLICT (type, text) DO UPDATE SET active = true;

-- ─── Rule Version ────────────────────────────────────────────────────────────

INSERT INTO "RuleVersion" (id, name, active, "createdAt") VALUES
  (1, 'BRD v1.0 (17 Oct 2026)', true, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = true;
