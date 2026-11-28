-- One company per installation stays the rule until the multi-company switch is turned on.
-- The partial unique index of migration 20261014000000 is replaced by a trigger that enforces
-- the same rule while the switch is off, with the same constraint name and error code, so
-- every caller sees the same failure as before. The switch is a row in installation_flags and
-- no API writes it: the vendor-licensed activation path (a later batch) is its only owner.
CREATE TABLE installation_flags (
  key varchar(60) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS "Company_one_active_company_idx";

CREATE FUNCTION enforce_company_switch() RETURNS trigger AS $$
BEGIN
  IF NEW."deletedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Serialise concurrent inserts: the check below must see the other transaction's row.
  PERFORM pg_advisory_xact_lock(172895144, 485773);
  IF EXISTS (SELECT 1 FROM installation_flags WHERE key = 'multi_company' AND enabled) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE "deletedAt" IS NULL AND id <> NEW.id) THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "Company_one_active_company_idx"'
      USING ERRCODE = '23505', CONSTRAINT = 'Company_one_active_company_idx';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER company_switch_guard
BEFORE INSERT OR UPDATE OF "deletedAt" ON companies
FOR EACH ROW EXECUTE FUNCTION enforce_company_switch();
