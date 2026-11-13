# Barcodes, units and what a printed copy may show

This note is for the next person who touches item codes or the print/PDF
options. It records what the program now guarantees, where those guarantees
live, and how they are tested.

## One code, one thing, one company

A barcode belongs to either an item or one of that item's units, and it must be
unique inside the company.

* `POST /inventory/items/:id/barcode` and
  `POST /inventory/items/:itemId/units/:unitId/barcode` assign a code. With an
  empty body the program generates one: an EAN-13 with the GS1-reserved `200`
  prefix and a real check digit, so a printed label scans. With a body of
  `{ "barcode": "..." }` the manual code is accepted only if it is free.
* `PATCH /inventory/items/:id` refuses to change `barcode` unless the caller
  holds `inventory.barcodes.manage`; editing a name is a different job from
  re-pointing an identifier that labels and scanners depend on.
* The service checks the whole company before writing, and a database trigger
  (`kayan_check_item_barcode`, `kayan_check_unit_barcode` in migration
  `20261027120000_barcode_integrity_and_cost_permission`) repeats the check
  inside the database, so a concurrent request, an import or a restored backup
  cannot slip a duplicate in. The trigger is scoped by company by joining
  through `items`, because `item_units` carries no `company_id`.

## A scan means a unit

`GET /inventory/items/by-barcode/:code` answers with:

| field | meaning |
|---|---|
| `matched` | `item` or `unit` |
| `unit` | the unit the code stands for |
| `factor` | saved conversion factor to the base unit (`1` for the item's own code) |
| `quantityPerScan` | base units one scan adds, e.g. `24.0000` for a carton of 24 |
| `salePrice` / `purchasePrice` | the unit's own price when it has one, otherwise the item's; the cost is `null` when the caller may not read costs |
| `item`, `units` | the item and its full unit list |

The factor always comes from `item_units`; nothing in the program assumes a
carton holds a dozen. `toBaseQuantity` / `fromBaseQuantity` in
`backend/src/modules/inventory/barcode.ts` do the arithmetic with `Decimal`,
rounding half-up to the four decimals the stock columns keep, so a third of a
carton is not quietly truncated away.

Stock documents (`adjustment`, `transfer`, `count`) accept an optional `unit`
per line and convert the quantity with the saved factor before anything is
posted. An unknown unit is refused rather than treated as the base unit: a
count entered as "3 pallets" must never become "3 pieces".

## What a printed copy may show

Two independent choices, `showSalePrice` and `showCost`, travel as query
options on every export route (`/exports/...` and `/exports/lists/...`).

* The dialog (`lib/features/data/presentation/widgets/price_visibility_dialog.dart`)
  asks what the person wants and disables the cost option for a role without
  `inventory.cost.read`.
* The server decides what they may have: `resolvePriceVisibility` forces
  `showCost` off for a caller without that permission, so editing a link or
  calling the API directly cannot bring a cost back.
* `applyPriceVisibility` works on a copy of the export table. Columns, row
  values **and** totals leave together: a total made of hidden prices is a
  hidden price spelled differently. The two sides are independent - hiding the
  sale price of a sales invoice leaves a cost the reader is allowed to see.
* Nothing is deleted from the database, and the stored document is untouched:
  only the rendered copy changes.

## Tests that hold this down

| behaviour | test |
|---|---|
| check digit, internal prefix, generated codes readable | `backend/src/modules/inventory/barcode.spec.ts` |
| carton/box conversion with saved factors, rounding | `backend/src/modules/inventory/barcode.spec.ts` |
| scanned item code and scanned unit code resolution | `backend/src/modules/inventory/items.barcode.spec.ts` |
| duplicate code refused across items and units | `items.barcode.spec.ts`, `inventory-reports.units.spec.ts` |
| unit add/rename/re-factor/remove, base unit protected | `inventory-reports.units.spec.ts` |
| hidden prices absent from the rendered print page | `backend/src/modules/export/price-visibility.spec.ts` |
| a caller without the cost permission cannot restore costs | `price-visibility.spec.ts` |
| the dialog will not offer a cost it may not show | `test/widget/price_visibility_dialog_test.dart` |

## Not covered yet

* Reading a barcode inside the sales, purchase and count screens: the endpoint
  and the conversion exist and are tested, the keyboard-wedge input in those
  screens is not wired up yet.
* Label printing (layout, sizes, preview, PDF of labels).
* Serial numbers, batches and expiry per item.
* Barcode labels for warehouses and storage locations.
