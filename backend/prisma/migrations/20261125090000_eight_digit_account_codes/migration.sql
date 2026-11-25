-- Eight digit chart of accounts: 2/4/6/8 digit hierarchy, entries only on
-- 8-digit accounts. Existing companies stay LEGACY until they are converted
-- on purpose; a new company is created as EIGHT_DIGIT by the setup code.

CREATE TYPE "AccountCodeScheme" AS ENUM ('LEGACY', 'EIGHT_DIGIT');

ALTER TABLE "companies"
  ADD COLUMN "accountCodeScheme" "AccountCodeScheme" NOT NULL DEFAULT 'LEGACY';

-- True when one account row obeys the eight digit rule.
CREATE OR REPLACE FUNCTION kayan_eight_digit_account_ok(
  p_code TEXT, p_parent_code TEXT, p_postable BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  len INTEGER := length(p_code);
BEGIN
  IF p_code !~ '^[0-9]+$' OR len NOT IN (2, 4, 6, 8) THEN
    RETURN 'account code ' || p_code || ' must be numeric with 2, 4, 6 or 8 digits';
  END IF;
  IF len = 2 THEN
    IF p_parent_code IS NOT NULL THEN
      RETURN 'a 2-digit account cannot have a parent (' || p_code || ')';
    END IF;
  ELSE
    IF p_parent_code IS NULL OR p_parent_code <> left(p_code, len - 2) THEN
      RETURN 'account code ' || p_code || ' must extend its parent code by exactly two digits';
    END IF;
  END IF;
  IF p_postable AND len <> 8 THEN
    RETURN 'only 8-digit accounts can receive entries (' || p_code || ')';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_account_code_scheme()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scheme "AccountCodeScheme";
  parent_code TEXT;
  problem TEXT;
BEGIN
  IF NEW."deletedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT "accountCodeScheme" INTO scheme FROM companies WHERE id = NEW."companyId";
  IF scheme IS DISTINCT FROM 'EIGHT_DIGIT' THEN
    RETURN NEW;
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT code INTO parent_code FROM accounts WHERE id = NEW."parentId";
  END IF;
  problem := kayan_eight_digit_account_ok(NEW.code, parent_code, NEW."isPostable");
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Eight digit chart rule: %', problem USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_eight_digit_scheme
BEFORE INSERT OR UPDATE OF code, "parentId", "isPostable", "deletedAt", "companyId" ON accounts
FOR EACH ROW
EXECUTE FUNCTION kayan_check_account_code_scheme();

-- Last line of defence for every posting path: a journal line can never point
-- at a non-8-digit account of an eight digit company.
CREATE OR REPLACE FUNCTION kayan_check_journal_line_account_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  acct_code TEXT;
  scheme "AccountCodeScheme";
BEGIN
  SELECT a.code, c."accountCodeScheme" INTO acct_code, scheme
    FROM accounts a JOIN companies c ON c.id = a."companyId"
   WHERE a.id = NEW."accountId";
  IF scheme = 'EIGHT_DIGIT' AND acct_code !~ '^[0-9]{8}$' THEN
    RAISE EXCEPTION 'Account % cannot receive entries: only 8-digit accounts accept entries', acct_code
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_lines_eight_digit_account
BEFORE INSERT OR UPDATE OF "accountId" ON journal_lines
FOR EACH ROW
EXECUTE FUNCTION kayan_check_journal_line_account_code();

-- Switching a company to the eight digit chart is all-or-nothing: every live
-- account must already obey the rule, so a chart is never half converted.
-- (Nothing here converts data; it only refuses an unsafe switch.)
CREATE OR REPLACE FUNCTION kayan_check_company_scheme_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bad RECORD;
BEGIN
  IF NEW."accountCodeScheme" = 'EIGHT_DIGIT' AND OLD."accountCodeScheme" <> 'EIGHT_DIGIT' THEN
    SELECT a.code, kayan_eight_digit_account_ok(a.code, p.code, a."isPostable") AS problem
      INTO bad
      FROM accounts a LEFT JOIN accounts p ON p.id = a."parentId"
     WHERE a."companyId" = NEW.id AND a."deletedAt" IS NULL
       AND kayan_eight_digit_account_ok(a.code, p.code, a."isPostable") IS NOT NULL
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'The chart does not follow the eight digit rule yet: %', bad.problem
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l."accountId"
       WHERE a."companyId" = NEW.id AND a.code !~ '^[0-9]{8}$'
    ) THEN
      RAISE EXCEPTION 'Journal history still uses accounts that are not 8-digit accounts'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_account_code_scheme
BEFORE UPDATE OF "accountCodeScheme" ON companies
FOR EACH ROW
EXECUTE FUNCTION kayan_check_company_scheme_change();
