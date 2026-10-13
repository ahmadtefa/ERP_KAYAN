-- Sales posting checks stock before updating the balance. Two concurrent
-- transactions can both pass that check and then serialize their decrements,
-- which could otherwise leave a negative balance. The invariant belongs in
-- PostgreSQL as well, so the second transaction is rejected and its whole
-- invoice transaction rolls back.
ALTER TABLE stock_balances
  ADD CONSTRAINT stock_balances_quantity_nonnegative
  CHECK (quantity >= 0)
  NOT VALID;
