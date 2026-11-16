-- db/schema.sql
-- HRA (Horse Rating Automation) Database Schema & Helper Functions

-- ─── Horse Run Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS horse_run (
  id SERIAL PRIMARY KEY,
  horse_pk INT NOT NULL REFERENCES "Horse"(id) ON DELETE RESTRICT,
  run_date DATE NOT NULL,
  race_ref TEXT NOT NULL,
  category TEXT,
  distance INT,
  weight_carried TEXT,
  equipment TEXT,
  jockey TEXT,
  horse_weight DOUBLE PRECISION,
  rating_text TEXT,
  time_text TEXT,
  penetrometer DOUBLE PRECISION,
  shoes TEXT,
  source TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_horse_run UNIQUE (horse_pk, run_date, race_ref)
);

CREATE INDEX IF NOT EXISTS idx_horse_run_horse_pk ON horse_run(horse_pk);
CREATE INDEX IF NOT EXISTS idx_horse_run_date ON horse_run(run_date);

-- ─── Function: previous_runs() ────────────────────────────────────────────────
-- Returns the count of prior runs for a horse before a given race date.
-- If p_race_date is NULL, returns all recorded runs for the horse.
CREATE OR REPLACE FUNCTION previous_runs(p_horse_pk INT, p_race_date DATE DEFAULT NULL)
RETURNS INT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INT
    FROM horse_run
    WHERE horse_pk = p_horse_pk
      AND (p_race_date IS NULL OR run_date < p_race_date)
  );
END;
$$ LANGUAGE plpgsql STABLE;
