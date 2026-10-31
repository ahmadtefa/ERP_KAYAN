-- Bank reconciliation claim guard.
--
-- A cash voucher can be matched to at most one bank reconciliation, and the
-- match is permanent (the service surface has no un-match operation). The
-- service locks the voucher rows inside its own transaction and re-checks
-- them there, but a service check is not a guarantee: two requests arriving at
-- the same moment, a future caller, or a script could otherwise overwrite
-- "reconciliationId" and leave two reconciliations claiming the same voucher.
--
-- This trigger makes the database itself refuse to move a voucher from one
-- reconciliation to another. It is deliberately narrow:
--   * NULL -> value is the ordinary claim, always allowed;
--   * value -> the SAME value is an idempotent no-op, allowed;
--   * value -> NULL stays reachable only through the foreign key's
--     ON DELETE SET NULL, so deleting a reconciliation still works;
--   * value -> a DIFFERENT value is refused.
-- It is UPDATE-only, so backup restore (which inserts rows) is unaffected,
-- and existing historical rows keep working even if they already look odd.
CREATE OR REPLACE FUNCTION kayan_cash_voucher_reconciliation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."reconciliationId" IS NOT NULL
     AND (
       (NEW."reconciliationId" IS NOT NULL AND NEW."reconciliationId" <> OLD."reconciliationId")
       OR (NEW."reconciliationId" IS NULL AND EXISTS (
         SELECT 1 FROM "bank_reconciliations" WHERE id = OLD."reconciliationId"
       ))
     ) THEN
    RAISE EXCEPTION 'cash voucher % is already matched to reconciliation %',
      OLD."voucherNumber", OLD."reconciliationId"
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cash_vouchers_reconciliation_guard ON "cash_vouchers";
CREATE TRIGGER cash_vouchers_reconciliation_guard
  BEFORE UPDATE ON "cash_vouchers"
  FOR EACH ROW
  EXECUTE FUNCTION kayan_cash_voucher_reconciliation_guard();
