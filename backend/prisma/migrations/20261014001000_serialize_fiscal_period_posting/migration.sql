-- Serialize fiscal-period closure against posting. Prisma maps these models
-- to snake_case table names, while their columns retain camelCase names.
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
    PERFORM kayan_require_open_fiscal_period(NEW."companyId", NEW."entryDate");
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
    PERFORM kayan_require_open_fiscal_period(NEW."companyId", NEW."invoiceDate");
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
    PERFORM kayan_require_open_fiscal_period(NEW."companyId", NEW."invoiceDate");
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_stock_movement_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM kayan_require_open_fiscal_period(NEW."companyId", NEW."movementDate");
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entries_open_fiscal_period
BEFORE INSERT OR UPDATE OF status, "entryDate" ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION kayan_check_posted_journal_period();

CREATE TRIGGER sales_invoices_open_fiscal_period
BEFORE INSERT OR UPDATE OF status, "invoiceDate" ON sales_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_check_posted_sales_invoice_period();

CREATE TRIGGER purchase_invoices_open_fiscal_period
BEFORE INSERT OR UPDATE OF status, "invoiceDate" ON purchase_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_check_posted_purchase_invoice_period();

CREATE TRIGGER stock_movements_open_fiscal_period
BEFORE INSERT OR UPDATE OF "movementDate" ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION kayan_check_stock_movement_period();
