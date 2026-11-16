-- Custom migration: Append-only AuditLog and Reviewed Race protection

-- 1. Create function audit_block() that raises the exception 'AuditLog is append-only'
CREATE OR REPLACE FUNCTION audit_block()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

-- Trigger audit_no_change BEFORE UPDATE OR DELETE ON "AuditLog"
CREATE TRIGGER audit_no_change
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION audit_block();

-- 2. Trigger on "Decision" that blocks UPDATE or DELETE when parent Race status is 'REVIEWED'
CREATE OR REPLACE FUNCTION check_race_reviewed_decision()
RETURNS TRIGGER AS $$
DECLARE
    v_status "RaceStatus";
BEGIN
    SELECT r.status INTO v_status
    FROM "Race" r
    JOIN "RaceEntry" re ON re."raceId" = r.id
    WHERE re.id = OLD."entryId";

    IF v_status = 'REVIEWED' THEN
        RAISE EXCEPTION 'Cannot modify or delete Decision when parent Race status is REVIEWED';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decision_check_race_reviewed
BEFORE UPDATE OR DELETE ON "Decision"
FOR EACH ROW
EXECUTE FUNCTION check_race_reviewed_decision();

-- Trigger on "RaceEntry" that blocks UPDATE or DELETE when parent Race status is 'REVIEWED'
CREATE OR REPLACE FUNCTION check_race_reviewed_entry()
RETURNS TRIGGER AS $$
DECLARE
    v_status "RaceStatus";
BEGIN
    SELECT r.status INTO v_status
    FROM "Race" r
    WHERE r.id = OLD."raceId";

    IF v_status = 'REVIEWED' THEN
        RAISE EXCEPTION 'Cannot modify or delete RaceEntry when parent Race status is REVIEWED';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER race_entry_check_race_reviewed
BEFORE UPDATE OR DELETE ON "RaceEntry"
FOR EACH ROW
EXECUTE FUNCTION check_race_reviewed_entry();
