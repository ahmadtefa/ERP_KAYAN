-- Multi-unit of measure.
--
-- This migration is additive only and safe on a database that already holds
-- business data. Every new document column is nullable: rows written before
-- multi-unit existed stay NULL and are interpreted by the application in the
-- legacy way (the entered quantity already is the base-unit quantity). No old
-- row is rewritten and no financial value changes.

-- Item units gain an active flag (used units are deactivated, never deleted)
-- and an update timestamp.
ALTER TABLE "item_units"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "item_units_itemId_isActive_idx"
  ON "item_units" ("itemId", "isActive");

-- Sales invoice lines: the chosen unit label, the frozen conversion factor and
-- the quantity the user actually entered in that unit. "quantity" remains the
-- internal base-unit quantity the stock ledger moves.
ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "unitName" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "unitFactor" DECIMAL(19, 6),
  ADD COLUMN IF NOT EXISTS "unitQuantity" DECIMAL(19, 4);

-- Purchase invoice lines: identical snapshot semantics.
ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "unitName" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "unitFactor" DECIMAL(19, 6),
  ADD COLUMN IF NOT EXISTS "unitQuantity" DECIMAL(19, 4);

-- Inventory documents (adjustments, transfers, counts).
ALTER TABLE "stock_document_lines"
  ADD COLUMN IF NOT EXISTS "unitName" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "unitFactor" DECIMAL(19, 6),
  ADD COLUMN IF NOT EXISTS "unitQuantity" DECIMAL(19, 4);

-- Purchase and sales orders, so the unit chosen on the order is carried through
-- to fulfilment instead of being silently reduced to the base unit.
ALTER TABLE "purchase_order_lines"
  ADD COLUMN IF NOT EXISTS "unitName" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "unitFactor" DECIMAL(19, 6),
  ADD COLUMN IF NOT EXISTS "unitQuantity" DECIMAL(19, 4);

ALTER TABLE "sales_order_lines"
  ADD COLUMN IF NOT EXISTS "unitName" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "unitFactor" DECIMAL(19, 6),
  ADD COLUMN IF NOT EXISTS "unitQuantity" DECIMAL(19, 4);
