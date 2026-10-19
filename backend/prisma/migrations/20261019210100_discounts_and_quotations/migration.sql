-- Line- and document-level discounts, and the quotation module.
--
-- Everything here is additive. Existing discount columns keep their meaning
-- (a document-level discount applied before tax) and existing rows keep the
-- values they already had; new columns are nullable or defaulted, so an
-- upgrade never rewrites history.

-- ------------------------------------------------------------------ items
ALTER TABLE "items" ADD COLUMN "countryOfOrigin" VARCHAR(80);

-- --------------------------------------------------------- sales invoices
ALTER TABLE "sales_invoices"
  ADD COLUMN "discountType" VARCHAR(16),
  ADD COLUMN "lineDiscountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0;

ALTER TABLE "sales_invoice_lines"
  ADD COLUMN "discountType" VARCHAR(16),
  ADD COLUMN "grossLineTotal" DECIMAL(19,4),
  ADD COLUMN "invoiceDiscountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- ------------------------------------------------------ purchase invoices
ALTER TABLE "purchase_invoices"
  ADD COLUMN "discountType" VARCHAR(16),
  ADD COLUMN "lineDiscountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN "discountType" VARCHAR(16),
  ADD COLUMN "grossLineTotal" DECIMAL(19,4),
  ADD COLUMN "invoiceDiscountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------- settings
ALTER TABLE "company_settings"
  ADD COLUMN "showTaxIdOnQuotations" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "managerName" TEXT,
  ADD COLUMN "salesManagerName" TEXT,
  ADD COLUMN "salesManagerPhone" TEXT;

-- ---------------------------------------------------------- permissions
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), v.code, v."nameEn", v."nameAr", v.module
  FROM (VALUES
    ('sales.quotations.read', 'View quotations', 'عرض عروض الأسعار', 'sales'),
    ('sales.quotations.manage', 'Create and edit quotations', 'إنشاء وتعديل عروض الأسعار', 'sales'),
    ('sales.quotations.convert', 'Convert quotations to invoices', 'تحويل عروض الأسعار إلى فواتير', 'sales'),
    ('sales.quotations.export', 'Print and export quotations', 'طباعة وتصدير عروض الأسعار', 'sales')
  ) AS v(code, "nameEn", "nameAr", module)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = v.code);

-- Whoever may read invoices may read quotations.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r.id, p.id
  FROM "roles" r
  JOIN "role_permissions" rp ON rp."roleId" = r.id
  JOIN "permissions" source ON source.id = rp."permissionId" AND source.code = 'sales.invoices.read'
  JOIN "permissions" p ON p.code = 'sales.quotations.read'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" existing
    WHERE existing."roleId" = r.id AND existing."permissionId" = p.id
 );

-- Whoever may create invoices may create quotations and convert them.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r.id, p.id
  FROM "roles" r
  JOIN "role_permissions" rp ON rp."roleId" = r.id
  JOIN "permissions" source ON source.id = rp."permissionId" AND source.code = 'sales.invoices.create'
  JOIN "permissions" p ON p.code IN ('sales.quotations.manage', 'sales.quotations.convert')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" existing
    WHERE existing."roleId" = r.id AND existing."permissionId" = p.id
 );

-- Whoever may print sales documents may print and export quotations.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r.id, p.id
  FROM "roles" r
  JOIN "role_permissions" rp ON rp."roleId" = r.id
  JOIN "permissions" source ON source.id = rp."permissionId" AND source.code = 'sales.print'
  JOIN "permissions" p ON p.code = 'sales.quotations.export'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" existing
    WHERE existing."roleId" = r.id AND existing."permissionId" = p.id
 );

-- --------------------------------------------------- quotation structures
--
-- The first quotation migration on this branch created a single-line-table
-- document (`quotations`, `quotation_lines` with a `tableTitle`, and a term
-- template library). This migration replaces that structure with the document
-- the specification asks for: several titled tables, a frozen issue snapshot,
-- an event log, revisions and a single conversion to an invoice. It is a
-- conversion, not a reset: every legacy quotation and line is copied into the
-- new shape, every legacy table is renamed rather than dropped, and the term
-- template library is kept for reuse.
--
-- A database that has never seen the legacy migration cannot reach this point:
-- 20261019203000_add_quotations runs first and always creates these tables.

-- Keep the old tables, their rows, and their history. Rename the constraints
-- and indexes too, so the new tables can own the canonical names without
-- touching a single stored row.
ALTER TABLE "quotations" RENAME TO "quotations_legacy";
ALTER TABLE "quotations_legacy" RENAME CONSTRAINT "quotations_pkey" TO "quotations_legacy_pkey";
ALTER TABLE "quotations_legacy" RENAME CONSTRAINT "quotations_companyId_fkey" TO "quotations_legacy_company_fkey";
ALTER TABLE "quotations_legacy" RENAME CONSTRAINT "quotations_branchId_fkey" TO "quotations_legacy_branch_fkey";
ALTER TABLE "quotations_legacy" RENAME CONSTRAINT "quotations_customerId_fkey" TO "quotations_legacy_customer_fkey";
ALTER INDEX "quotations_companyId_quotationNumber_key" RENAME TO "quotations_legacy_number_key";
ALTER INDEX "quotations_companyId_quotationDate_idx" RENAME TO "quotations_legacy_date_idx";
ALTER INDEX "quotations_companyId_status_idx" RENAME TO "quotations_legacy_status_idx";

ALTER TABLE "quotation_lines" RENAME TO "quotation_lines_legacy";
ALTER TABLE "quotation_lines_legacy" RENAME CONSTRAINT "quotation_lines_pkey" TO "quotation_lines_legacy_pkey";
ALTER TABLE "quotation_lines_legacy" RENAME CONSTRAINT "quotation_lines_quotationId_fkey" TO "quotation_lines_legacy_quotation_fkey";
ALTER TABLE "quotation_lines_legacy" RENAME CONSTRAINT "quotation_lines_itemId_fkey" TO "quotation_lines_legacy_item_fkey";
ALTER INDEX "quotation_lines_quotationId_tableTitle_lineNumber_key" RENAME TO "quotation_lines_legacy_number_key";
ALTER INDEX "quotation_lines_quotationId_idx" RENAME TO "quotation_lines_legacy_quotation_idx";
ALTER INDEX "quotation_lines_itemId_idx" RENAME TO "quotation_lines_legacy_item_idx";

CREATE TYPE "QuotationEventType" AS ENUM (
  'CREATED', 'UPDATED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED', 'CONVERTED', 'FOLLOW_UP', 'NOTE'
);

CREATE TABLE "quotations" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId"           UUID NOT NULL,
  "branchId"            UUID NOT NULL,
  "quotationNumber"     TEXT NOT NULL,
  "quotationDate"       DATE NOT NULL,
  "validUntil"          DATE,
  "customerId"          UUID NOT NULL,
  "status"              "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "currency"            VARCHAR(3) NOT NULL DEFAULT 'EGP',
  "version"             INTEGER NOT NULL DEFAULT 1,
  "revisionOfId"        UUID,
  "notes"               TEXT,
  "terms"               TEXT,
  "discountType"        VARCHAR(16),
  "discountPercent"     DECIMAL(9,4) NOT NULL DEFAULT 0,
  "discountAmount"      DECIMAL(19,4) NOT NULL DEFAULT 0,
  "subTotal"            DECIMAL(19,4) NOT NULL DEFAULT 0,
  "discountTotal"       DECIMAL(19,4) NOT NULL DEFAULT 0,
  "totalAmount"         DECIMAL(19,4) NOT NULL DEFAULT 0,
  "managerName"         TEXT,
  "responsibleName"     TEXT,
  "responsiblePhone"    TEXT,
  "showTaxId"           BOOLEAN NOT NULL DEFAULT true,
  "contentSnapshot"     JSONB,
  "snapshotAt"          TIMESTAMP(3),
  "convertedInvoiceId"  UUID,
  "convertedAt"         TIMESTAMP(3),
  "issuedAt"            TIMESTAMP(3),
  "sentAt"              TIMESTAMP(3),
  "acceptedAt"          TIMESTAMP(3),
  "rejectedAt"          TIMESTAMP(3),
  "expiredAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  "createdBy"           UUID,
  "updatedBy"           UUID,
  "deletedAt"           TIMESTAMP(3),
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_tables" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId"     UUID NOT NULL,
  "title"           TEXT NOT NULL,
  "sortOrder"       INTEGER NOT NULL,
  "discountType"    VARCHAR(16),
  "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "discountAmount"  DECIMAL(19,4) NOT NULL DEFAULT 0,
  "subTotal"        DECIMAL(19,4) NOT NULL DEFAULT 0,
  "discountTotal"   DECIMAL(19,4) NOT NULL DEFAULT 0,
  "netTotal"        DECIMAL(19,4) NOT NULL DEFAULT 0,
  CONSTRAINT "quotation_tables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_lines" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "tableId"         UUID NOT NULL,
  "lineNumber"      INTEGER NOT NULL,
  "itemId"          UUID,
  "description"     TEXT NOT NULL,
  "countryOfOrigin" VARCHAR(80),
  "unit"            TEXT,
  "quantity"        DECIMAL(19,4) NOT NULL,
  "unitPrice"       DECIMAL(19,4) NOT NULL,
  "lineTotal"       DECIMAL(19,4) NOT NULL,
  CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_events" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotationId" UUID NOT NULL,
  "type"        "QuotationEventType" NOT NULL,
  "fromStatus"  "QuotationStatus",
  "toStatus"    "QuotationStatus",
  "note"        TEXT,
  "userId"      UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotation_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotations_companyId_quotationNumber_key" ON "quotations"("companyId", "quotationNumber");
CREATE UNIQUE INDEX "quotations_convertedInvoiceId_key" ON "quotations"("convertedInvoiceId");
CREATE INDEX "quotations_companyId_quotationDate_idx" ON "quotations"("companyId", "quotationDate");
CREATE INDEX "quotations_companyId_status_idx" ON "quotations"("companyId", "status");
CREATE INDEX "quotations_customerId_idx" ON "quotations"("customerId");
CREATE UNIQUE INDEX "quotation_tables_quotationId_sortOrder_key" ON "quotation_tables"("quotationId", "sortOrder");
CREATE UNIQUE INDEX "quotation_lines_tableId_lineNumber_key" ON "quotation_lines"("tableId", "lineNumber");
CREATE INDEX "quotation_lines_itemId_idx" ON "quotation_lines"("itemId");
CREATE INDEX "quotation_events_quotationId_createdAt_idx" ON "quotation_events"("quotationId", "createdAt");

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_convertedInvoiceId_fkey"
  FOREIGN KEY ("convertedInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_revisionOfId_fkey"
  FOREIGN KEY ("revisionOfId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_tables" ADD CONSTRAINT "quotation_tables_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "quotation_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_events" ADD CONSTRAINT "quotation_events_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -------------------------------------------------------- legacy conversion
--
-- Copy every legacy quotation into the new shape. Totals are copied verbatim;
-- the original company and term snapshots are preserved inside contentSnapshot
-- so nothing that was printed is lost. The old ISSUED status becomes SENT,
-- which is the same point in the workflow under the new names.
INSERT INTO "quotations" (
  "id", "companyId", "branchId", "quotationNumber", "quotationDate", "validUntil",
  "customerId", "status", "currency", "version", "revisionOfId", "notes", "terms",
  "discountType", "discountPercent", "discountAmount", "subTotal", "discountTotal",
  "totalAmount", "managerName", "responsibleName", "responsiblePhone", "showTaxId",
  "contentSnapshot", "snapshotAt", "convertedInvoiceId", "convertedAt", "issuedAt",
  "sentAt", "acceptedAt", "rejectedAt", "expiredAt", "createdAt", "updatedAt",
  "createdBy", "updatedBy", "deletedAt"
)
SELECT
  q."id", q."companyId", q."branchId", q."quotationNumber", q."quotationDate", q."validUntil",
  q."customerId",
  CASE q."status"::text
    WHEN 'ISSUED' THEN 'SENT'::"QuotationStatus"
    ELSE q."status"::text::"QuotationStatus"
  END,
  q."currency", 1, NULL, q."notes", NULL,
  CASE
    WHEN q."discountAmount" > 0 THEN 'AMOUNT'
    WHEN q."discountPercent" > 0 THEN 'PERCENT'
    ELSE NULL
  END,
  q."discountPercent", q."discountAmount", q."subTotal", q."discountAmount",
  q."totalAmount", q."responsibleManager", q."responsibleManager", NULL, q."showTaxId",
  jsonb_build_object(
    'legacyCompanySnapshot', q."companySnapshot",
    'legacyTermsSnapshot', q."termsSnapshot",
    'legacyTaxAmount', q."taxAmount",
    'legacyOriginCountry', q."originCountry"
  ),
  COALESCE(q."issuedAt", q."createdAt"), q."convertedInvoiceId", q."issuedAt", q."issuedAt",
  q."issuedAt", NULL, NULL, NULL,
  q."createdAt", q."updatedAt", q."createdBy", q."updatedBy", q."deletedAt"
FROM "quotations_legacy" q;

-- One titled table for every distinct table title an old quotation used.
INSERT INTO "quotation_tables" (
  "id", "quotationId", "title", "sortOrder", "discountType", "discountPercent",
  "discountAmount", "subTotal", "discountTotal", "netTotal"
)
SELECT
  md5(grouped."quotationId"::text || ':' || grouped."tableTitle")::uuid,
  grouped."quotationId",
  grouped."tableTitle",
  (row_number() OVER (PARTITION BY grouped."quotationId" ORDER BY grouped."firstLine") - 1)::int,
  NULL, 0, 0, grouped."lineTotal", 0, grouped."lineTotal"
FROM (
  SELECT
    l."quotationId",
    l."tableTitle",
    MIN(l."lineNumber") AS "firstLine",
    SUM(l."lineTotal") AS "lineTotal"
  FROM "quotation_lines_legacy" l
  GROUP BY l."quotationId", l."tableTitle"
) grouped;

-- Copy the lines themselves, preserving their number, price, quantity and the
-- exact line total the old document stored.
INSERT INTO "quotation_lines" (
  "id", "tableId", "lineNumber", "itemId", "description", "countryOfOrigin",
  "unit", "quantity", "unitPrice", "lineTotal"
)
SELECT
  l."id",
  md5(l."quotationId"::text || ':' || l."tableTitle")::uuid,
  l."lineNumber", l."itemId", l."description", q."originCountry",
  l."unit", l."quantity", l."unitPrice", l."lineTotal"
FROM "quotation_lines_legacy" l
JOIN "quotations_legacy" q ON q."id" = l."quotationId";

-- The old tables stay behind, renamed, with every row intact. Nothing in the
-- running program reads them; they remain for an administrator who needs to
-- compare a converted document with what the previous build stored.
