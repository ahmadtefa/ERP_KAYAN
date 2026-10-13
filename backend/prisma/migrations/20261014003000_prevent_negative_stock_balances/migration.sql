-- Prevent concurrent sales posting from driving a stock balance negative.
-- The constraint is not validated against legacy rows during rollout, but it
-- applies to every inserted or updated row going forward.
ALTER TABLE stock_balances
  ADD CONSTRAINT stock_balances_quantity_nonnegative
  CHECK (quantity >= 0)
  NOT VALID;
