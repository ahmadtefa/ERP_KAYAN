-- Posting/reversal endpoints perform business effects in a transaction and
-- then change the document status. Two concurrent requests can both read the
-- same old status before either status update commits. PostgreSQL already
-- serializes updates to the same row; this trigger makes the transition itself
-- conditional on the status that was actually locked, so the second request
-- is rejected and its surrounding transaction rolls back all duplicate
-- accounting/inventory effects.

CREATE OR REPLACE FUNCTION kayan_validate_journal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT'::"JournalStatus" THEN
    RAISE EXCEPTION 'Journal entries must start as DRAFT'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'POSTED'::"JournalStatus"
       AND OLD.status <> 'DRAFT'::"JournalStatus" THEN
      RAISE EXCEPTION 'Journal entry is no longer draft'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'REVERSED'::"JournalStatus"
       AND OLD.status <> 'POSTED'::"JournalStatus" THEN
      RAISE EXCEPTION 'Only a posted journal entry can be reversed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_validate_sales_invoice_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT'::"InvoiceStatus" THEN
    RAISE EXCEPTION 'Sales invoices must start as DRAFT'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'POSTED'::"InvoiceStatus"
       AND OLD.status <> 'DRAFT'::"InvoiceStatus" THEN
      RAISE EXCEPTION 'Sales invoice is no longer draft'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'REVERSED'::"InvoiceStatus"
       AND OLD.status <> 'POSTED'::"InvoiceStatus" THEN
      RAISE EXCEPTION 'Only a posted sales invoice can be reversed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_validate_purchase_invoice_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT'::"InvoiceStatus" THEN
    RAISE EXCEPTION 'Purchase invoices must start as DRAFT'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'POSTED'::"InvoiceStatus"
       AND OLD.status <> 'DRAFT'::"InvoiceStatus" THEN
      RAISE EXCEPTION 'Purchase invoice is no longer draft'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'REVERSED'::"InvoiceStatus"
       AND OLD.status <> 'POSTED'::"InvoiceStatus" THEN
      RAISE EXCEPTION 'Only a posted purchase invoice can be reversed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entries_status_transition
BEFORE INSERT OR UPDATE OF status ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION kayan_validate_journal_status_transition();

CREATE TRIGGER sales_invoices_status_transition
BEFORE INSERT OR UPDATE OF status ON sales_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_validate_sales_invoice_status_transition();

CREATE TRIGGER purchase_invoices_status_transition
BEFORE INSERT OR UPDATE OF status ON purchase_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_validate_purchase_invoice_status_transition();
