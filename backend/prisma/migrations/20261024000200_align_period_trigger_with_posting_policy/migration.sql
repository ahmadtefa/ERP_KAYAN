-- Align the database backstop with the application's documented period
-- policy. FiscalPeriodsService.periodFor states it plainly: "Posting
-- outside any period is allowed: a company that has not created next
-- year's period yet should not be unable to work on the first of
-- January. Only a *closed* period blocks." The application enforces
-- exactly that, with a readable refusal for a closed period.
--
-- This trigger, added to serialise closing against posting, also
-- raised when NO period covered the date. That reached the user as an
-- opaque 500 ("Unexpected server error") on the first sale or asset
-- activation dated in a year whose period had not been created yet —
-- found by the end-to-end lifecycle scenario posting into 2025 after
-- closing 2024. A missing period now passes; a closed one still
-- raises, and the FOR UPDATE lock on an existing period row still
-- serialises a close against concurrent postings into it.
CREATE OR REPLACE FUNCTION kayan_require_open_fiscal_period(
  p_company_id uuid,
  p_date date
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status "PeriodStatus";
BEGIN
  SELECT status
    INTO v_status
    FROM fiscal_periods
   WHERE "companyId" = p_company_id
     AND "startDate" <= p_date
     AND "endDate" >= p_date
   ORDER BY "startDate" DESC
   LIMIT 1
   FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN;
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Fiscal period is closed for company % on %', p_company_id, p_date
      USING ERRCODE = '23514';
  END IF;
END;
$$;
