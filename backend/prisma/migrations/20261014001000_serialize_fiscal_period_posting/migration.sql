-- Fiscal-period status checks in application code are not enough by themselves:
-- a posting and a close can otherwise pass their checks concurrently. These
-- triggers lock the matching period row before any posted journal/invoice or
-- stock movement is written. The close transaction updates that same row, so
-- whichever operation acquires the lock first wins and the other observes the
-- final status.

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
   WHERE company_id = p_company_id
     AND start_date <= p_date
     AND end_date >= p_date
   ORDER BY start_date DESC
   LIMIT 1
   FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'No fiscal period exists for company % on %', p_company_id, p_date
      USING ERRCODE = '23514';
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Fiscal period is closed for company % on %', p_company_id, p_date
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_posted_journal_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'POSTED'::"JournalStatus" THEN
    PERFORM kayan_require_open_fiscal_period(NEW.company_id, NEW.entry_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_posted_sales_invoice_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'POSTED'::"InvoiceStatus" THEN
    PERFORM kayan_require_open_fiscal_period(NEW.company_id, NEW.invoice_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_posted_purchase_invoice_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'POSTED'::"InvoiceStatus" THEN
    PERFORM kayan_require_open_fiscal_period(NEW.company_id, NEW.invoice_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_stock_movement_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM kayan_require_open_fiscal_period(NEW.company_id, NEW.movement_date);
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entries_open_fiscal_period
BEFORE INSERT OR UPDATE OF status, entry_date ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION kayan_check_posted_journal_period();

CREATE TRIGGER sales_invoices_open_fiscal_period
BEFORE INSERT OR UPDATE OF status, invoice_date ON sales_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_check_posted_sales_invoice_period();

CREATE TRIGGER purchase_invoices_open_fiscal_period
BEFORE INSERT OR UPDATE OF status, invoice_date ON purchase_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_check_posted_purchase_invoice_period();

CREATE TRIGGER stock_movements_open_fiscal_period
BEFORE INSERT OR UPDATE OF movement_date ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION kayan_check_stock_movement_period();

-- Keep the trigger functions with the schema; they are part of the invariant.
