-- A notification is resolved when the fact behind it stops being true: a
-- transfer someone reviewed no longer needs reviewing. The service has written
-- `CLOSED` for that since the alert centre was added, and its unit tests assert
-- it, but the table's check constraint only ever allowed OPEN, READ and
-- ARCHIVED. So resolving an alert failed the whole statement, and because the
-- transfer service raises and resolves alerts inside its own transaction, the
-- review, approval, dispatch and receipt of every transfer answered 500.
--
-- Widen the constraint to the vocabulary the code already uses. Nothing else
-- changes: OPEN and READ are live, ARCHIVED is dismissed by a person, CLOSED is
-- resolved by the system.
ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_status_check";

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_status_check"
  CHECK ("status" IN ('OPEN', 'READ', 'ARCHIVED', 'CLOSED'));
