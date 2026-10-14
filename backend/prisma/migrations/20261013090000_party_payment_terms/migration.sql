-- Payment terms on customers and suppliers.
--
-- Additive and safe on a database that already holds documents: the column has
-- a default, so existing rows read as "due on the day of the invoice", which is
-- what they meant before the column existed.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "paymentTermDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "paymentTermDays" INTEGER NOT NULL DEFAULT 0;
