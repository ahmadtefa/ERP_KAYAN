-- Historical invoice allocations cannot be inferred safely: leave them NULL.
-- New conversions create the header, line links, order balances and audit in
-- one transaction. A retry key is unique within its company and order.
ALTER TABLE "sales_invoices" ADD COLUMN "orderConversionKey" VARCHAR(128), ADD COLUMN "orderConversionHash" VARCHAR(64);
ALTER TABLE "purchase_invoices" ADD COLUMN "orderConversionKey" VARCHAR(128), ADD COLUMN "orderConversionHash" VARCHAR(64);
ALTER TABLE "sales_invoice_lines" ADD COLUMN "orderLineId" UUID;
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "orderLineId" UUID;
CREATE UNIQUE INDEX "sales_invoice_order_conversion_key" ON "sales_invoices"("companyId", "salesOrderId", "orderConversionKey");
CREATE UNIQUE INDEX "purchase_invoice_order_conversion_key" ON "purchase_invoices"("companyId", "purchaseOrderId", "orderConversionKey");
CREATE INDEX "sales_invoice_lines_orderLineId_idx" ON "sales_invoice_lines"("orderLineId");
CREATE INDEX "purchase_invoice_lines_orderLineId_idx" ON "purchase_invoice_lines"("orderLineId");
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
