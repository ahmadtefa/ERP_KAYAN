-- Guard status changes so concurrent post/reverse requests cannot both
-- apply business effects. PostgreSQL serializes updates to the same row; after
-- waiting, the second update sees the committed old status and is rejected,
-- rolling back every effect in its transaction. Some accounting workflows
-- intentionally create a new journal entry directly as POSTED, so INSERTs are
-- not restricted here.
CREATE OR REPLACE FUNCTION kayan_validate_journal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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
BEFORE UPDATE OF status ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION kayan_validate_journal_status_transition();

CREATE TRIGGER sales_invoices_status_transition
BEFORE UPDATE OF status ON sales_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_validate_sales_invoice_status_transition();

CREATE TRIGGER purchase_invoices_status_transition
BEFORE UPDATE OF status ON purchase_invoices
FOR EACH ROW
EXECUTE FUNCTION kayan_validate_purchase_invoice_status_transition();
