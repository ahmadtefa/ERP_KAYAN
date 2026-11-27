-- A commission payout now posts a journal entry in the same transaction.
-- Payouts made before this change have no entry, so the link is nullable.
ALTER TABLE commission_payouts ADD COLUMN "journalEntryId" uuid REFERENCES journal_entries(id) ON DELETE RESTRICT;
