-- Barcode integrity, and two catalogue rows the barcode and price-visibility
-- work needs.
--
-- 1. A barcode identifies exactly one thing inside one company: either an
--    item or one of its units. The service already refuses a duplicate, but a
--    service check is not a guarantee - two requests at the same time, an
--    import, or a restored backup can all slip past it. The trigger below
--    makes the database itself refuse, scoped to the company, and it is
--    deliberately written as a trigger rather than a unique index because
--    item_units carries no company_id: uniqueness has to join through items.
--    It only inspects rows being written, so an existing database with
--    historical duplicates keeps working instead of failing to migrate.
CREATE OR REPLACE FUNCTION kayan_barcode_conflict(
  p_company_id uuid,
  p_barcode text,
  p_item_id uuid,
  p_unit_id uuid
) RETURNS TABLE (kind text, item_code text, unit_name text)
LANGUAGE sql STABLE AS $$
  SELECT 'item', i.code, NULL::text
    FROM items i
   WHERE i.company_id = p_company_id
     AND i.deleted_at IS NULL
     AND i.barcode = p_barcode
     AND (p_item_id IS NULL OR i.id <> p_item_id)
  UNION ALL
  SELECT 'unit', i.code, u.unit
    FROM item_units u
    JOIN items i ON i.id = u.item_id
   WHERE i.company_id = p_company_id
     AND i.deleted_at IS NULL
     AND u.barcode = p_barcode
     AND (p_unit_id IS NULL OR u.id <> p_unit_id)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION kayan_check_item_barcode() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  conflict record;
BEGIN
  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO conflict FROM kayan_barcode_conflict(NEW.company_id, NEW.barcode, NEW.id, NULL);
  IF FOUND THEN
    RAISE EXCEPTION 'barcode % is already assigned to item %', NEW.barcode, conflict.item_code
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kayan_check_unit_barcode() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owning_company uuid;
  owning_code text;
  conflict record;
BEGIN
  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' THEN
    RETURN NEW;
  END IF;
  SELECT i.company_id, i.code INTO owning_company, owning_code FROM items i WHERE i.id = NEW.item_id;
  IF owning_company IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO conflict FROM kayan_barcode_conflict(owning_company, NEW.barcode, NULL, NEW.id);
  IF FOUND THEN
    IF conflict.kind = 'item' THEN
      RAISE EXCEPTION 'barcode % is already assigned to item %', NEW.barcode, conflict.item_code
        USING ERRCODE = 'unique_violation';
    END IF;
    RAISE EXCEPTION 'barcode % is already assigned to unit % of item %', NEW.barcode, conflict.unit_name, conflict.item_code
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_barcode_unique ON items;
CREATE TRIGGER items_barcode_unique
  BEFORE INSERT OR UPDATE OF barcode ON items
  FOR EACH ROW EXECUTE FUNCTION kayan_check_item_barcode();

DROP TRIGGER IF EXISTS item_units_barcode_unique ON item_units;
CREATE TRIGGER item_units_barcode_unique
  BEFORE INSERT OR UPDATE OF barcode ON item_units
  FOR EACH ROW EXECUTE FUNCTION kayan_check_unit_barcode();

-- A scanner looks a code up by exact value, so the lookup is indexed.
CREATE INDEX IF NOT EXISTS items_company_barcode_idx
  ON items (company_id, barcode)
  WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS item_units_barcode_idx
  ON item_units (barcode)
  WHERE barcode IS NOT NULL;

-- 2. Reading a cost is a privilege of its own. Until now every role that could
-- read an item also received its purchase price, so those roles are granted
-- the new code here - an upgrade must not take away a figure a user can
-- already see. A role that should not see costs is simply not granted it, and
-- from now on the API refuses to include costs for such a user even when the
-- request asks for them.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'inventory.cost.read', 'View cost and purchase prices', 'عرض التكلفة وأسعار الشراء', 'inventory'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = 'inventory.cost.read');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT rp."roleId", pn.id
FROM "role_permissions" rp
JOIN "permissions" pj ON pj.id = rp."permissionId" AND pj.code = 'inventory.items.read'
JOIN "permissions" pn ON pn.code = 'inventory.cost.read'
ON CONFLICT DO NOTHING;

-- Editing a code is editing an identifier: it is granted to whoever may edit
-- items today, and can afterwards be withheld on its own.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'inventory.barcodes.manage', 'Edit and generate barcodes', 'تعديل وتوليد أكواد الباركود', 'inventory'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = 'inventory.barcodes.manage');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT rp."roleId", pn.id
FROM "role_permissions" rp
JOIN "permissions" pj ON pj.id = rp."permissionId" AND pj.code = 'inventory.items.update'
JOIN "permissions" pn ON pn.code = 'inventory.barcodes.manage'
ON CONFLICT DO NOTHING;
