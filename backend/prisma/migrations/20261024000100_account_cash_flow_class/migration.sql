-- IAS 7 classification on accounts, used by the cash-flow statement.
--
-- The column lands NULL for every existing account on purpose: no
-- classification is invented for anybody's chart. A null account's cash
-- movements are reported under "unclassified" until the accountant
-- classifies the account in the chart of accounts.

CREATE TYPE "CashFlowClass" AS ENUM ('OPERATING', 'INVESTING', 'FINANCING');

ALTER TABLE "accounts" ADD COLUMN "cashFlowClass" "CashFlowClass";
