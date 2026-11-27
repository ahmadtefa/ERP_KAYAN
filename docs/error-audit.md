# Server error audit (generated, development branch)

Each row is one place the server refuses an action.

- `coded`: carries a stable code; the app shows a reviewed template for the codes it lists.
- `bilingual`: a bare sentence that already has an Arabic part; shown as written, not yet a reviewed template.
- `english`: a bare English sentence; in the Arabic interface it only reads well if the app's phrase list or patterns know it, otherwise the generic line is shown.

| module | sites | coded | bilingual | english only |
|---|---|---|---|---|
| inventory | 487 | 105 | 88 | 294 |
| sales | 226 | 53 | 26 | 147 |
| accounting | 207 | 28 | 1 | 178 |
| common | 139 | 9 | 18 | 112 |
| purchases | 122 | 25 | 1 | 96 |
| cash | 101 | 15 | 0 | 86 |
| returns | 79 | 11 | 3 | 65 |
| backup | 74 | 3 | 5 | 66 |
| admin | 52 | 12 | 2 | 38 |
| company | 35 | 8 | 11 | 16 |
| fixed-assets | 29 | 4 | 0 | 25 |
| cheques | 28 | 25 | 0 | 3 |
| master-data-backup | 27 | 0 | 0 | 27 |
| licensing | 25 | 18 | 1 | 6 |
| export | 23 | 8 | 0 | 15 |
| reports | 15 | 0 | 0 | 15 |
| import | 13 | 0 | 2 | 11 |
| auth | 12 | 3 | 0 | 9 |
| serials | 9 | 8 | 0 | 1 |
| commissions | 8 | 7 | 0 | 1 |
| invoicing | 6 | 0 | 0 | 6 |
| parties | 6 | 0 | 0 | 6 |
| notifications | 6 | 2 | 0 | 4 |
| withholding | 6 | 5 | 0 | 1 |
| installments | 4 | 3 | 0 | 1 |
| **total** | 1739 | 352 | 158 | 1229 |


## inventory

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/inventory/barcode-code128.ts:66 | BadRequest |  | english | Barcode character at position ${index + 1} is outside the printable Code 128 set B range`, |
| modules/inventory/barcode-code128.ts:76 | BadRequest |  | english | A barcode label needs a non-empty barcode') |
| modules/inventory/barcode-code128.ts:79 | BadRequest |  | english | Barcode is too long for a Code 128 label (max 80 characters)') |
| modules/inventory/barcode-labels.service.ts:53 | BadRequest |  | english | At least one label specification (unitId:copies) is required') |
| modules/inventory/barcode-labels.service.ts:60 | BadRequest |  | english | Malformed label specification "${fragment}". Use unitId:copies`) |
| modules/inventory/barcode-labels.service.ts:64 | BadRequest |  | english | Copies must be between 1 and ${MAX_COPIES_PER_UNIT}`) |
| modules/inventory/barcode-labels.service.ts:67 | BadRequest |  | english | Each unit may appear only once in a label job') |
| modules/inventory/barcode-labels.service.ts:74 | BadRequest |  | english | A label job cannot exceed ${MAX_LABELS_PER_JOB} labels`) |
| modules/inventory/barcode-labels.service.ts:110 | BadRequest |  | english | The item does not exist') |
| modules/inventory/barcode-labels.service.ts:135 | BadRequest |  | english | One of the chosen units does not belong to this item') |
| modules/inventory/barcode-labels.service.ts:138 | BadRequest |  | english | Unit "${unit.unit}" has no barcode. Assign one before printing labels.`, |
| modules/inventory/batches.service.ts:363 | NotFound | BATCH_NOT_FOUND | coded |  |
| modules/inventory/batches.service.ts:439 | BadRequest |  | bilingual | الكمية يجب أن تكون أكبر من صفر. / The received quantity must be greater than zero.', |
| modules/inventory/batches.service.ts:445 | BadRequest |  | bilingual | التكلفة لا تكون سالبة. / The unit cost cannot be negative.') |
| modules/inventory/batches.service.ts:461 | BadRequest |  | english |  |
| modules/inventory/batches.service.ts:538 | BadRequest |  | english |  |
| modules/inventory/batches.service.ts:559 | Conflict |  | bilingual | الدفعة ${batchNumber} مسجلة بتاريخ صلاحية ${existing.expiryDate |
| modules/inventory/batches.service.ts:730 | BadRequest |  | bilingual | الكمية يجب أن تكون أكبر من صفر. / The issued quantity must be greater than zero.', |
| modules/inventory/batches.service.ts:735 | BadRequest |  | bilingual | اسم المخزن مطلوب للصرف. / A warehouse is required to issue stock.', |
| modules/inventory/batches.service.ts:814 | BadRequest |  | bilingual | هذا الصنف يتطلب دفعة ولا يوجد مخزن للفرع. / This item is lot-controlled, but the ' |
| modules/inventory/batches.service.ts:849 | NotFound |  | bilingual | الدفعة غير موجودة أو لا يوجد بها رصيد. / The chosen lot does not exist or is empty.', |
| modules/inventory/batches.service.ts:855 | BadRequest |  | bilingual | هذا الصنف يتطلب دفعة. / This item is lot-controlled: no lot is available to issue from.', |
| modules/inventory/batches.service.ts:916 | BadRequest |  | bilingual | الموقع المختار يحوي ${here.toFixed(MONEY_SCALE)} فقط من هذا الصنف. / ` + |
| modules/inventory/batches.service.ts:943 | Forbidden |  | bilingual | الكمية المطلوبة متوفرة في دفعات منتهية الصلاحية فقط. صرفها يتطلب اعتمادًا مسجّلًا: ' + |
| modules/inventory/batches.service.ts:956 | BadRequest |  | bilingual | الرصيد غير كافٍ في الدفعات المتاحة: ينقص ${selection.shortfall.toFixed(MONEY_SCALE)}. / ` + |
| modules/inventory/batches.service.ts:998 | Conflict |  | bilingual | تغير رصيد الدفعة أثناء الصرف. أعد المحاولة. / The lot changed while it was being issued.', |
| modules/inventory/batches.service.ts:1134 | BadRequest |  | bilingual | الموقع المختار يحوي ${here.toFixed(MONEY_SCALE)} فقط من هذا الصنف. / ` + |
| modules/inventory/batches.service.ts:1141 | BadRequest |  | bilingual | الرصيد غير كافٍ في هذا المخزن: ${onHand.toFixed(MONEY_SCALE)} متاح، ` + |
| modules/inventory/batches.service.ts:1209 | BadRequest |  | bilingual | كمية الإعدام يجب أن تكون أكبر من صفر. / The written-off quantity must be positive.', |
| modules/inventory/batches.service.ts:1215 | BadRequest |  | bilingual | سبب الإعدام مطلوب. / A reason is required to write stock off.', |
| modules/inventory/batches.service.ts:1231 | NotFound |  | english | Batch not found in this warehouse') |
| modules/inventory/batches.service.ts:1233 | BadRequest |  | bilingual | الدفعة تحتوي ${batch.remainingQuantity.toFixed(MONEY_SCALE)} فقط. / ` + |
| modules/inventory/batches.service.ts:1239 | Conflict |  | bilingual | الدفعة تم إعدامها بالفعل. / This lot has already been written off.', |
| modules/inventory/batches.service.ts:1259 | BadRequest | WRITEOFF_LOCATION_SHORT | coded |  |
| modules/inventory/batches.service.ts:1271 | BadRequest | WRITEOFF_LOCATION_REQUIRED | coded |  |
| modules/inventory/batches.service.ts:1292 | Conflict |  | bilingual | تم تعديل الدفعة أثناء الإعدام. أعد المحاولة. / The lot changed while it was being written off.', |
| modules/inventory/batches.service.ts:1421 | BadRequest |  | bilingual | كمية التحويل يجب أن تكون أكبر من صفر. / The transferred quantity must be positive.', |
| modules/inventory/batches.service.ts:1426 | BadRequest |  | bilingual | لا يمكن التحويل إلى نفس المخزن. / The source and destination warehouses are the same.', |
| modules/inventory/batches.service.ts:1433 | BadRequest |  | bilingual | التحويل بين مخزنين في فرعين مختلفين غير مدعوم هنا؛ استخدم تحويل المخازن. / ' + |
| modules/inventory/batches.service.ts:1442 | NotFound |  | english | Batch not found in the source warehouse') |
| modules/inventory/batches.service.ts:1444 | BadRequest |  | bilingual | الدفعة تحتوي ${batch.remainingQuantity.toFixed(MONEY_SCALE)} فقط. / ` + |
| modules/inventory/batches.service.ts:1463 | BadRequest | TRANSFER_LOCATION_SHORT | coded |  |
| modules/inventory/batches.service.ts:1475 | BadRequest | TRANSFER_LOCATION_REQUIRED | coded |  |
| modules/inventory/batches.service.ts:1491 | BadRequest | TRANSFER_TARGET_LOCATION_INVALID | coded |  |
| modules/inventory/batches.service.ts:1504 | Conflict |  | bilingual | تم تعديل الدفعة أثناء التحويل. أعد المحاولة. / The lot changed during the transfer.', |
| modules/inventory/batches.service.ts:1962 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| modules/inventory/batches.service.ts:1964 | Forbidden |  | bilingual | هذا المخزن يخص فرعًا غير مسند إليك. / This warehouse belongs to a branch you are not assigned to.', |
| modules/inventory/batches.service.ts:1987 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/batches.service.ts:1989 | BadRequest |  | bilingual | الصنف ${item.code} غير مخزني. / Item ${item.code} is not stock-tracked.`, |
| modules/inventory/batches.service.ts:2050 | BadRequest | ISSUE_LOCATION_REQUIRED | coded |  |
| modules/inventory/batches.service.ts:2064 | BadRequest | ISSUE_LOCATION_AMBIGUOUS | coded |  |
| modules/inventory/batches.service.ts:2076 | BadRequest | ISSUE_ALLOCATION_INVALID | coded |  |
| modules/inventory/batches.service.ts:2084 | BadRequest | ISSUE_ALLOCATION_DUPLICATE | coded |  |
| modules/inventory/batches.service.ts:2096 | BadRequest | ISSUE_ALLOCATION_SUM | coded |  |
| modules/inventory/batches.service.ts:2120 | BadRequest |  | bilingual | موقع التخزين غير موجود في هذا المخزن. / The storage location is not in this warehouse.', |
| modules/inventory/batches.service.ts:2156 | BadRequest |  | bilingual | موقع التخزين غير موجود في هذا المخزن. / The storage location is not in this warehouse.', |
| modules/inventory/inventory-analysis.controller.ts:84 | Forbidden |  | english | Missing permission: inventory.export') |
| modules/inventory/inventory-analysis.controller.ts:133 | Forbidden |  | english | This report is outside your assigned warehouses.", |
| modules/inventory/inventory-analysis.controller.ts:172 | Forbidden |  | english | Missing permission: inventory.reports.${slug}.read`) |
| modules/inventory/inventory-analysis.service.ts:103 | BadRequest |  | english | Unknown report: ${slug}`) |
| modules/inventory/inventory-analysis.service.ts:110 | BadRequest |  | english | The item card needs an item.') |
| modules/inventory/inventory-print.controller.ts:191 | Forbidden |  | english | This stock document is outside your assigned warehouses.') |
| modules/inventory/inventory-print.controller.ts:255 | Forbidden |  | english | Missing permission: inventory.reports.${slug}.read`) |
| modules/inventory/inventory-print.controller.ts:258 | Forbidden |  | english | Missing permission: inventory.reports.print') |
| modules/inventory/inventory-print.controller.ts:270 | Forbidden |  | english | This report is outside your assigned branches.') |
| modules/inventory/inventory-print.controller.ts:275 | Forbidden |  | english | No branch is assigned to this account.') |
| modules/inventory/inventory-print.controller.ts:277 | BadRequest |  | english | Select one of your assigned branches to run this report.') |
| modules/inventory/inventory-report-access.ts:58 | Forbidden |  | english | This report is outside your assigned branches.", |
| modules/inventory/inventory-report-access.ts:69 | Forbidden |  | english | This report is outside your assigned warehouses.", |
| modules/inventory/inventory-report-access.ts:80 | Forbidden |  | english | This report is outside your assigned branches.", |
| modules/inventory/inventory-report-access.ts:125 | Forbidden |  | english | This report cannot be safely narrowed to the caller’s assigned scope.", |
| modules/inventory/inventory-reports.controller.ts:64 | Forbidden |  | bilingual | ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage', |
| modules/inventory/inventory-reports.controller.ts:87 | Forbidden |  | bilingual | ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage', |
| modules/inventory/inventory-reports.controller.ts:173 | Forbidden |  | bilingual | ليس لديك صلاحية إدخال أو تعديل سعر البيع. / Missing permission: inventory.items.saleprice.manage', |
| modules/inventory/inventory-reports.controller.ts:179 | Forbidden |  | bilingual | ليس لديك صلاحية إدخال أو تعديل سعر الشراء. / Missing permission: inventory.items.purchaseprice.manage', |
| modules/inventory/inventory-reports.controller.ts:194 | Forbidden |  | english | This report is outside your assigned branches.') |
| modules/inventory/inventory-reports.controller.ts:201 | Forbidden |  | english | No branch is assigned to this account.') |
| modules/inventory/inventory-reports.controller.ts:203 | BadRequest |  | english | Select one of your assigned branches to run this report.') |
| modules/inventory/inventory-reports.service.ts:49 | BadRequest |  | english | code, nameEn and nameAr are required') |
| modules/inventory/inventory-reports.service.ts:56 | Conflict |  | english | Category code ${code} is already used`) |
| modules/inventory/inventory-reports.service.ts:79 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:128 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:133 | NotFound | UNIT_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:137 | BadRequest |  | english | An inactive unit cannot be a default unit') |
| modules/inventory/inventory-reports.service.ts:143 | BadRequest |  | english | unit is required') |
| modules/inventory/inventory-reports.service.ts:145 | BadRequest |  | english | The base unit of an item cannot be renamed |
| modules/inventory/inventory-reports.service.ts:153 | Conflict |  | english | Item ${item.code} already has a unit called ${name}`) |
| modules/inventory/inventory-reports.service.ts:160 | BadRequest |  | english | factor must be 1 for the base unit of ${item.code}`) |
| modules/inventory/inventory-reports.service.ts:182 | BadRequest |  | english | ${key} is not a valid amount`) |
| modules/inventory/inventory-reports.service.ts:189 | BadRequest |  | english | ${key} must be a boolean`) |
| modules/inventory/inventory-reports.service.ts:243 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:246 | NotFound | UNIT_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:248 | BadRequest |  | english | The base unit cannot be removed |
| modules/inventory/inventory-reports.service.ts:297 | BadRequest |  | english | The base unit cannot be deactivated.') |
| modules/inventory/inventory-reports.service.ts:347 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:349 | NotFound | UNIT_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:381 | NotFound | UNIT_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:385 | BadRequest |  | english | barcode cannot be longer than 60 characters') |
| modules/inventory/inventory-reports.service.ts:395 | Conflict |  | english | Could not generate a free internal barcode |
| modules/inventory/inventory-reports.service.ts:459 | Conflict |  | english | Barcode ${barcode} is already assigned to item ${item.code}`) |
| modules/inventory/inventory-reports.service.ts:461 | Conflict |  | english | Barcode ${barcode} is already assigned to unit ${unit.unit} of item ${unit.item.code}`, |
| modules/inventory/inventory-reports.service.ts:481 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/inventory-reports.service.ts:484 | BadRequest |  | english | unit is required') |
| modules/inventory/inventory-reports.service.ts:488 | BadRequest |  | english | factor must be 1 for the base unit of ${item.code}`, |
| modules/inventory/inventory-reports.service.ts:506 | Conflict |  | english | Barcode ${barcode} is already assigned to item ${itemBarcode.code}`) |
| modules/inventory/inventory-reports.service.ts:509 | Conflict |  | english | Barcode ${barcode} is already assigned to unit ${unitBarcode.unit} of item ${unitBarcode.item.code}`) |
| modules/inventory/inventory-reports.service.ts:514 | Conflict |  | english | Item ${item.code} already has a unit called ${unit}`) |
| modules/inventory/inventory-reports.service.ts:652 | BadRequest |  | english | costCenterId must be a UUID') |
| modules/inventory/inventory-reports.service.ts:655 | BadRequest |  | english | branchId must be a UUID') |
| modules/inventory/item-image.controller.ts:62 | BadRequest |  | bilingual | No image file was uploaded / لم يتم إرسال صورة.') |
| modules/inventory/item-image.controller.ts:100 | BadRequest |  | bilingual | لا تملك صلاحية عرض أصناف أي مستودع / You may not view the catalogue of any warehouse.', |
| modules/inventory/item-image.controller.ts:125 | BadRequest |  | bilingual | لا تملك صلاحية عرض أصناف أي مستودع / You may not view the catalogue of any warehouse.', |
| modules/inventory/item-image.service.ts:66 | NotFound |  | bilingual | No image was uploaded / لم يتم إرسال صورة.') |
| modules/inventory/item-image.service.ts:78 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/item-image.service.ts:119 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/item-warehouse-settings.service.ts:126 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| modules/inventory/item-warehouse-settings.service.ts:127 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/item-warehouse-settings.service.ts:129 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| modules/inventory/item-warehouse-settings.service.ts:141 | BadRequest |  | bilingual | الحد ${label} لا يكون سالبًا. / The ${label} cannot be negative.`, |
| modules/inventory/item-warehouse-settings.service.ts:147 | BadRequest |  | bilingual | الحد الأقصى أقل من الحد الأدنى. / The maximum is below the minimum.', |
| modules/inventory/item-warehouse-settings.service.ts:152 | BadRequest |  | bilingual | نقطة إعادة الطلب أعلى من الحد الأقصى. / The reorder point is above the maximum.', |
| modules/inventory/items.controller.ts:72 | Forbidden |  | bilingual | ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage', |
| modules/inventory/items.controller.ts:119 | Forbidden |  | bilingual | ليس لديك صلاحية إدخال أو تعديل سعر البيع. / Missing permission: inventory.items.saleprice.manage', |
| modules/inventory/items.controller.ts:125 | Forbidden |  | bilingual | ليس لديك صلاحية إدخال أو تعديل سعر الشراء. / Missing permission: inventory.items.purchaseprice.manage', |
| modules/inventory/items.controller.ts:131 | Forbidden |  | bilingual | ليس لديك صلاحية إدخال تكلفة الرصيد الافتتاحي. / Missing permission: inventory.cost.manage', |
| modules/inventory/items.service.ts:77 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/items.service.ts:90 | BadRequest |  | english | barcode is required') |
| modules/inventory/items.service.ts:117 | NotFound |  | english | No item or unit carries the barcode ${barcode}`) |
| modules/inventory/items.service.ts:161 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/items.service.ts:166 | BadRequest |  | english | barcode cannot be longer than 60 characters') |
| modules/inventory/items.service.ts:177 | Conflict |  | english | Could not generate a free internal barcode |
| modules/inventory/items.service.ts:241 | Conflict |  | english | Barcode ${barcode} is already assigned to item ${item.code}`) |
| modules/inventory/items.service.ts:244 | Conflict |  | english | Barcode ${barcode} is already assigned to unit ${unit.unit} of item ${unit.item.code}`, |
| modules/inventory/items.service.ts:348 | BadRequest |  | english | code is required') |
| modules/inventory/items.service.ts:354 | BadRequest |  | english | Provide an Arabic or English item name') |
| modules/inventory/items.service.ts:381 | Conflict |  | english | Item code ${code} is already used`) |
| modules/inventory/items.service.ts:396 | Conflict |  | english | Barcode ${barcode} is already assigned to item ${itemBarcode.code}`) |
| modules/inventory/items.service.ts:397 | Conflict |  | english | Barcode ${barcode} is already assigned to unit ${unitBarcode.unit} of item ${unitBarcode.item.code}`) |
| modules/inventory/items.service.ts:407 | BadRequest |  | english | Opening stock cannot be set on an item that is not stock-tracked', |
| modules/inventory/items.service.ts:412 | BadRequest |  | english | openingQuantity and openingUnitCost must be given together', |
| modules/inventory/items.service.ts:417 | BadRequest |  | english | openingQuantity must be greater than zero') |
| modules/inventory/items.service.ts:420 | BadRequest |  | english | Select a branch before adding opening stock', |
| modules/inventory/items.service.ts:441 | BadRequest |  | english | This branch already has an opening balance (${existingOpening.documentNumber}). ` + |
| modules/inventory/items.service.ts:508 | Forbidden | ITEM_OPENING_WAREHOUSE_FORBIDDEN | coded |  |
| modules/inventory/items.service.ts:515 | BadRequest | ITEM_OPENING_WAREHOUSE_INACTIVE | coded |  |
| modules/inventory/items.service.ts:530 | Conflict | ITEM_OPENING_TARGET_CHANGED | coded |  |
| modules/inventory/items.service.ts:556 | BadRequest | ITEM_OPENING_LOCATION_NOT_FOUND | coded |  |
| modules/inventory/items.service.ts:562 | BadRequest | ITEM_OPENING_LOCATION_INACTIVE | coded |  |
| modules/inventory/items.service.ts:569 | BadRequest | ITEM_OPENING_LOCATION_WRONG_WAREHOUSE | coded |  |
| modules/inventory/items.service.ts:667 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/items.service.ts:675 | BadRequest |  | english | Provide an Arabic or English item name') |
| modules/inventory/items.service.ts:718 | Conflict |  | english | Barcode ${barcode} is already assigned to item ${itemBarcode.code}`) |
| modules/inventory/items.service.ts:719 | Conflict |  | english | Barcode ${barcode} is already assigned to unit ${unitBarcode.unit} of item ${unitBarcode.item.code}`) |
| modules/inventory/items.service.ts:797 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/items.service.ts:805 | BadRequest |  | english | This item still has ${onHand.toFixed(MONEY_SCALE)} in stock. ` + |
| modules/inventory/items.service.ts:847 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/inventory/items.service.ts:850 | BadRequest |  | english | ${field} is not a valid amount`) |
| modules/inventory/items.service.ts:860 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/inventory/items.service.ts:861 | BadRequest |  | english | ${field} cannot exceed 100`) |
| modules/inventory/items.service.ts:864 | BadRequest |  | english | ${field} is not a valid percentage`) |
| modules/inventory/items.service.ts:967 | BadRequest |  | bilingual | لا يمكن تغيير وحدة الأساس للصنف من "${fromUnit}" إلى "${toUnit}" لأنه مسجّل عليه ` + |
| modules/inventory/items.service.ts:1083 | Forbidden |  | bilingual | ليس لديك صلاحية تعديل أكواد باركود الوحدات. / Missing permission: inventory.barcodes.manage', |
| modules/inventory/items.service.ts:1182 | Conflict |  | bilingual | الباركود ${code} مكرر داخل الصنف. / Barcode ${code} is used twice on this item.`, |
| modules/inventory/items.service.ts:1204 | Conflict |  | bilingual | الباركود ${unitClash.barcode} مستخدم في وحدة "${unitClash.unit}" بالصنف ${unitClash.item.code}. / ` + |
| modules/inventory/items.service.ts:1210 | Conflict |  | bilingual | الباركود ${itemClash.barcode} مستخدم في الصنف ${itemClash.code}. / ` + |
| modules/inventory/original-stock-movement.ts:46 | BadRequest |  | english | The original stock movements are missing or ambiguous |
| modules/inventory/stock-documents.controller.ts:62 | Forbidden |  | bilingual | ليس لديك صلاحية تنفيذ هذا الإجراء (${needed}). اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والص |
| modules/inventory/stock-documents.controller.ts:120 | BadRequest |  | english | voucherKind must be RECEIPT or ISSUE') |
| modules/inventory/stock-documents.controller.ts:133 | BadRequest |  | english | This is not a warehouse voucher') |
| modules/inventory/stock-documents.controller.ts:153 | BadRequest |  | english | This is not a warehouse voucher') |
| modules/inventory/stock-documents.controller.ts:169 | BadRequest |  | english | This is not a warehouse voucher') |
| modules/inventory/stock-documents.controller.ts:314 | BadRequest |  | english | expectedVersion is required') |
| modules/inventory/stock-documents.service.ts:138 | BadRequest |  | english | Unknown stock document kind: ${query.kind}`) |
| modules/inventory/stock-documents.service.ts:145 | BadRequest |  | english | Search must be text of at most 120 characters') |
| modules/inventory/stock-documents.service.ts:251 | NotFound | STOCK_DOCUMENT_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:346 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/inventory/stock-documents.service.ts:352 | BadRequest |  | english | Unknown stock voucher kind') |
| modules/inventory/stock-documents.service.ts:357 | Forbidden |  | english | inventory.cost.read permission is required to record receipt unit costs') |
| modules/inventory/stock-documents.service.ts:359 | BadRequest |  | english | Stock voucher must belong to the signed-in branch') |
| modules/inventory/stock-documents.service.ts:360 | BadRequest |  | english | idempotencyKey is required for stock vouchers') |
| modules/inventory/stock-documents.service.ts:367 | BadRequest |  | english | kind must be ADJUSTMENT, TRANSFER, COUNT, WRITE_OFF or OPENING') |
| modules/inventory/stock-documents.service.ts:369 | BadRequest |  | english | Stock vouchers must be adjustments') |
| modules/inventory/stock-documents.service.ts:373 | BadRequest |  | bilingual | A write-off needs a reason. / مستند الإعدام يتطلب سببًا.') |
| modules/inventory/stock-documents.service.ts:376 | BadRequest |  | english | Use an opening balance document for opening stock: it posts the accounting and the stock together.', |
| modules/inventory/stock-documents.service.ts:381 | BadRequest |  | english | A stock voucher needs a warehouse, reason and counterparty') |
| modules/inventory/stock-documents.service.ts:385 | BadRequest |  | english | The voucher warehouse does not belong to this branch or is inactive') |
| modules/inventory/stock-documents.service.ts:388 | BadRequest |  | english | A stock document needs at least one line') |
| modules/inventory/stock-documents.service.ts:405 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/inventory/stock-documents.service.ts:416 | Conflict |  | english | The idempotency key belongs to a document without a request fingerprint |
| modules/inventory/stock-documents.service.ts:424 | BadRequest |  | english | Target branch does not belong to this company') |
| modules/inventory/stock-documents.service.ts:433 | BadRequest |  | english | A stock transfer cannot carry a cost center: it is not a cost.') |
| modules/inventory/stock-documents.service.ts:436 | BadRequest |  | english | costCenterId must be a UUID') |
| modules/inventory/stock-documents.service.ts:462 | BadRequest |  | english | Line ${index + 1}: the item does not exist`) |
| modules/inventory/stock-documents.service.ts:464 | BadRequest |  | english | Line ${index + 1}: item ${item.code} is not stock-tracked`) |
| modules/inventory/stock-documents.service.ts:477 | BadRequest |  | english | Line ${index + 1}: receipt unit cost is required`) |
| modules/inventory/stock-documents.service.ts:530 | BadRequest |  | english | Line ${index + 1}: a quantity is required`) |
| modules/inventory/stock-documents.service.ts:532 | BadRequest |  | english | Line ${index + 1}: receipt quantity must be positive`) |
| modules/inventory/stock-documents.service.ts:533 | BadRequest |  | english | Line ${index + 1}: issue quantity must be negative`) |
| modules/inventory/stock-documents.service.ts:535 | BadRequest |  | english | Line ${index + 1}: transfer quantity must be positive`) |
| modules/inventory/stock-documents.service.ts:542 | BadRequest |  | bilingual | Line ${index + 1}: a write-off removes stock, so its quantity is negative. / ` + |
| modules/inventory/stock-documents.service.ts:548 | BadRequest |  | english | Line ${index + 1}: a count needs the quantity that was actually counted`) |
| modules/inventory/stock-documents.service.ts:551 | BadRequest |  | english | Line ${index + 1}: the unit cost cannot be negative`) |
| modules/inventory/stock-documents.service.ts:554 | BadRequest |  | english | Line ${index + 1}: stock value exceeds the supported range`) |
| modules/inventory/stock-documents.service.ts:566 | BadRequest |  | english | Line ${index + 1}: the lot does not belong to this item`) |
| modules/inventory/stock-documents.service.ts:594 | BadRequest | STOCK_DOC_LOCATION_INACTIVE | coded |  |
| modules/inventory/stock-documents.service.ts:602 | BadRequest | STOCK_DOC_LOCATION_INVALID | coded |  |
| modules/inventory/stock-documents.service.ts:621 | BadRequest | STOCK_DOC_TARGET_LOCATION_INVALID | coded |  |
| modules/inventory/stock-documents.service.ts:649 | BadRequest |  | english | A cost center is required when issuing stock from a warehouse.') |
| modules/inventory/stock-documents.service.ts:664 | BadRequest |  | english | A transfer needs the branch the stock leaves') |
| modules/inventory/stock-documents.service.ts:667 | BadRequest |  | english | Source branch does not belong to this company') |
| modules/inventory/stock-documents.service.ts:669 | BadRequest |  | english | A transfer needs two different branches, or two different warehouses of the same branch', |
| modules/inventory/stock-documents.service.ts:674 | BadRequest |  | english | A transfer needs two different warehouses') |
| modules/inventory/stock-documents.service.ts:759 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/inventory/stock-documents.service.ts:761 | BadRequest |  | english | idempotencyKey is required') |
| modules/inventory/stock-documents.service.ts:763 | BadRequest |  | english | expectedVersion must be a non-negative integer') |
| modules/inventory/stock-documents.service.ts:774 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:776 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:783 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/inventory/stock-documents.service.ts:786 | Conflict |  | english | The voucher has changed since this request |
| modules/inventory/stock-documents.service.ts:790 | BadRequest |  | english | Only a draft stock voucher can be edited') |
| modules/inventory/stock-documents.service.ts:791 | Conflict |  | english | The voucher has changed |
| modules/inventory/stock-documents.service.ts:794 | BadRequest |  | english | A stock voucher needs a warehouse, reason and counterparty') |
| modules/inventory/stock-documents.service.ts:796 | BadRequest |  | english | notes must be text') |
| modules/inventory/stock-documents.service.ts:798 | BadRequest |  | english | A stock voucher needs between 1 and 1000 lines') |
| modules/inventory/stock-documents.service.ts:802 | BadRequest |  | english | The voucher warehouse does not belong to this branch or is inactive') |
| modules/inventory/stock-documents.service.ts:805 | BadRequest |  | english | costCenterId must be a UUID') |
| modules/inventory/stock-documents.service.ts:813 | BadRequest |  | english | Line ${index + 1}: item is required`) |
| modules/inventory/stock-documents.service.ts:815 | BadRequest |  | english | Line ${index + 1}: invalid or duplicate line id`) |
| modules/inventory/stock-documents.service.ts:817 | BadRequest |  | english | Line ${index + 1}: use unitName when editing a voucher`) |
| modules/inventory/stock-documents.service.ts:819 | BadRequest |  | english | Line ${index + 1}: the stock item does not exist`) |
| modules/inventory/stock-documents.service.ts:822 | BadRequest |  | english | Line ${index + 1}: invalid voucher quantity`) |
| modules/inventory/stock-documents.service.ts:827 | BadRequest |  | english | Line ${index + 1}: invalid historic unit snapshot`) |
| modules/inventory/stock-documents.service.ts:830 | BadRequest |  | english | Line ${index + 1}: invalid historic unit snapshot`) |
| modules/inventory/stock-documents.service.ts:832 | BadRequest |  | english | Line ${index + 1}: inconsistent historic unit snapshot`) |
| modules/inventory/stock-documents.service.ts:844 | Forbidden |  | english | inventory.cost.read permission is required to submit receipt unit costs') |
| modules/inventory/stock-documents.service.ts:850 | BadRequest |  | english | Line ${index + 1}: receipt unit cost is required`) |
| modules/inventory/stock-documents.service.ts:860 | BadRequest |  | english | Line ${index + 1}: invalid stock value`) |
| modules/inventory/stock-documents.service.ts:861 | BadRequest |  | english | Line ${index + 1}: notes must be text`) |
| modules/inventory/stock-documents.service.ts:865 | BadRequest |  | english | A cost center is required when issuing stock from a warehouse.') |
| modules/inventory/stock-documents.service.ts:893 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/inventory/stock-documents.service.ts:899 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:901 | BadRequest |  | english | Only a draft stock voucher can be reviewed or approved') |
| modules/inventory/stock-documents.service.ts:902 | Conflict |  | english | The voucher has changed |
| modules/inventory/stock-documents.service.ts:907 | BadRequest |  | english | The stock voucher must be reviewed before approval') |
| modules/inventory/stock-documents.service.ts:992 | NotFound | STOCK_DOCUMENT_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:994 | BadRequest |  | bilingual | Only a write-off needs an approval. / الاعتماد مطلوب لمستند الإعدام فقط.') |
| modules/inventory/stock-documents.service.ts:997 | BadRequest |  | bilingual | This write-off was already approved. / تم اعتماد هذا المستند مسبقًا (${document.documentNumber}).`) |
| modules/inventory/stock-documents.service.ts:1000 | BadRequest |  | english | Only a draft write-off can be approved') |
| modules/inventory/stock-documents.service.ts:1003 | BadRequest | WRITE_OFF_SELF_APPROVAL | coded |  |
| modules/inventory/stock-documents.service.ts:1014 | BadRequest |  | english | This write-off was approved by someone else a moment ago.') |
| modules/inventory/stock-documents.service.ts:1042 | NotFound | STOCK_DOCUMENT_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:1043 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:1045 | BadRequest |  | english | expectedVersion is required for posting a stock voucher') |
| modules/inventory/stock-documents.service.ts:1048 | BadRequest |  | english | Only a draft stock document can be posted (current status: ${initialDocument.status})`, |
| modules/inventory/stock-documents.service.ts:1053 | BadRequest |  | english | Stock voucher must be reviewed and approved before posting') |
| modules/inventory/stock-documents.service.ts:1060 | BadRequest | WRITE_OFF_NOT_APPROVED | coded |  |
| modules/inventory/stock-documents.service.ts:1069 | BadRequest | WRITE_OFF_SELF_POST | coded |  |
| modules/inventory/stock-documents.service.ts:1076 | BadRequest |  | english | Transfer quantities must be positive before posting') |
| modules/inventory/stock-documents.service.ts:1092 | BadRequest |  | english | This document has just been posted by someone else.') |
| modules/inventory/stock-documents.service.ts:1101 | NotFound | STOCK_DOCUMENT_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:1102 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:1104 | Conflict |  | english | The voucher has changed |
| modules/inventory/stock-documents.service.ts:1107 | BadRequest |  | english | Stock voucher must be reviewed and approved before posting') |
| modules/inventory/stock-documents.service.ts:1110 | BadRequest |  | bilingual | A write-off must be approved before it is posted. / يجب اعتماد مستند الإعدام قبل ترحيله.') |
| modules/inventory/stock-documents.service.ts:1114 | BadRequest |  | english | A cost center is required when issuing stock from a warehouse.') |
| modules/inventory/stock-documents.service.ts:1128 | BadRequest |  | english | Transfer quantities must be positive before posting') |
| modules/inventory/stock-documents.service.ts:1207 | BadRequest |  | english | Not enough stock to transfer: ${availableQty.toFixed(MONEY_SCALE)} on hand, ` + |
| modules/inventory/stock-documents.service.ts:1273 | BadRequest | STOCK_DOC_TARGET_LOCATION_INVALID | coded |  |
| modules/inventory/stock-documents.service.ts:1306 | BadRequest | STOCK_DOC_TRANSFER_LOT_REQUIRED | coded |  |
| modules/inventory/stock-documents.service.ts:1316 | BadRequest | STOCK_DOC_TRANSFER_LOT_COVERAGE | coded |  |
| modules/inventory/stock-documents.service.ts:1383 | BadRequest | STOCK_DOC_LOCATION_INVALID | coded |  |
| modules/inventory/stock-documents.service.ts:1541 | BadRequest |  | bilingual | The lot does not hold enough for that quantity. / الدفعة لا تحمل الكمية المطلوبة.', |
| modules/inventory/stock-documents.service.ts:1634 | NotFound | STOCK_DOCUMENT_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:1635 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:1637 | BadRequest |  | english | Only a posted stock document can be reversed') |
| modules/inventory/stock-documents.service.ts:1642 | BadRequest |  | english | Cannot automatically reverse a transfer with negative quantities |
| modules/inventory/stock-documents.service.ts:1650 | BadRequest |  | english | This document has just been changed by someone else.') |
| modules/inventory/stock-documents.service.ts:1759 | BadRequest |  | english | The original transfer movements have different costs |
| modules/inventory/stock-documents.service.ts:1774 | BadRequest | STOCK_DOC_REVERSE_LOT_AMBIGUOUS | coded |  |
| modules/inventory/stock-documents.service.ts:1783 | BadRequest | STOCK_DOC_REVERSE_LOT_AMBIGUOUS | coded |  |
| modules/inventory/stock-documents.service.ts:1801 | BadRequest | STOCK_DOC_REVERSE_LOT_SHELF_SHORT | coded |  |
| modules/inventory/stock-documents.service.ts:1820 | BadRequest | STOCK_DOC_REVERSE_SHELF_SHORT | coded |  |
| modules/inventory/stock-documents.service.ts:1856 | BadRequest |  | english | The original stock movements do not match the document |
| modules/inventory/stock-documents.service.ts:1952 | BadRequest | STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE | coded |  |
| modules/inventory/stock-documents.service.ts:1979 | BadRequest | STOCK_DOC_REVERSE_LOT_SHORT | coded |  |
| modules/inventory/stock-documents.service.ts:2102 | Conflict |  | bilingual | تم تعديل الدفعة أثناء التحويل. أعد المحاولة. / The lot changed while the transfer was posted |
| modules/inventory/stock-documents.service.ts:2213 | BadRequest |  | english | Not enough stock: ${onHand.toFixed(MONEY_SCALE)} on hand, ` + |
| modules/inventory/stock-documents.service.ts:2307 | NotFound | STOCK_DOCUMENT_NOT_FOUND | coded |  |
| modules/inventory/stock-documents.service.ts:2320 | Conflict | STOCK_DOC_VERSION_CHANGED | coded |  |
| modules/inventory/stock-documents.service.ts:2531 | BadRequest | STOCK_DOC_LOCATION_REQUIRED | coded |  |
| modules/inventory/stock-documents.service.ts:2543 | BadRequest | STOCK_DOC_SHELF_SHORT | coded |  |
| modules/inventory/stock-documents.service.ts:2564 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/inventory/stock-documents.service.ts:2566 | BadRequest |  | english | ${field} is outside the supported range or precision`) |
| modules/inventory/stock-documents.service.ts:2575 | BadRequest |  | english | ${field} is not a valid date`) |
| modules/inventory/stock-takes.service.ts:106 | NotFound | STOCK_TAKE_SESSION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:197 | BadRequest |  | english | The request key must be 1 to 120 characters.') |
| modules/inventory/stock-takes.service.ts:256 | Conflict |  | english | This request key was already used for a different count. Nothing was created. Review the earlier count or star |
| modules/inventory/stock-takes.service.ts:265 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:267 | BadRequest |  | english | This warehouse belongs to a branch you cannot access.') |
| modules/inventory/stock-takes.service.ts:273 | BadRequest |  | english | A partial count must name the items it covers.') |
| modules/inventory/stock-takes.service.ts:287 | BadRequest |  | english | A partial count can include only existing stock-tracked items.') |
| modules/inventory/stock-takes.service.ts:427 | BadRequest |  | english | A counted item does not exist') |
| modules/inventory/stock-takes.service.ts:447 | Conflict |  | english | This request key was already used for a different count. Nothing was created. Review the earlier count or star |
| modules/inventory/stock-takes.service.ts:491 | NotFound | STOCK_TAKE_SESSION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:493 | BadRequest |  | bilingual | اختر الصنف وموقع التخزين. / Choose the item and the storage location.') |
| modules/inventory/stock-takes.service.ts:500 | BadRequest | STOCK_TAKE_NOT_COUNTING | coded |  |
| modules/inventory/stock-takes.service.ts:510 | BadRequest | STOCK_TAKE_ITEM_NOT_IN_SESSION | coded |  |
| modules/inventory/stock-takes.service.ts:520 | BadRequest | STOCK_TAKE_LOCATION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:522 | BadRequest | STOCK_TAKE_LOCATION_INACTIVE | coded |  |
| modules/inventory/stock-takes.service.ts:525 | BadRequest | STOCK_TAKE_LOCATION_WRONG_WAREHOUSE | coded |  |
| modules/inventory/stock-takes.service.ts:529 | BadRequest | STOCK_TAKE_LOT_REQUIRED | coded |  |
| modules/inventory/stock-takes.service.ts:532 | BadRequest | STOCK_TAKE_LOT_NOT_IN_SESSION | coded |  |
| modules/inventory/stock-takes.service.ts:536 | BadRequest | STOCK_TAKE_LOT_NOT_IN_SESSION | coded |  |
| modules/inventory/stock-takes.service.ts:539 | Conflict | STOCK_TAKE_LOCATION_ALREADY_COUNTED | coded |  |
| modules/inventory/stock-takes.service.ts:595 | NotFound | STOCK_TAKE_SESSION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:597 | BadRequest |  | english | This session is no longer open for counting (status: ${session.status}).`, |
| modules/inventory/stock-takes.service.ts:602 | BadRequest |  | english | Nothing to record.') |
| modules/inventory/stock-takes.service.ts:611 | BadRequest |  | bilingual | هذا الجرد لم يعد مفتوحًا للعد (الحالة: ${locked?.status ?? '-'}). ما أدخلته لم يُحفظ في الجرد؛ أعد إدخاله بعد  |
| modules/inventory/stock-takes.service.ts:639 | BadRequest |  | english | Line ${entry.lineId} does not belong to this session.`) |
| modules/inventory/stock-takes.service.ts:670 | BadRequest |  | english | A counted quantity cannot be negative.') |
| modules/inventory/stock-takes.service.ts:690 | BadRequest |  | english | Cannot finish this count: ${uncounted} line(s) have not been counted.`, |
| modules/inventory/stock-takes.service.ts:776 | NotFound | STOCK_TAKE_SESSION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:778 | BadRequest |  | bilingual | This count was already approved (status: ${session.status}). / تم اعتماد هذا الجرد مسبقًا.`, |
| modules/inventory/stock-takes.service.ts:783 | BadRequest |  | english | A count can be approved only after every line is counted and submitted for review (status: ${session.status}). |
| modules/inventory/stock-takes.service.ts:788 | BadRequest |  | english | The person who opened a count cannot approve its differences.', |
| modules/inventory/stock-takes.service.ts:798 | Conflict |  | english | This count was approved by someone else a moment ago.') |
| modules/inventory/stock-takes.service.ts:824 | NotFound | STOCK_TAKE_SESSION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:826 | BadRequest |  | bilingual |  |
| modules/inventory/stock-takes.service.ts:847 | Conflict |  | english | This count was posted by someone else a moment ago.') |
| modules/inventory/stock-takes.service.ts:884 | Conflict |  | english | The existing stock-take document does not match this approved count.') |
| modules/inventory/stock-takes.service.ts:953 | NotFound | STOCK_TAKE_SESSION_NOT_FOUND | coded |  |
| modules/inventory/stock-takes.service.ts:955 | BadRequest |  | english | A posted count cannot be cancelled |
| modules/inventory/stock-takes.service.ts:967 | Conflict |  | english | This count is no longer open.') |
| modules/inventory/stock-transfers.controller.ts:45 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.controller.ts:56 | BadRequest |  | english | Idempotency-Key header is required') |
| modules/inventory/stock-transfers.controller.ts:79 | Conflict |  | english | This transfer uses a configured approval chain |
| modules/inventory/stock-transfers.controller.ts:221 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:69 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:79 | BadRequest |  | english | A transfer reason is required') |
| modules/inventory/stock-transfers.service.ts:80 | BadRequest |  | english | A transfer needs 1 to 500 lines') |
| modules/inventory/stock-transfers.service.ts:92 | Conflict |  | english | The idempotency key belongs to a different transfer request') |
| modules/inventory/stock-transfers.service.ts:99 | BadRequest |  | english | Source and destination warehouses must be active warehouses in this company') |
| modules/inventory/stock-transfers.service.ts:100 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:101 | BadRequest |  | english | Choose two different warehouses') |
| modules/inventory/stock-transfers.service.ts:106 | BadRequest |  | english | Line ${idx + 1}: item is not a stock-tracked item`) |
| modules/inventory/stock-transfers.service.ts:108 | BadRequest |  | english | Line ${idx + 1}: selected unit does not exist for this item`) |
| modules/inventory/stock-transfers.service.ts:109 | BadRequest |  | english | Line ${idx + 1}: selected unit is not active for this item`) |
| modules/inventory/stock-transfers.service.ts:112 | BadRequest |  | english | Line ${idx + 1}: quantity does not convert exactly to base units`) |
| modules/inventory/stock-transfers.service.ts:116 | BadRequest |  | english | Line ${idx + 1}: source lot is unavailable or has insufficient quantity`) |
| modules/inventory/stock-transfers.service.ts:118 | BadRequest |  | english | Line ${idx + 1}: choose a source lot for this batch-controlled item`) |
| modules/inventory/stock-transfers.service.ts:149 | BadRequest |  | english | The requester cannot review their own transfer') |
| modules/inventory/stock-transfers.service.ts:185 | BadRequest |  | english | The requester cannot approve their own transfer') |
| modules/inventory/stock-transfers.service.ts:186 | BadRequest |  | english | The reviewer cannot also approve the transfer') |
| modules/inventory/stock-transfers.service.ts:192 | BadRequest |  | english | An approval actor is required for a configured chain') |
| modules/inventory/stock-transfers.service.ts:221 | BadRequest |  | english | A rejection reason is required') |
| modules/inventory/stock-transfers.service.ts:225 | BadRequest |  | english | The requester cannot reject their own transfer') |
| modules/inventory/stock-transfers.service.ts:230 | BadRequest |  | english | An approval actor is required to reject a configured chain') |
| modules/inventory/stock-transfers.service.ts:257 | BadRequest |  | english | A return reason is required') |
| modules/inventory/stock-transfers.service.ts:260 | Conflict |  | english | A transfer cannot be returned from ${row.status}`) |
| modules/inventory/stock-transfers.service.ts:264 | BadRequest |  | english | The requester cannot return their own transfer') |
| modules/inventory/stock-transfers.service.ts:421 | Conflict |  | english | Idempotency key was reused with different dispatch quantities') |
| modules/inventory/stock-transfers.service.ts:437 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:439 | Conflict |  | english | Idempotency key was reused with different dispatch quantities') |
| modules/inventory/stock-transfers.service.ts:440 | Conflict |  | english | Cannot dispatch a transfer in ${current.status}`) |
| modules/inventory/stock-transfers.service.ts:456 | Conflict |  | english | Another dispatch is in progress |
| modules/inventory/stock-transfers.service.ts:457 | Conflict |  | english | Cannot dispatch a transfer in ${transfer.status}`) |
| modules/inventory/stock-transfers.service.ts:470 | Conflict |  | english | Dispatch reservation was lost') |
| modules/inventory/stock-transfers.service.ts:473 | Conflict |  | english | Transfer changed while dispatching') |
| modules/inventory/stock-transfers.service.ts:501 | Conflict |  | english | Idempotency key was reused with different receipt quantities') |
| modules/inventory/stock-transfers.service.ts:517 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:519 | Conflict |  | english | Idempotency key was reused with different receipt quantities') |
| modules/inventory/stock-transfers.service.ts:520 | Conflict |  | english | Cannot receive a transfer in ${current.status}`) |
| modules/inventory/stock-transfers.service.ts:527 | Conflict |  | english | Another receipt is in progress |
| modules/inventory/stock-transfers.service.ts:528 | Conflict |  | english | Cannot receive a transfer in ${transfer.status}`) |
| modules/inventory/stock-transfers.service.ts:541 | Conflict |  | english | Receipt reservation was lost') |
| modules/inventory/stock-transfers.service.ts:544 | Conflict |  | english | Transfer changed while receiving') |
| modules/inventory/stock-transfers.service.ts:567 | Conflict |  | english | Idempotency key was reused with different settlement quantities') |
| modules/inventory/stock-transfers.service.ts:572 | Conflict |  | english | Receive dispatched goods before settling differences') |
| modules/inventory/stock-transfers.service.ts:578 | BadRequest |  | english | Unknown or repeated transfer line') |
| modules/inventory/stock-transfers.service.ts:584 | BadRequest |  | english | Settlement exceeds the unresolved quantity in transit') |
| modules/inventory/stock-transfers.service.ts:585 | BadRequest |  | english | A reason is required for every shortage or damage write-off') |
| modules/inventory/stock-transfers.service.ts:590 | BadRequest |  | english | Enter returned, missing or damaged quantities to settle') |
| modules/inventory/stock-transfers.service.ts:595 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:596 | Conflict |  | english | Cannot settle a transfer in ${current.status}`) |
| modules/inventory/stock-transfers.service.ts:627 | Conflict |  | english | Settlement reservation was lost or changed') |
| modules/inventory/stock-transfers.service.ts:629 | Conflict |  | english | Transfer changed while settlement was processing') |
| modules/inventory/stock-transfers.service.ts:658 | Conflict |  | english | Idempotency key was reused for a different settlement approval') |
| modules/inventory/stock-transfers.service.ts:662 | Conflict |  | english | There is no pending transfer write-off to approve') |
| modules/inventory/stock-transfers.service.ts:663 | BadRequest |  | english | The person reporting a transfer difference cannot approve its write-off') |
| modules/inventory/stock-transfers.service.ts:672 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:678 | Conflict |  | english | Idempotency key was reused for a different settlement approval') |
| modules/inventory/stock-transfers.service.ts:690 | Conflict |  | english | Transfer settlement has changed') |
| modules/inventory/stock-transfers.service.ts:709 | Conflict |  | english | A transfer may close only after receipts and differences are reconciled') |
| modules/inventory/stock-transfers.service.ts:711 | Conflict |  | english | Unresolved goods remain in transit |
| modules/inventory/stock-transfers.service.ts:726 | BadRequest |  | english | Unknown action. Use one of: ' + Object.keys(map).join(', ')) |
| modules/inventory/stock-transfers.service.ts:833 | Conflict |  | english | Idempotency key was reused for a different cancellation') |
| modules/inventory/stock-transfers.service.ts:837 | Conflict |  | english | Approve or reconcile the pending write-off before cancellation') |
| modules/inventory/stock-transfers.service.ts:852 | Conflict |  | english | A transfer movement is not in a reversible posted state') |
| modules/inventory/stock-transfers.service.ts:858 | Conflict |  | english | Transfer changed and cannot be cancelled') |
| modules/inventory/stock-transfers.service.ts:868 | Conflict |  | english | This transfer cannot be cancelled at its current stage') |
| modules/inventory/stock-transfers.service.ts:895 | NotFound | STOCK_TRANSFER_NOT_FOUND | coded |  |
| modules/inventory/stock-transfers.service.ts:897 | Conflict |  | english | Idempotency key was reused with a different action') |
| modules/inventory/stock-transfers.service.ts:898 | Conflict |  | english | Cannot transition transfer from ${row.status} to ${status}`) |
| modules/inventory/stock-transfers.service.ts:900 | Conflict |  | english | Transfer changed |
| modules/inventory/stock-transfers.service.ts:1115 | Conflict |  | english | Could not initialize the company transit warehouse') |
| modules/inventory/stock-transfers.service.ts:1129 | BadRequest |  | english | No quantities are available for this action') |
| modules/inventory/stock-transfers.service.ts:1132 | BadRequest |  | english | Unknown or repeated transfer line') |
| modules/inventory/stock-transfers.service.ts:1135 | BadRequest |  | english | Quantity exceeds the ${stage==='dispatch'?'undispatched':'in-transit'} quantity`) |
| modules/inventory/stock-transfers.service.ts:1136 | Conflict |  | english | Transit lot is not available |
| modules/inventory/stock-transfers.service.ts:1140 | BadRequest |  | english | ${label} must be greater than zero`)})() |
| modules/inventory/stock-transfers.service.ts:1141 | BadRequest |  | english | ${label} must be numeric`) |
| modules/inventory/stock-transfers.service.ts:1141 | BadRequest |  | english | ${label} must be non-negative with at most four decimal places`) |
| modules/inventory/stock-transfers.service.ts:1142 | BadRequest |  | english | A valid idempotency key is required') |
| modules/inventory/stock-transfers.service.ts:1142 | BadRequest |  | english | Idempotency keys may be at most 60 characters') |
| modules/inventory/stock-transfers.service.ts:1144 | BadRequest |  | english | A valid YYYY-MM-DD date is required') |
| modules/inventory/stock.controller.ts:27 | Forbidden |  | bilingual | Branch-wide stock totals are unavailable with restricted warehouse access. Use the warehouse balance view. / إ |
| modules/inventory/stock.service.ts:227 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:103 | Forbidden |  | english | You cannot view locations in this warehouse') |
| modules/inventory/storage-locations.service.ts:110 | Forbidden |  | english | This warehouse belongs to another branch') |
| modules/inventory/storage-locations.service.ts:139 | Forbidden |  | english | You cannot manage locations in this warehouse') |
| modules/inventory/storage-locations.service.ts:143 | BadRequest |  | english | Unknown location kind ${input.kind}. Use one of ${LOCATION_KINDS.join(', ')}.`, |
| modules/inventory/storage-locations.service.ts:155 | BadRequest |  | bilingual | الأب غير موجود في هذا المخزن. / The parent location is not in this warehouse.', |
| modules/inventory/storage-locations.service.ts:160 | BadRequest |  | bilingual | الموقع من نوع ${kind} لا يمكن أن يوضع داخل ${parent.kind}. / ` + |
| modules/inventory/storage-locations.service.ts:166 | BadRequest |  | bilingual | الموقع من نوع ${kind} يجب أن يكون داخل ${PARENT_OF[kind].join(' أو ')}. / ` + |
| modules/inventory/storage-locations.service.ts:178 | Conflict |  | bilingual | الكود ${input.code} مستخدم في هذا المخزن. / Code ${input.code} already exists here.`, |
| modules/inventory/storage-locations.service.ts:221 | NotFound | STORAGE_LOCATION_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:223 | Forbidden |  | english | You cannot manage locations in this warehouse') |
| modules/inventory/storage-locations.service.ts:226 | Forbidden |  | english | This location belongs to another branch') |
| modules/inventory/storage-locations.service.ts:240 | Conflict |  | english | Code ${input.code} already exists in this warehouse`) |
| modules/inventory/storage-locations.service.ts:245 | BadRequest |  | english | A location cannot contain itself') |
| modules/inventory/storage-locations.service.ts:257 | BadRequest |  | english | The parent location does not exist here') |
| modules/inventory/storage-locations.service.ts:259 | BadRequest |  | english | A ${existing.kind} cannot be placed inside a ${parent.kind}`, |
| modules/inventory/storage-locations.service.ts:268 | BadRequest |  | bilingual | هذا النقل يجعل الموقع داخل نفسه. / That move would place a location inside itself.', |
| modules/inventory/storage-locations.service.ts:320 | NotFound | STORAGE_LOCATION_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:322 | Forbidden |  | english | You cannot manage locations in this warehouse') |
| modules/inventory/storage-locations.service.ts:325 | Forbidden |  | english | This location belongs to another branch') |
| modules/inventory/storage-locations.service.ts:331 | Conflict |  | bilingual | لا يمكن حذف موقع يحتوي على ${children} موقعًا فرعيًا. / ` + |
| modules/inventory/storage-locations.service.ts:346 | Conflict |  | bilingual | لا يمكن حذف موقع به ${Number(balance).toFixed(4)} رصيد. / ` + |
| modules/inventory/storage-locations.service.ts:388 | BadRequest |  | bilingual | الموقعان متطابقان. / The source and destination locations are the same.', |
| modules/inventory/storage-locations.service.ts:394 | BadRequest |  | english | Quantity must be positive') |
| modules/inventory/storage-locations.service.ts:405 | NotFound | STORAGE_LOCATION_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:407 | BadRequest |  | bilingual | المواقعتين في مخزنين مختلفين؛ استخدم تحويل الدفعات. / ' + |
| modules/inventory/storage-locations.service.ts:413 | BadRequest |  | english | Both locations must be active') |
| modules/inventory/storage-locations.service.ts:416 | Forbidden |  | english | This location belongs to another branch') |
| modules/inventory/storage-locations.service.ts:419 | Forbidden |  | english | You cannot move stock in this warehouse') |
| modules/inventory/storage-locations.service.ts:422 | Forbidden |  | english | You do not have the transfer grant for this warehouse') |
| modules/inventory/storage-locations.service.ts:429 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:449 | BadRequest |  | bilingual | الموقع يحوي ${available.toFixed(MONEY_SCALE)} فقط. / ` + |
| modules/inventory/storage-locations.service.ts:547 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:675 | BadRequest |  | english | Quantity must be positive') |
| modules/inventory/storage-locations.service.ts:679 | NotFound | STORAGE_LOCATION_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:681 | BadRequest |  | bilingual | الموقع ليس في هذا المخزن. / The location is not in that warehouse.', |
| modules/inventory/storage-locations.service.ts:685 | BadRequest |  | english | The location must be active') |
| modules/inventory/storage-locations.service.ts:687 | Forbidden |  | english | This location belongs to another branch') |
| modules/inventory/storage-locations.service.ts:690 | Forbidden |  | english | You cannot move stock in this warehouse') |
| modules/inventory/storage-locations.service.ts:693 | Forbidden |  | english | You do not have the transfer grant for this warehouse') |
| modules/inventory/storage-locations.service.ts:699 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:706 | BadRequest |  | english | That lot is not in this warehouse for this item') |
| modules/inventory/storage-locations.service.ts:726 | BadRequest |  | bilingual | الكمية بدون موقع ${unlocated.toFixed(MONEY_SCALE)} فقط. / ` + |
| modules/inventory/storage-locations.service.ts:818 | BadRequest |  | english | Quantity must be positive') |
| modules/inventory/storage-locations.service.ts:820 | BadRequest |  | bilingual | اكتب سبب التصحيح (3 أحرف على الأقل). / Write the reason for this correction (at least 3 characters).', |
| modules/inventory/storage-locations.service.ts:828 | BadRequest |  | bilingual | The shelf is not in that warehouse. / الموقع ليس في هذا المخزن.') |
| modules/inventory/storage-locations.service.ts:831 | Forbidden |  | english | This location belongs to another branch') |
| modules/inventory/storage-locations.service.ts:834 | Forbidden |  | english | You cannot move stock in this warehouse') |
| modules/inventory/storage-locations.service.ts:837 | Forbidden |  | english | You do not have the transfer grant for this warehouse') |
| modules/inventory/storage-locations.service.ts:843 | NotFound | ITEM_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:865 | BadRequest |  | bilingual | لا يوجد عجز في الكمية بدون موقع لهذا الصنف، فلا حاجة للتصحيح. / ' + |
| modules/inventory/storage-locations.service.ts:871 | BadRequest |  | bilingual | أقصى كمية للتصحيح ${Prisma.Decimal.min(deficit, shelf).toFixed(MONEY_SCALE)} ` + |
| modules/inventory/storage-locations.service.ts:942 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| modules/inventory/storage-locations.service.ts:944 | Forbidden |  | english | This warehouse belongs to another branch') |
| modules/inventory/unit-input.ts:100 | BadRequest |  | bilingual | ${label}: "${text}" is not a number / ليست قيمة رقمية صحيحة`, |
| modules/inventory/unit-input.ts:105 | BadRequest |  | bilingual | ${label} cannot be negative / لا يمكن أن تكون سالبة`, |
| modules/inventory/unit-input.ts:130 | BadRequest |  | bilingual | units must be a list / يجب أن تكون الوحدات قائمة', |
| modules/inventory/unit-input.ts:142 | BadRequest |  | bilingual | Every unit row must be an object / كل سطر وحدة يجب أن يكون بيانات', |
| modules/inventory/unit-input.ts:151 | BadRequest |  | bilingual | Every unit needs a name / كل وحدة تحتاج اسمًا', |
| modules/inventory/unit-input.ts:156 | BadRequest |  | bilingual | Unit name "${unit}" is longer than ${UNIT_NAME_MAX} characters / اسم الوحدة أطول من المسموح`, |
| modules/inventory/unit-input.ts:162 | BadRequest |  | english | Unit "${unit}" is listed twice |
| modules/inventory/unit-input.ts:171 | BadRequest |  | bilingual | Unit "${label}" needs a conversion factor / الوحدة "${label}" تحتاج معامل تحويل`, |
| modules/inventory/unit-input.ts:179 | BadRequest |  | bilingual | Unit "${label}" has an invalid factor: "${factorText}" / معامل تحويل غير صالح`, |
| modules/inventory/unit-input.ts:184 | BadRequest |  | bilingual | Unit "${label}" factor must be greater than zero / معامل التحويل يجب أن يكون أكبر من صفر`, |
| modules/inventory/unit-input.ts:190 | BadRequest |  | bilingual | The base unit factor must be 1 / معامل الوحدة الأساسية يجب أن يكون 1`, |
| modules/inventory/warehouse-access.service.ts:73 | NotFound | USER_NOT_FOUND | coded |  |
| modules/inventory/warehouse-access.service.ts:153 | NotFound | USER_NOT_FOUND | coded |  |
| modules/inventory/warehouse-access.service.ts:158 | BadRequest |  | english | Every grant needs a warehouse.') |
| modules/inventory/warehouse-access.service.ts:163 | BadRequest |  | english | The same warehouse was listed twice.') |
| modules/inventory/warehouse-access.service.ts:176 | BadRequest |  | english | One of the warehouses is not available to you.') |
| modules/inventory/warehouse-access.service.ts:191 | Forbidden |  | bilingual | A branch-scoped manager cannot remove the last warehouse restriction. / لا يمكن لمسؤول الفرع إزالة آخر قيد للم |

## sales

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/sales/customer-credit.service.ts:50 | Conflict | CUSTOMER_CREDIT_LIMIT_EXCEEDED | coded |  |
| modules/sales/customer-credit.service.ts:55 | Conflict | CUSTOMER_CREDIT_LIMIT_EXCEEDED | coded |  |
| modules/sales/customer-credit.service.ts:95 | Conflict | CUSTOMER_PAYMENT_TERM_EXCEEDED | coded |  |
| modules/sales/customer-credit.service.ts:100 | Conflict | CUSTOMER_PAYMENT_TERM_EXCEEDED | coded |  |
| modules/sales/customer-credit.service.ts:113 | BadRequest |  | english | A written reason is required') |
| modules/sales/customer-credit.service.ts:119 | NotFound | DRAFT_SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/customer-credit.service.ts:120 | BadRequest |  | english | This invoice does not need payment-period approval') |
| modules/sales/customer-credit.service.ts:122 | Forbidden |  | bilingual | The person who created the invoice cannot approve its payment-period exception. / لا يجوز لمنشئ الفاتورة أن يو |
| modules/sales/customer-credit.service.ts:207 | BadRequest |  | english | A written reason is required') |
| modules/sales/customer-credit.service.ts:210 | NotFound | DRAFT_SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/customer-credit.service.ts:212 | BadRequest |  | english | This invoice does not need credit approval') |
| modules/sales/customer-credit.service.ts:217 | Forbidden |  | bilingual | The person who created the invoice cannot approve its credit exception. / لا يجوز لمنشئ الفاتورة أن يوافق على  |
| modules/sales/price-lists.service.ts:72 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:111 | Conflict |  | english | Price list code ${code} is already used`) |
| modules/sales/price-lists.service.ts:145 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:183 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:205 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:212 | BadRequest |  | english | The item does not exist in this company') |
| modules/sales/price-lists.service.ts:251 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:275 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:280 | BadRequest |  | english | kind must be CUSTOMER or SUPPLIER') |
| modules/sales/price-lists.service.ts:288 | BadRequest |  | english | The customer does not exist in this company') |
| modules/sales/price-lists.service.ts:297 | BadRequest |  | english | The supplier does not exist in this company') |
| modules/sales/price-lists.service.ts:388 | NotFound | PRICE_LIST_NOT_FOUND | coded |  |
| modules/sales/price-lists.service.ts:389 | BadRequest |  | english | Price list ${list.code} is inactive`) |
| modules/sales/price-lists.service.ts:391 | BadRequest |  | english | Price list ${list.code} expired`) |
| modules/sales/price-lists.service.ts:397 | BadRequest |  | english | ${field} is required`) |
| modules/sales/price-lists.service.ts:406 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/sales/price-lists.service.ts:408 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/sales/price-lists.service.ts:414 | BadRequest |  | english | ${field} cannot exceed 100`) |
| modules/sales/quotation-background-media.ts:111 | BadRequest |  | bilingual | الملف يجب أن يكون بين 1 بايت و4 ميجابايت') |
| modules/sales/quotation-background-media.ts:115 | BadRequest |  | bilingual | نوع الملف غير مدعوم. اختر ملف PDF أو صورة PNG أو JPG') |
| modules/sales/quotation-background-media.ts:126 | BadRequest |  | bilingual | تعذرت قراءة ملف الـPDF (قد يكون مشفرًا أو تالفًا)') |
| modules/sales/quotation-background-media.ts:128 | BadRequest |  | bilingual | ملف الـPDF لا يحتوي على صفحات') |
| modules/sales/quotation-background-media.ts:132 | BadRequest |  | bilingual | الملف فيه ${count} صفحة، والصفحة ${pageNumber} غير موجودة`) |
| modules/sales/quotation-background-media.ts:155 | BadRequest |  | bilingual | تعذر عرض صفحة الـPDF، جرّب حفظها من البرنامج الأصلي مرة أخرى أو استخدم صورة') |
| modules/sales/quotation-background-media.ts:182 | BadRequest |  | bilingual | تعذرت قراءة الصورة، استخدم ملف PNG أو JPG سليم') |
| modules/sales/quotation-background-media.ts:185 | BadRequest |  | bilingual | الصورة صغيرة جدًا لتكون خلفية، استخدم صورة بعرض 200 بكسل على الأقل') |
| modules/sales/quotation-backgrounds.controller.ts:37 | NotFound | BACKGROUND_NOT_FOUND | coded |  |
| modules/sales/quotation-backgrounds.service.ts:15 | BadRequest |  | english | The background PDF must be between 1 byte and 5 MB') |
| modules/sales/quotation-backgrounds.service.ts:18 | BadRequest |  | english | The background file is not a PDF') |
| modules/sales/quotation-backgrounds.service.ts:24 | BadRequest |  | english | The background PDF could not be read (it may be encrypted or damaged)') |
| modules/sales/quotation-backgrounds.service.ts:28 | BadRequest |  | english | The PDF has ${count} page(s) |
| modules/sales/quotation-backgrounds.service.ts:130 | NotFound | BACKGROUND_NOT_FOUND | coded |  |
| modules/sales/quotation-column-templates.service.ts:95 | NotFound | QUOTATION_COLUMN_TEMPLATE_NOT_FOUND | coded |  |
| modules/sales/quotation-column-templates.service.ts:147 | NotFound | QUOTATION_COLUMN_TEMPLATE_NOT_FOUND | coded |  |
| modules/sales/quotation-design-templates.service.ts:62 | NotFound | QUOTATION_DESIGN_TEMPLATE_NOT_FOUND | coded |  |
| modules/sales/quotation-design-templates.service.ts:92 | NotFound | QUOTATION_DESIGN_TEMPLATE_NOT_FOUND | coded |  |
| modules/sales/quotation-design-templates.service.ts:98 | BadRequest |  | english | Quotation design must be an object') |
| modules/sales/quotation-design-templates.service.ts:102 | BadRequest |  | english | Quotation design is too large') |
| modules/sales/quotation-terms.service.ts:98 | NotFound | QUOTATION_TERM_NOT_FOUND | coded |  |
| modules/sales/quotation-terms.service.ts:141 | NotFound | QUOTATION_TERM_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:137 | BadRequest |  | english | Unknown quotation status "${query.status}"`) |
| modules/sales/quotations.service.ts:197 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:210 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/quotations.service.ts:216 | BadRequest |  | english | The currency must be a three-letter code') |
| modules/sales/quotations.service.ts:325 | BadRequest |  | english | The currency must be a three-letter code') |
| modules/sales/quotations.service.ts:365 | BadRequest |  | english | Only a draft quotation can be edited') |
| modules/sales/quotations.service.ts:439 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:440 | BadRequest |  | english | Only a draft quotation can be issued') |
| modules/sales/quotations.service.ts:445 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:495 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:497 | BadRequest |  | english | A converted quotation can no longer change status') |
| modules/sales/quotations.service.ts:499 | BadRequest |  | english | This quotation is already ${existing.status.toLowerCase()}`) |
| modules/sales/quotations.service.ts:504 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:538 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/quotations.service.ts:544 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:546 | BadRequest |  | english | A draft is edited directly |
| modules/sales/quotations.service.ts:646 | BadRequest |  | english | Write what was discussed before saving the follow-up') |
| modules/sales/quotations.service.ts:651 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:673 | BadRequest |  | english | Only a draft quotation can be deleted') |
| modules/sales/quotations.service.ts:712 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/quotations.service.ts:719 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:721 | BadRequest |  | english | This quotation has already been converted to an invoice') |
| modules/sales/quotations.service.ts:724 | BadRequest |  | english | Only an accepted quotation can become an invoice |
| modules/sales/quotations.service.ts:729 | BadRequest |  | english | This quotation has no lines to convert') |
| modules/sales/quotations.service.ts:777 | BadRequest |  | english | This quotation has no lines to convert') |
| modules/sales/quotations.service.ts:788 | BadRequest |  | english | This quotation was converted by someone else a moment ago') |
| modules/sales/quotations.service.ts:809 | BadRequest |  | english | Invoice totals differ from the accepted quotation |
| modules/sales/quotations.service.ts:865 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:923 | NotFound | COMPANY_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:969 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/sales/quotations.service.ts:971 | BadRequest |  | english | This quotation has been issued and can no longer be edited. Start a revision instead.', |
| modules/sales/quotations.service.ts:993 | BadRequest |  | english | The customer does not exist') |
| modules/sales/quotations.service.ts:994 | BadRequest |  | english | The customer is inactive') |
| modules/sales/quotations.service.ts:1029 | BadRequest |  | english | Table ${tableIndex + 1}: give the table a title`) |
| modules/sales/quotations.service.ts:1037 | BadRequest |  | english | ${where}: the item does not exist`) |
| modules/sales/quotations.service.ts:1040 | BadRequest |  | english | ${where}: the item is inactive`) |
| modules/sales/quotations.service.ts:1048 | BadRequest |  | english | ${where}: give either an item or a description`) |
| modules/sales/quotations.service.ts:1074 | BadRequest |  | english |  |
| modules/sales/quotations.service.ts:1116 | BadRequest |  | english |  |
| modules/sales/quotations.service.ts:1320 | BadRequest |  | english | ${field} must be a date`) |
| modules/sales/quotations.service.ts:1323 | BadRequest |  | english | ${field} is not a valid date`) |
| modules/sales/quotations.service.ts:1333 | BadRequest |  | english | ${field} must be a number`) |
| modules/sales/quotations.service.ts:1339 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/sales/quotations.service.ts:1345 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/sales/quotations.service.ts:1392 | BadRequest |  | bilingual | ${where}: اسم العمود فارغ. أعطِ كل عمود اسمًا قبل الحفظ. / A column has no name. Name every column before savi |
| modules/sales/quotations.service.ts:1397 | BadRequest |  | bilingual | ${where}: اسم العمود أطول من ${COLUMN_KEY_MAX_LENGTH} حرفًا. اختصره ليصبح عنوانًا. / ` + |
| modules/sales/quotations.service.ts:1405 | BadRequest |  | bilingual | ${where}: اسم العمود يحتوي على محرف غير صالح. / A column name contains an invalid character.`, |
| modules/sales/quotations.service.ts:1410 | BadRequest |  | bilingual | ${where}: العمود "${key}" مكرر. لا يمكن تكرار العمود نفسه أو إعادة تعريف عمود مدمج. / The column "${key}" is l |
| modules/sales/quotations.service.ts:1426 | BadRequest |  | bilingual | ${where}: أبقِ عمودًا واحدًا ظاهرًا على الأقل. / Keep at least one column visible.`, |
| modules/sales/sales-invoices.controller.ts:109 | NotFound |  | english | Credit approval is not available') |
| modules/sales/sales-invoices.controller.ts:118 | NotFound |  | english | Approval is not available') |
| modules/sales/sales-invoices.service.ts:113 | BadRequest |  | bilingual | السطر ${lineNumber}: كمية الموقع غير صالحة. اكتب رقمًا أكبر من صفر. / ` + |
| modules/sales/sales-invoices.service.ts:119 | BadRequest |  | bilingual | السطر ${lineNumber}: كمية الموقع يجب أن تكون أكبر من صفر. احذف الموقع أو اكتب كمية. / ` + |
| modules/sales/sales-invoices.service.ts:125 | BadRequest |  | bilingual | السطر ${lineNumber}: نفس الموقع مكرر. اجمع الكميتين في صف واحد. / ` + |
| modules/sales/sales-invoices.service.ts:135 | BadRequest |  | bilingual | السطر ${lineNumber}: مجموع كميات المواقع ${sum.toFixed(4)} لا يساوي كمية السطر ${lineQuantity.toFixed(4)}. ` + |
| modules/sales/sales-invoices.service.ts:178 | BadRequest |  | english | Unknown status: ${query.status}`) |
| modules/sales/sales-invoices.service.ts:226 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:318 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-invoices.service.ts:325 | BadRequest |  | english | The customer does not exist') |
| modules/sales/sales-invoices.service.ts:326 | BadRequest |  | english | The customer is inactive') |
| modules/sales/sales-invoices.service.ts:429 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-invoices.service.ts:435 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:436 | BadRequest |  | english | Order-linked draft editing requires allocation reconciliation |
| modules/sales/sales-invoices.service.ts:438 | BadRequest |  | english | Return documents cannot be edited as sales invoices') |
| modules/sales/sales-invoices.service.ts:441 | BadRequest |  | english | Only a draft sales invoice can be edited') |
| modules/sales/sales-invoices.service.ts:444 | BadRequest |  | english | A draft can only be edited from its assigned branch') |
| modules/sales/sales-invoices.service.ts:451 | BadRequest |  | english | The customer does not exist') |
| modules/sales/sales-invoices.service.ts:452 | BadRequest |  | english | The customer is inactive') |
| modules/sales/sales-invoices.service.ts:476 | BadRequest |  | english | This invoice was posted or changed by someone else. Reload it before editing.', |
| modules/sales/sales-invoices.service.ts:481 | BadRequest |  | english | Order-linked draft editing requires allocation reconciliation |
| modules/sales/sales-invoices.service.ts:552 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-invoices.service.ts:556 | BadRequest |  | english | Invoice is not linked to an order') |
| modules/sales/sales-invoices.service.ts:559 | BadRequest |  | english | expectedUpdatedAt is required') |
| modules/sales/sales-invoices.service.ts:568 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:573 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:580 | BadRequest |  | english | Order allocation changed |
| modules/sales/sales-invoices.service.ts:590 | Conflict |  | english | The idempotency key was used for a different amendment') |
| modules/sales/sales-invoices.service.ts:591 | Conflict |  | english | The amended invoice is no longer a draft') |
| modules/sales/sales-invoices.service.ts:595 | BadRequest |  | english | Only an active draft invoice can be amended') |
| modules/sales/sales-invoices.service.ts:597 | Conflict |  | english | The invoice changed |
| modules/sales/sales-invoices.service.ts:598 | BadRequest |  | english | Related order cannot be amended') |
| modules/sales/sales-invoices.service.ts:600 | BadRequest |  | english | This invoice has additional charges or discounts |
| modules/sales/sales-invoices.service.ts:606 | BadRequest |  | english | Historical invoice lines require manual review') |
| modules/sales/sales-invoices.service.ts:614 | BadRequest |  | english | Historical order item changed |
| modules/sales/sales-invoices.service.ts:665 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-invoices.service.ts:671 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:673 | BadRequest |  | english | Only a draft invoice can be cancelled') |
| modules/sales/sales-invoices.service.ts:684 | BadRequest |  | english | Related order is missing |
| modules/sales/sales-invoices.service.ts:690 | BadRequest |  | english | Invoice was posted or cancelled concurrently') |
| modules/sales/sales-invoices.service.ts:698 | BadRequest |  | english | Invoice was posted or cancelled concurrently') |
| modules/sales/sales-invoices.service.ts:812 | BadRequest | SALES_SAVE_STOCK_SHORT | coded |  |
| modules/sales/sales-invoices.service.ts:874 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:876 | BadRequest |  | english | Only draft invoices can be posted (current status: ${invoice.status})`, |
| modules/sales/sales-invoices.service.ts:897 | BadRequest |  | english | This invoice was posted by someone else a moment ago. Reload it to see the current state.', |
| modules/sales/sales-invoices.service.ts:912 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:981 | BadRequest |  | english | An invoice line references a missing item') |
| modules/sales/sales-invoices.service.ts:1004 | BadRequest | SALES_POST_BRANCH_STOCK | coded |  |
| modules/sales/sales-invoices.service.ts:1018 | BadRequest |  | bilingual | الصنف ${item.code} يتطلب دفعة ولا يوجد مخزن للفرع. / ` + |
| modules/sales/sales-invoices.service.ts:1051 | BadRequest |  | bilingual | السطر ${line.lineNumber}: مجموع المواقع ${typed.toFixed(MONEY_SCALE)} لا يساوي الكمية ${enteredTotal.toFixed(M |
| modules/sales/sales-invoices.service.ts:1061 | BadRequest | SALES_POST_LOCATION_REQUIRED | coded |  |
| modules/sales/sales-invoices.service.ts:1079 | BadRequest |  | bilingual | السطر ${line.lineNumber}: حُدد موقع لكن الفرع بلا مخزن. احذف المواقع من السطر أو أضف مخزنًا للفرع. / ` + |
| modules/sales/sales-invoices.service.ts:1089 | BadRequest |  | bilingual | السطر ${line.lineNumber}: مجموع المواقع ${allocated.toFixed(MONEY_SCALE)} لا يساوي الكمية ${line.quantity.toFi |
| modules/sales/sales-invoices.service.ts:1145 | BadRequest |  | bilingual | السطر ${line.lineNumber} (${item.code}) من الموقع ${code?.code ?? entry.storageLocationId}: ${original} ` + |
| modules/sales/sales-invoices.service.ts:1270 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/sales/sales-invoices.service.ts:1272 | BadRequest |  | english | Only posted invoices can be reversed') |
| modules/sales/sales-invoices.service.ts:1275 | BadRequest |  | english | This invoice has no journal entry to reverse') |
| modules/sales/sales-invoices.service.ts:1287 | NotFound |  | english | The original journal entry is missing') |
| modules/sales/sales-invoices.service.ts:1289 | BadRequest |  | english | This invoice has already been reversed') |
| modules/sales/sales-invoices.service.ts:1301 | BadRequest |  | english | This invoice has already been reversed') |
| modules/sales/sales-invoices.service.ts:1313 | BadRequest |  | english | Reverse the posted sales returns before reversing their source invoice.', |
| modules/sales/sales-invoices.service.ts:1348 | BadRequest |  | english | A sales invoice item no longer exists') |
| modules/sales/sales-invoices.service.ts:1387 | BadRequest |  | bilingual | لا يمكن عكس فاتورة صنف يتطلب دفعة دون حركات دفعات مسجّلة. / ' + |
| modules/sales/sales-invoices.service.ts:1415 | BadRequest |  | bilingual | دفعة أصلية لم تعد موجودة؛ لا يمكن إعادة الكمية. / ' + |
| modules/sales/sales-invoices.service.ts:1555 | BadRequest |  | english | Order invoice unit snapshots do not match its lines') |
| modules/sales/sales-invoices.service.ts:1560 | BadRequest |  | english | Additional charges cannot be linked to an item or an order') |
| modules/sales/sales-invoices.service.ts:1563 | BadRequest |  | english | Line ${index + 1} quantity must be greater than zero`) |
| modules/sales/sales-invoices.service.ts:1567 | BadRequest |  | english | An additional charge must have quantity one and no line discount') |
| modules/sales/sales-invoices.service.ts:1601 | BadRequest |  | english | Line ${index + 1}: the item does not exist`) |
| modules/sales/sales-invoices.service.ts:1603 | BadRequest |  | english | Line ${index + 1}: the item is inactive`) |
| modules/sales/sales-invoices.service.ts:1631 | BadRequest |  | english | Line ${index + 1}: give either an item or a description`, |
| modules/sales/sales-invoices.service.ts:1660 | BadRequest |  | english | Line ${index + 1}: a price is required when the line names no item`, |
| modules/sales/sales-invoices.service.ts:1707 | BadRequest |  | english | Line ${index + 1}: the cost center does not exist`, |
| modules/sales/sales-invoices.service.ts:1712 | BadRequest |  | english | Line ${index + 1}: cost center ${center.code} is inactive`, |
| modules/sales/sales-invoices.service.ts:1759 | BadRequest |  | english |  |
| modules/sales/sales-invoices.service.ts:1780 | BadRequest |  | english |  |
| modules/sales/sales-invoices.service.ts:1816 | BadRequest |  | english |  |
| modules/sales/sales-invoices.service.ts:1841 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/sales/sales-invoices.service.ts:1848 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/sales/sales-invoices.service.ts:1855 | BadRequest |  | english | ${field} must be between 0 and 100`) |
| modules/sales/sales-invoices.service.ts:1870 | BadRequest |  | english | ${field} is not a valid number: ${value}`) |
| modules/sales/sales-orders.service.ts:89 | BadRequest |  | english | Unknown order status: ${query.status}`) |
| modules/sales/sales-orders.service.ts:138 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:183 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-orders.service.ts:194 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/sales/sales-orders.service.ts:204 | BadRequest |  | english | The customer does not exist in this company') |
| modules/sales/sales-orders.service.ts:205 | BadRequest |  | english | Customer ${customer.code} is inactive`) |
| modules/sales/sales-orders.service.ts:209 | BadRequest |  | english | An order needs at least one line') |
| modules/sales/sales-orders.service.ts:287 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-orders.service.ts:289 | BadRequest |  | english | idempotencyKey is required') |
| modules/sales/sales-orders.service.ts:296 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:304 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/sales/sales-orders.service.ts:311 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:314 | BadRequest |  | english |  |
| modules/sales/sales-orders.service.ts:317 | BadRequest |  | english | expectedUpdatedAt is required') |
| modules/sales/sales-orders.service.ts:320 | Conflict | ORDER_EDIT_STALE | coded |  |
| modules/sales/sales-orders.service.ts:329 | BadRequest |  | english | Order has invoice history |
| modules/sales/sales-orders.service.ts:353 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/sales/sales-orders.service.ts:377 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:382 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:384 | BadRequest |  | english | Only a draft order can be approved (it is ${order.status})`) |
| modules/sales/sales-orders.service.ts:387 | BadRequest |  | english | Segregation of duties is on: the person who raised this order may not approve it') |
| modules/sales/sales-orders.service.ts:393 | BadRequest |  | english | This order was approved by someone else a moment ago.') |
| modules/sales/sales-orders.service.ts:429 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:431 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:432 | BadRequest |  | english | This order is already cancelled') |
| modules/sales/sales-orders.service.ts:436 | BadRequest |  | english | This order has active invoices |
| modules/sales/sales-orders.service.ts:470 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/sales/sales-orders.service.ts:480 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:485 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/sales/sales-orders.service.ts:496 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/sales/sales-orders.service.ts:497 | Conflict |  | english | The invoice for this idempotency key is no longer active') |
| modules/sales/sales-orders.service.ts:501 | BadRequest |  | english | A cancelled order cannot be invoiced') |
| modules/sales/sales-orders.service.ts:502 | BadRequest |  | english | Approve the order before invoicing it') |
| modules/sales/sales-orders.service.ts:514 | BadRequest |  | english | Line ${line.lineNumber}: only ${outstanding.toFixed(MONEY_SCALE)} is still outstanding, ` + |
| modules/sales/sales-orders.service.ts:540 | BadRequest |  | english | This order is fully invoiced |
| modules/sales/sales-orders.service.ts:605 | BadRequest |  | english | Line ${index + 1}: the item does not exist`) |
| modules/sales/sales-orders.service.ts:606 | BadRequest |  | english | Line ${index + 1}: item ${item.code} is inactive`) |
| modules/sales/sales-orders.service.ts:609 | BadRequest |  | english | Line ${index + 1} quantity must be greater than zero`) |
| modules/sales/sales-orders.service.ts:710 | BadRequest |  | english | ${field} is not a date`) |
| modules/sales/sales-orders.service.ts:716 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/sales/sales-orders.service.ts:725 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/sales/sales-orders.service.ts:727 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/sales/sales-orders.service.ts:734 | BadRequest |  | english | ${field} cannot exceed 100`) |
| modules/sales/sales-orders.service.ts:740 | BadRequest |  | english | ${field} is required`) |

## accounting

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/accounting/account-map.service.ts:94 | BadRequest |  | english | Required account ${code} (${key}) does not exist in this company's chart of accounts`, |
| modules/accounting/account-map.service.ts:99 | BadRequest |  | english | Account ${code} cannot receive postings`) |
| modules/accounting/account-map.service.ts:102 | BadRequest |  | english | Account ${code} is inactive`) |
| modules/accounting/budgets.service.ts:117 | NotFound | BUDGET_NOT_FOUND | coded |  |
| modules/accounting/budgets.service.ts:132 | BadRequest |  | english | periodEnd must not be before periodStart') |
| modules/accounting/budgets.service.ts:183 | NotFound | BUDGET_NOT_FOUND | coded |  |
| modules/accounting/budgets.service.ts:185 | BadRequest |  | english | A retired budget cannot be edited') |
| modules/accounting/budgets.service.ts:228 | BadRequest |  | english | periodEnd must not be before periodStart') |
| modules/accounting/budgets.service.ts:269 | NotFound | BUDGET_NOT_FOUND | coded |  |
| modules/accounting/budgets.service.ts:316 | BadRequest |  | english | to must not be before from') |
| modules/accounting/budgets.service.ts:324 | BadRequest |  | english | type must be DEPARTMENT, ADMINISTRATIVE_UNIT or PROJECT', |
| modules/accounting/budgets.service.ts:498 | BadRequest |  | english | The company does not exist') |
| modules/accounting/budgets.service.ts:508 | BadRequest |  | english | costCenterId is required') |
| modules/accounting/budgets.service.ts:514 | BadRequest |  | english | costCenterId does not name a cost center of this company', |
| modules/accounting/budgets.service.ts:519 | BadRequest |  | english | Cost center ${center.code} is inactive and cannot receive a new budget`, |
| modules/accounting/budgets.service.ts:528 | BadRequest |  | english | accountId is required') |
| modules/accounting/budgets.service.ts:539 | BadRequest |  | english | accountId does not name an account of this company', |
| modules/accounting/budgets.service.ts:544 | BadRequest |  | english | Account ${account.code} is a heading account, not one that can be posted to`, |
| modules/accounting/budgets.service.ts:549 | BadRequest |  | english | Account ${account.code} is a ${account.type.toLowerCase()} account. ` + |
| modules/accounting/budgets.service.ts:580 | Conflict |  | english | A budget for this cost center, account and period already exists', |
| modules/accounting/budgets.service.ts:600 | BadRequest |  | english | amount is required') |
| modules/accounting/budgets.service.ts:602 | BadRequest |  | english | amount must be a positive number with at most four decimal places', |
| modules/accounting/budgets.service.ts:608 | BadRequest |  | english | amount cannot be negative') |
| modules/accounting/budgets.service.ts:616 | BadRequest |  | english | currency must be a three-letter code') |
| modules/accounting/budgets.service.ts:619 | BadRequest |  | english | A budget is kept in the company currency (${companyCurrency}) |
| modules/accounting/budgets.service.ts:630 | BadRequest |  | english | ${field} must be a date (YYYY-MM-DD)`) |
| modules/accounting/budgets.service.ts:634 | BadRequest |  | english | ${field} is not a real date`) |
| modules/accounting/budgets.service.ts:644 | BadRequest |  | english | notes cannot exceed 500 characters') |
| modules/accounting/chart-of-accounts.service.ts:117 | BadRequest |  | english | An 8-digit account is the last level and cannot have sub-accounts') |
| modules/accounting/chart-of-accounts.service.ts:120 | BadRequest |  | english |  |
| modules/accounting/chart-of-accounts.service.ts:154 | BadRequest |  | english |  |
| modules/accounting/chart-of-accounts.service.ts:181 | BadRequest |  | english | No free code left under this parent') |
| modules/accounting/chart-of-accounts.service.ts:191 | BadRequest |  | english | Provide an Arabic or English account name') |
| modules/accounting/chart-of-accounts.service.ts:239 | BadRequest |  | english | The expected parent requires a requested parent change') |
| modules/accounting/chart-of-accounts.service.ts:247 | BadRequest |  | english | Provide an Arabic or English account name') |
| modules/accounting/chart-of-accounts.service.ts:252 | Conflict |  | english | The account parent changed since it was loaded. Refresh and review it before saving.') |
| modules/accounting/chart-of-accounts.service.ts:255 | BadRequest |  | english | An account cannot be its own parent') |
| modules/accounting/chart-of-accounts.service.ts:265 | BadRequest |  | english | Deactivate active subaccounts before deactivating their parent') |
| modules/accounting/chart-of-accounts.service.ts:277 | BadRequest |  | english | This account has sub-accounts whose codes start with its code. Its code cannot be changed.') |
| modules/accounting/chart-of-accounts.service.ts:291 | BadRequest |  | english | This account already has journal movements. Its code cannot be changed — deactivate it and create a new accoun |
| modules/accounting/chart-of-accounts.service.ts:296 | BadRequest |  | english | This account has sub-accounts, so it is a grouping account and cannot receive postings. Remove the sub-account |
| modules/accounting/chart-of-accounts.service.ts:306 | BadRequest |  | english | An account or its subaccounts have journal movements |
| modules/accounting/chart-of-accounts.service.ts:345 | BadRequest |  | english | This account has journal movements and cannot be deleted. Deactivate it instead so the past stays readable.') |
| modules/accounting/chart-of-accounts.service.ts:346 | BadRequest |  | english | This account has sub-accounts. Move or delete them first, or deactivate this account.') |
| modules/accounting/chart-of-accounts.service.ts:371 | NotFound | ACCOUNT_NOT_FOUND | coded |  |
| modules/accounting/chart-of-accounts.service.ts:392 | Conflict |  | english | The code "${code}" is already used by another account in this company`, |
| modules/accounting/chart-of-accounts.service.ts:415 | BadRequest |  | english | The parent account does not exist in this company', |
| modules/accounting/chart-of-accounts.service.ts:420 | BadRequest |  | english | The parent account is inactive. Activate it before adding sub-accounts under it.', |
| modules/accounting/chart-of-accounts.service.ts:425 | BadRequest |  | english | A sub-account must have the same type as its parent ` + |
| modules/accounting/chart-of-accounts.service.ts:438 | BadRequest |  | english | This would make the account its own ancestor. Choose another parent.', |
| modules/accounting/chart-of-accounts.service.ts:443 | BadRequest |  | english | The proposed parent has a circular hierarchy and cannot be used') |
| modules/accounting/cost-centers.service.ts:51 | BadRequest |  | english | type must be one of ${[...TYPES].join(', ')}`, |
| modules/accounting/cost-centers.service.ts:129 | NotFound | COST_CENTER_NOT_FOUND | coded |  |
| modules/accounting/cost-centers.service.ts:160 | Conflict |  | english | Cost center code ${code} is already used`) |
| modules/accounting/cost-centers.service.ts:200 | NotFound | COST_CENTER_NOT_FOUND | coded |  |
| modules/accounting/cost-centers.service.ts:244 | NotFound | COST_CENTER_NOT_FOUND | coded |  |
| modules/accounting/cost-centers.service.ts:250 | BadRequest |  | english | This cost center has ${children} child centre(s). Move or deactivate them first.`, |
| modules/accounting/cost-centers.service.ts:257 | BadRequest |  | english | This cost center is used by ${used.journalLines} journal line(s) and ` + |
| modules/accounting/cost-centers.service.ts:296 | BadRequest |  | english | ${field} is required`) |
| modules/accounting/cost-centers.service.ts:312 | BadRequest |  | english | type must be one of ${[...TYPES].join(', ')}`, |
| modules/accounting/cost-centers.service.ts:328 | BadRequest |  | english | ${field} is not a valid date`) |
| modules/accounting/cost-centers.service.ts:340 | BadRequest |  | english | endDate cannot be before startDate') |
| modules/accounting/cost-centers.service.ts:358 | BadRequest |  | english | A cost center cannot be its own parent') |
| modules/accounting/cost-centers.service.ts:366 | BadRequest |  | english | The parent cost center does not exist') |
| modules/accounting/cost-centers.service.ts:369 | BadRequest |  | english | The parent cost center is inactive |
| modules/accounting/cost-centers.service.ts:382 | BadRequest |  | english | That parent is a descendant of this cost center, so the move would create a cycle', |
| modules/accounting/cost-centers.service.ts:387 | BadRequest |  | english | The existing cost center hierarchy already contains a cycle and must be repaired first', |
| modules/accounting/cost-centers.service.ts:393 | BadRequest |  | english | Cost centers can be nested at most ${MAX_DEPTH} levels deep`, |
| modules/accounting/cost-centers.service.ts:464 | BadRequest |  | english | Every allocation needs a cost center') |
| modules/accounting/cost-centers.service.ts:467 | BadRequest |  | english | The same cost center appears twice in one line |
| modules/accounting/cost-centers.service.ts:481 | BadRequest |  | english | An allocation amount is not a number') |
| modules/accounting/cost-centers.service.ts:484 | BadRequest |  | english | Allocation amounts carry at most ${MONEY_SCALE} decimal places`, |
| modules/accounting/cost-centers.service.ts:489 | BadRequest |  | english | Allocation amounts must be greater than zero') |
| modules/accounting/cost-centers.service.ts:496 | BadRequest |  | english |  |
| modules/accounting/cost-centers.service.ts:529 | BadRequest |  | english | One or more cost centers do not exist in this company', |
| modules/accounting/cost-centers.service.ts:536 | BadRequest |  | english | Cost center ${row.code} is inactive and cannot receive new postings`, |
| modules/accounting/cost-centers.service.ts:543 | BadRequest |  | english | Cost center ${row.code} is not valid on ${day}`, |
| modules/accounting/fiscal-periods.service.ts:73 | BadRequest |  | english | The end date must be after the start date') |
| modules/accounting/fiscal-periods.service.ts:78 | Conflict |  | english | A period with that code already exists') |
| modules/accounting/fiscal-periods.service.ts:97 | NotFound | FISCAL_PERIOD_NOT_FOUND | coded |  |
| modules/accounting/fiscal-periods.service.ts:99 | BadRequest |  | english | A closed period cannot be changed') |
| modules/accounting/fiscal-periods.service.ts:104 | BadRequest |  | english | The end date must be after the start date') |
| modules/accounting/fiscal-periods.service.ts:156 | BadRequest |  | english | The changed dates contain posted history |
| modules/accounting/fiscal-periods.service.ts:167 | BadRequest |  | english | That range overlaps period ${overlapping.code} (${this.day(overlapping.startDate)} to ${this.day(overlapping.e |
| modules/accounting/fiscal-periods.service.ts:179 | NotFound | FISCAL_PERIOD_NOT_FOUND | coded |  |
| modules/accounting/fiscal-periods.service.ts:181 | BadRequest |  | english | This period is already closed') |
| modules/accounting/fiscal-periods.service.ts:192 | BadRequest |  | english | This fiscal period overlaps another period |
| modules/accounting/fiscal-periods.service.ts:206 | BadRequest |  | english | ${drafts} draft document(s) fall inside this period. Post or delete them before closing.`) |
| modules/accounting/fiscal-periods.service.ts:234 | BadRequest |  | english | ${field} is not a valid date`) |
| modules/accounting/journal-entries.service.ts:97 | NotFound | JOURNAL_ENTRY_NOT_FOUND | coded |  |
| modules/accounting/journal-entries.service.ts:115 | BadRequest |  | english | The signed-in user is not assigned to a branch', |
| modules/accounting/journal-entries.service.ts:132 | BadRequest |  | english |  |
| modules/accounting/journal-entries.service.ts:150 | BadRequest |  | english | One or more accounts do not exist') |
| modules/accounting/journal-entries.service.ts:154 | BadRequest |  | english | Accounts cannot receive postings (grouping accounts): ${notPostable |
| modules/accounting/journal-entries.service.ts:162 | BadRequest |  | english | Accounts are inactive: ${inactive.map((a) => a.code).join(', ')}`, |
| modules/accounting/journal-entries.service.ts:177 | BadRequest |  | english | Manual entries cannot post directly to a control account (${control |
| modules/accounting/journal-entries.service.ts:261 | NotFound | JOURNAL_ENTRY_NOT_FOUND | coded |  |
| modules/accounting/journal-entries.service.ts:263 | BadRequest |  | english | Only a draft or an approved entry can be posted (current status: ${entry.status})`, |
| modules/accounting/journal-entries.service.ts:278 | BadRequest |  | english | Manual entries cannot post directly to a control account (${lineAccounts |
| modules/accounting/journal-entries.service.ts:292 | BadRequest |  | english | This company requires manual journal entries to be approved before posting. Submit the entry for approval firs |
| modules/accounting/journal-entries.service.ts:302 | BadRequest |  | english | Separation of duties is on: the person who approved this entry may not post it, and the person who wrote it ma |
| modules/accounting/journal-entries.service.ts:307 | BadRequest |  | english | Separation of duties is on: the person who created this entry may not post it.', |
| modules/accounting/journal-entries.service.ts:314 | BadRequest |  | english | Journal entry is not balanced') |
| modules/accounting/journal-entries.service.ts:326 | BadRequest |  | english | Period ${period.code} is closed, so nothing can be posted on ${entry.entryDate |
| modules/accounting/journal-entries.service.ts:367 | BadRequest |  | english | Separation of duties is on: an entry cannot be approved by the person who created it.', |
| modules/accounting/journal-entries.service.ts:478 | Conflict |  | bilingual | تغيرت حالة القيد بواسطة عملية أخرى. حدّث البيانات قبل المحاولة مجددًا. / Journal status changed |
| modules/accounting/journal-entries.service.ts:511 | BadRequest |  | english | A journal needs at least two lines') |
| modules/accounting/journal-entries.service.ts:518 | BadRequest |  | english | Every journal line needs one positive debit or credit') |
| modules/accounting/journal-entries.service.ts:524 | BadRequest |  | english | Journal lines do not balance or do not match the entry totals') |
| modules/accounting/journal-entries.service.ts:540 | BadRequest |  | english | One or more journal accounts are unavailable or cannot receive postings') |
| modules/accounting/journal-entries.service.ts:543 | BadRequest |  | english | Manual entries cannot post directly to a control account') |
| modules/accounting/journal-entries.service.ts:568 | NotFound | JOURNAL_ENTRY_NOT_FOUND | coded |  |
| modules/accounting/journal-entries.service.ts:570 | BadRequest |  | english | This action is not allowed while the entry is ${entry.status}. Allowed from: ${allowed.join(', ')}.`, |
| modules/accounting/journal-entries.service.ts:601 | NotFound | JOURNAL_ENTRY_NOT_FOUND | coded |  |
| modules/accounting/journal-entries.service.ts:603 | BadRequest |  | english | Only posted entries can be reversed') |
| modules/accounting/journal-entries.service.ts:611 | BadRequest |  | english | This entry has already been reversed') |
| modules/accounting/journal-entries.service.ts:624 | BadRequest |  | english | Period ${period.code} is closed, so the reversal cannot be dated ${reversalDate |
| modules/accounting/journal-entries.service.ts:664 | BadRequest |  | english | This entry has already been reversed') |
| modules/accounting/journal-entries.service.ts:724 | BadRequest |  | english | Invalid amount on account ${line.accountId}`, |
| modules/accounting/journal-entries.service.ts:730 | BadRequest |  | english | Amounts cannot be negative') |
| modules/accounting/journal-entries.service.ts:733 | BadRequest |  | english | Every line needs either a debit or a credit', |
| modules/accounting/journal-entries.service.ts:738 | BadRequest |  | english | A line cannot be both a debit and a credit', |
| modules/accounting/journal-entries.service.ts:746 | BadRequest |  | english | A journal line cannot name one cost center and also be split between several', |
| modules/accounting/opening-balances.controller.ts:47 | Forbidden |  | english | You cannot change opening balances for another branch') |
| modules/accounting/opening-balances.controller.ts:50 | BadRequest |  | english | Opening balance currency must be a currency code') |
| modules/accounting/opening-balances.controller.ts:53 | Forbidden |  | english | Stock opening balances require inventory cost permission') |
| modules/accounting/opening-balances.service.ts:112 | NotFound | OPENING_BALANCE_DOCUMENT_NOT_FOUND | coded |  |
| modules/accounting/opening-balances.service.ts:153 | BadRequest |  | english | The import fingerprint must be a SHA-256 hex digest') |
| modules/accounting/opening-balances.service.ts:157 | BadRequest |  | english | Select the branch these opening figures belong to') |
| modules/accounting/opening-balances.service.ts:162 | BadRequest |  | english | An opening balance needs between ${minimum} and 1,000 lines`) |
| modules/accounting/opening-balances.service.ts:171 | BadRequest |  | english | The branch does not exist in this company') |
| modules/accounting/opening-balances.service.ts:185 | BadRequest |  | english | Opening balances must use the company currency') |
| modules/accounting/opening-balances.service.ts:234 | BadRequest |  | english | Opening balance totals are outside the supported range') |
| modules/accounting/opening-balances.service.ts:237 | BadRequest |  | english |  |
| modules/accounting/opening-balances.service.ts:269 | NotFound | OPENING_BALANCE_DOCUMENT_NOT_FOUND | coded |  |
| modules/accounting/opening-balances.service.ts:273 | Forbidden |  | english | Stock opening balances require inventory cost permission') |
| modules/accounting/opening-balances.service.ts:276 | BadRequest |  | english | A saved opening balance cannot change branches') |
| modules/accounting/opening-balances.service.ts:283 | BadRequest |  | english | This opening balance changed or is no longer a draft') |
| modules/accounting/opening-balances.service.ts:332 | BadRequest |  | english | Select a branch before deleting a draft') |
| modules/accounting/opening-balances.service.ts:342 | BadRequest |  | english | Only an existing draft opening balance can be deleted') |
| modules/accounting/opening-balances.service.ts:356 | BadRequest |  | english | Select a branch first') |
| modules/accounting/opening-balances.service.ts:361 | NotFound | OPENING_BALANCE_DOCUMENT_NOT_FOUND | coded |  |
| modules/accounting/opening-balances.service.ts:363 | Forbidden |  | english | Stock opening balances require inventory cost permission') |
| modules/accounting/opening-balances.service.ts:366 | BadRequest |  | english | Only a draft opening balance can be posted (current status: ${document.status})`, |
| modules/accounting/opening-balances.service.ts:382 | BadRequest |  | english | This branch already has an opening balance (${alreadyPosted.documentNumber}, ${alreadyPosted.asOfDate |
| modules/accounting/opening-balances.service.ts:424 | BadRequest |  | english | This opening balance changed. Refresh the document before posting.', |
| modules/accounting/opening-balances.service.ts:440 | BadRequest |  | english | This branch already has a posted opening balance (${alreadyPostedInTransaction.documentNumber}).`, |
| modules/accounting/opening-balances.service.ts:466 | BadRequest |  | english | An opening line references a missing item') |
| modules/accounting/opening-balances.service.ts:470 | BadRequest |  | english | Item line ${line.lineNumber} needs both a quantity and a unit cost`, |
| modules/accounting/opening-balances.service.ts:475 | BadRequest |  | english | Item line ${line.lineNumber}: quantity x unit cost (${line.quantity |
| modules/accounting/opening-balances.service.ts:496 | BadRequest |  | english | Item ${item.code} already has opening stock recorded when it was created. ` + |
| modules/accounting/opening-balances.service.ts:586 | BadRequest |  | english | Select a branch first') |
| modules/accounting/opening-balances.service.ts:591 | NotFound | OPENING_BALANCE_DOCUMENT_NOT_FOUND | coded |  |
| modules/accounting/opening-balances.service.ts:593 | Forbidden |  | english | Stock opening balances require inventory cost permission') |
| modules/accounting/opening-balances.service.ts:596 | BadRequest |  | english | Only a posted opening balance can be reversed') |
| modules/accounting/opening-balances.service.ts:628 | BadRequest | OPENING_REVERSE_ORIGIN_UNKNOWN | coded |  |
| modules/accounting/opening-balances.service.ts:657 | BadRequest |  | english | This opening balance was already reversed or changed. Refresh the document.') |
| modules/accounting/opening-balances.service.ts:684 | BadRequest |  | english | Cannot reverse opening balance: ${onHand.toFixed(MONEY_SCALE)} units and ` + |
| modules/accounting/opening-balances.service.ts:701 | BadRequest | OPENING_REVERSE_SHELF_SHORT | coded |  |
| modules/accounting/opening-balances.service.ts:784 | BadRequest |  | english | Line ${index + 1}: choose a ledger account`) |
| modules/accounting/opening-balances.service.ts:787 | BadRequest |  | english | Line ${index + 1}: choose a single customer, supplier or stock item`) |
| modules/accounting/opening-balances.service.ts:792 | BadRequest |  | english | Line ${index + 1} needs either a debit or a credit`) |
| modules/accounting/opening-balances.service.ts:795 | BadRequest |  | english | Line ${index + 1} cannot be both a debit and a credit`) |
| modules/accounting/opening-balances.service.ts:802 | BadRequest |  | english | Line ${index + 1}: the account does not exist`) |
| modules/accounting/opening-balances.service.ts:804 | BadRequest |  | english | Line ${index + 1}: account ${account.code} is a grouping account and cannot carry a balance`, |
| modules/accounting/opening-balances.service.ts:809 | BadRequest |  | english | Line ${index + 1}: account ${account.code} is inactive`) |
| modules/accounting/opening-balances.service.ts:813 | BadRequest |  | english | Line ${index + 1}: account ${account.code} uses ${account.currency}, expected ${currency}`) |
| modules/accounting/opening-balances.service.ts:819 | BadRequest |  | english | Line ${index + 1}: use the designated ${key} account`) |
| modules/accounting/opening-balances.service.ts:828 | BadRequest | OPENING_LOCATION_WITHOUT_ITEM | coded |  |
| modules/accounting/opening-balances.service.ts:839 | BadRequest | OPENING_LOCATION_NOT_FOUND | coded |  |
| modules/accounting/opening-balances.service.ts:842 | BadRequest | OPENING_LOCATION_INACTIVE | coded |  |
| modules/accounting/opening-balances.service.ts:851 | BadRequest |  | english | Line ${index + 1}: the item does not exist`) |
| modules/accounting/opening-balances.service.ts:856 | BadRequest |  | english | Line ${index + 1}: stock item ${item.id} is repeated from line ${previousLine} |
| modules/accounting/opening-balances.service.ts:864 | BadRequest |  | english | Line ${index + 1}: a stock item needs a quantity greater than zero`) |
| modules/accounting/opening-balances.service.ts:868 | BadRequest |  | english | Line ${index + 1}: quantity x unit cost (${stockValue.toFixed(MONEY_SCALE)}) ` + |
| modules/accounting/opening-balances.service.ts:875 | BadRequest |  | english | Line ${index + 1}: opening stock must be posted to the inventory account.`, |
| modules/accounting/opening-balances.service.ts:883 | BadRequest |  | english | Line ${index + 1}: non-stock items cannot carry an opening stock quantity or cost.`, |
| modules/accounting/opening-balances.service.ts:894 | BadRequest |  | english | Line ${index + 1}: the customer does not exist`) |
| modules/accounting/opening-balances.service.ts:901 | BadRequest |  | english | Line ${index + 1}: the supplier does not exist`) |
| modules/accounting/opening-balances.service.ts:931 | BadRequest | OPENING_LOT_CONTROLLED_ITEM | coded |  |
| modules/accounting/opening-balances.service.ts:961 | BadRequest | OPENING_LOCATION_INACTIVE | coded |  |
| modules/accounting/opening-balances.service.ts:964 | BadRequest | OPENING_LOCATION_WRONG_WAREHOUSE | coded |  |
| modules/accounting/opening-balances.service.ts:974 | BadRequest |  | english | ${field} is outside the supported range`) |
| modules/accounting/opening-balances.service.ts:976 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/accounting/opening-balances.service.ts:980 | BadRequest |  | english | ${field} is not a valid amount`) |
| modules/accounting/opening-balances.service.ts:987 | BadRequest |  | english | asOfDate is not a valid date') |
| modules/accounting/posting.service.ts:92 | BadRequest |  | english | A journal line cannot name one cost center and also be split between several', |
| modules/accounting/posting.service.ts:125 | BadRequest |  | english | A posting needs at least one debit and one credit', |
| modules/accounting/posting.service.ts:140 | BadRequest |  | english |  |
| modules/accounting/posting.service.ts:169 | BadRequest |  | english | Document ${request.sourceNumber} has already been posted as journal entry ${alreadyPosted.entryNumber}`, |
| modules/accounting/posting.service.ts:192 | BadRequest |  | english | One or more accounts do not exist') |
| modules/accounting/posting.service.ts:196 | BadRequest |  | english | Accounts cannot receive postings: ${invalid.map((a) => a.code).join(', ')}`, |
| modules/accounting/posting.service.ts:217 | BadRequest |  | english | Period ${period.code} is closed, so nothing can be posted on ${entryDate |
| modules/accounting/posting.service.ts:311 | BadRequest |  | english | The journal entry to reverse was not found') |
| modules/accounting/posting.service.ts:314 | BadRequest |  | english | This journal entry has already been reversed') |
| modules/accounting/posting.service.ts:317 | BadRequest |  | english | Only a posted journal entry can be reversed') |
| modules/accounting/posting.service.ts:348 | BadRequest |  | english | This journal entry has already been reversed') |
| modules/accounting/posting.service.ts:357 | BadRequest |  | english | Period ${reversalPeriod.code} is closed, so the reversal cannot be dated ${entryDate |
| modules/accounting/posting.service.ts:626 | BadRequest | CASH_BALANCE_NEGATIVE | coded |  |
| modules/accounting/posting.service.ts:640 | BadRequest | CASH_BALANCE_NEGATIVE | coded |  |
| modules/accounting/posting.service.ts:658 | BadRequest |  | english | Posting amounts cannot be negative') |
| modules/accounting/posting.service.ts:662 | BadRequest |  | english | Invalid posting amount: ${String(value)}`) |
| modules/accounting/year-end-close.service.ts:85 | BadRequest |  | english | This period is already closed') |
| modules/accounting/year-end-close.service.ts:96 | BadRequest |  | english | This fiscal period overlaps another period |
| modules/accounting/year-end-close.service.ts:100 | BadRequest |  | english |  |
| modules/accounting/year-end-close.service.ts:139 | BadRequest |  | english | This company has no active branch to post the closing entry to') |
| modules/accounting/year-end-close.service.ts:200 | NotFound | FISCAL_PERIOD_NOT_FOUND | coded |  |

## common

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| common/settings/company-settings.module.ts:111 | BadRequest |  | english | Unsupported valuation method "${dto.inventoryValuation}". This installation supports: ${VALUATION_METHODS.join |
| common/settings/company-settings.module.ts:122 | BadRequest |  | english | The valuation method cannot be changed while there is stock on hand: ' + |
| common/image/normalize-picture.ts:58 | BadRequest |  | bilingual | ${labels.subjectAr} يجب أن يكون صورة PNG أو JPEG أو WebP / ${labels.subjectEn} must be PNG, JPEG or WebP.`, |
| common/image/normalize-picture.ts:63 | BadRequest |  | bilingual | ملف ${labels.subjectAr} فارغ / The ${stripArticle(labels.subjectEn)} file is empty.`, |
| common/image/normalize-picture.ts:68 | BadRequest |  | bilingual | حجم ${labels.subjectAr} يتجاوز ${Math.round(maxBytes / 1024 / 1024)} ميجابايت / The ${stripArticle(labels.subj |
| common/image/normalize-picture.ts:82 | BadRequest |  | bilingual | تعذّر فتح الصورة. اختر ملف PNG أو JPEG أو WebP سليمًا / The ${stripArticle(labels.subjectEn)} could not be dec |
| common/image/normalize-picture.ts:90 | BadRequest |  | bilingual | يجب أن تكون أبعاد ${labels.subjectAr} ٣٢ × ٣٢ بكسل على الأقل، وألا تتجاوز الصورة المتحركة الحد المسموح / Use a |
| common/image/normalize-picture.ts:113 | BadRequest |  | bilingual | تعذّر ضغط الصورة. اختر صورة صالحة وحاول مرة أخرى / The ${stripArticle(labels.subjectEn)} could not be resized. |
| common/image/normalize-picture.ts:119 | BadRequest |  | bilingual | تعذّر ضغط الصورة إلى الحجم المسموح. اختر صورة أصغر / The ${stripArticle(labels.subjectEn)} remains too large a |
| common/units/order-amendment-allocation.ts:12 | BadRequest |  | english | Invoice allocation missing |
| common/units/order-amendment-allocation.ts:15 | BadRequest |  | english | Invoice allocation is invalid |
| common/units/order-amendment-allocation.ts:22 | BadRequest |  | english | Order allocations are inconsistent |
| common/units/order-conversion-identity.ts:12 | BadRequest |  | english | idempotencyKey is required (16–128 safe characters)') |
| common/units/order-conversion-identity.ts:15 | BadRequest |  | english | invoiceDate must be a date string') |
| common/units/order-conversion-selection.ts:11 | BadRequest |  | english | Select the order lines and quantities to invoice') |
| common/units/order-conversion-selection.ts:17 | BadRequest |  | english | Invalid order line selection') |
| common/units/order-conversion-selection.ts:22 | BadRequest |  | english | Selected order line does not belong to this order') |
| common/units/order-conversion-selection.ts:25 | BadRequest |  | english | An order line was selected more than once') |
| common/units/order-conversion-selection.ts:29 | BadRequest |  | english | quantity must be greater than zero') |
| common/units/order-conversion-unit.ts:19 | BadRequest |  | english | ${input.label}: quantity must be greater than zero`) |
| common/units/order-conversion-unit.ts:23 | BadRequest |  | english | ${input.label}: incomplete historical unit snapshot`) |
| common/units/order-conversion-unit.ts:27 | BadRequest |  | english | ${input.label}: incomplete historical unit snapshot`) |
| common/units/order-conversion-unit.ts:33 | BadRequest |  | english | ${input.label}: quantity cannot be represented at historical unit precision`) |
| common/units/order-conversion-unit.ts:37 | BadRequest |  | english | ${input.label}: quantity cannot be represented at historical unit precision`) |
| common/units/order-conversion-unit.ts:54 | BadRequest |  | english | Order invoice unit snapshot does not match the invoice line') |
| common/units/order-creation-identity.ts:10 | BadRequest |  | english | idempotencyKey must contain 16–128 safe characters') |
| common/units/order-draft-edit.ts:31 | BadRequest |  | english | Every existing order line must be supplied exactly once') |
| common/units/order-draft-edit.ts:35 | BadRequest |  | english | Invalid order line') |
| common/units/order-draft-edit.ts:38 | BadRequest |  | english | Invalid or duplicate order line') |
| common/units/order-draft-edit.ts:44 | BadRequest |  | english | ${label} is not a valid number`) |
| common/units/order-draft-edit.ts:47 | BadRequest |  | english | ${label} is outside the supported range or precision`) |
| common/units/order-draft-edit.ts:55 | BadRequest |  | english | ${label} exceeds the supported money range`) |
| common/units/order-draft-edit.ts:63 | BadRequest |  | english | Selected line does not belong to this order') |
| common/units/order-draft-edit.ts:65 | BadRequest |  | english | Order allocations are inconsistent |
| common/units/order-draft-edit.ts:67 | BadRequest |  | english | Allocated order lines cannot be edited as a draft') |
| common/units/order-draft-edit.ts:69 | BadRequest |  | english | Quantity must be greater than zero') |
| common/units/order-draft-edit.ts:73 | BadRequest |  | english | Incomplete historical unit snapshot') |
| common/units/order-draft-edit.ts:75 | BadRequest |  | english | Incomplete historical unit snapshot') |
| common/units/order-draft-edit.ts:78 | BadRequest |  | english | Inconsistent historical unit snapshot') |
| common/units/order-draft-edit.ts:84 | BadRequest |  | english | Quantity cannot be less than the allocated quantity') |
| common/units/order-draft-edit.ts:95 | BadRequest |  | english | Financial terms of allocated lines cannot be changed') |
| common/units/order-invoice-reconciliation.ts:18 | BadRequest |  | english | Related order is missing |
| common/units/order-invoice-reconciliation.ts:19 | BadRequest |  | english | Order invoice has no allocations |
| common/units/order-invoice-reconciliation.ts:23 | BadRequest |  | english | Historical order invoice lacks trustworthy allocations |
| common/units/order-invoice-reconciliation.ts:31 | BadRequest |  | english | Related order cannot be reconciled') |
| common/units/order-invoice-reconciliation.ts:38 | BadRequest |  | english | Order allocation is inconsistent |
| common/units/order-reallocation.ts:13 | BadRequest |  | english | Order invoice has no allocations |
| common/units/order-reallocation.ts:19 | BadRequest |  | english | Historical order invoice lacks trustworthy allocations |
| common/units/order-reallocation.ts:30 | BadRequest |  | english | Order allocation is inconsistent |
| common/units/order-reallocation.ts:34 | BadRequest |  | english | Order line ${line.id}: requested quantity exceeds remaining amount`) |
| common/units/unit-math.ts:73 | BadRequest |  | english | ${field} is not a valid number`) |
| common/units/unit-math.ts:76 | BadRequest |  | english | ${field} must be greater than zero and fit Decimal(19,6)`) |
| common/units/unit-math.ts:84 | BadRequest |  | english | ${field} supports at most ${FACTOR_SCALE} decimal places`) |
| common/units/unit-math.ts:106 | BadRequest |  | english | ${field} is not a valid number`) |
| common/units/unit-math.ts:108 | BadRequest |  | english | ${field} must be finite and have at most ${QUANTITY_SCALE} decimal places`) |
| common/units/unit-math.ts:120 | BadRequest |  | english | Quantity or factor exceeds the supported storage range') |
| common/units/unit-math.ts:125 | BadRequest |  | english | Converted quantity cannot be represented at ${QUANTITY_SCALE} decimal places`) |
| common/units/unit-math.ts:179 | BadRequest |  | english | ${lineLabel}: the selected unit does not belong to this item`) |
| common/units/unit-math.ts:200 | BadRequest |  | english | ${lineLabel}: unit "${requestedName}" is not defined for this item`, |
| common/units/unit-math.ts:207 | BadRequest |  | english | ${lineLabel}: unit "${row.unit}" is inactive and cannot be used on a new document`, |
| common/units/unit-math.ts:216 | BadRequest |  | english | ${lineLabel}: ${problem}`) |
| common/units/unit-math.ts:222 | BadRequest |  | english | ${lineLabel}: the converted quantity is zero |
| common/approvals/approvals.service.ts:123 | NotFound | APPROVAL_POLICY_NOT_FOUND | coded |  |
| common/approvals/approvals.service.ts:168 | NotFound | APPROVAL_POLICY_NOT_FOUND | coded |  |
| common/approvals/approvals.service.ts:186 | BadRequest |  | english | Operation must be one of ${APPROVAL_OPERATIONS.join(', ')}`, |
| common/approvals/approvals.service.ts:192 | BadRequest |  | english | A policy name is required in both languages') |
| common/approvals/approvals.service.ts:193 | BadRequest |  | english | A policy name may be at most 120 characters') |
| common/approvals/approvals.service.ts:196 | BadRequest |  | english | Priority must be a whole number between 0 and 100000') |
| common/approvals/approvals.service.ts:199 | BadRequest |  | english | A policy may have at most 10 levels') |
| common/approvals/approvals.service.ts:204 | BadRequest |  | english | Levels must be numbered 1 to 10') |
| common/approvals/approvals.service.ts:206 | BadRequest |  | english | Level ${number} is repeated`) |
| common/approvals/approvals.service.ts:209 | BadRequest |  | english | Level ${number} needs a permission`) |
| common/approvals/approvals.service.ts:210 | BadRequest |  | english | Level ${number}: permission code is too long`) |
| common/approvals/approvals.service.ts:234 | BadRequest |  | english | ${label} must be numeric`) |
| common/approvals/approvals.service.ts:236 | BadRequest |  | english | ${label} must not be negative`) |
| common/approvals/approvals.service.ts:329 | Conflict |  | english |  |
| common/approvals/approvals.service.ts:410 | BadRequest |  | english | Decision must be APPROVE, REJECT or RETURN') |
| common/approvals/approvals.service.ts:414 | BadRequest |  | english | A rejection or return needs a reason') |
| common/approvals/approvals.service.ts:416 | BadRequest |  | english | A reason may be at most 2000 characters') |
| common/approvals/approvals.service.ts:418 | Conflict |  | english | This document does not use a configured approval chain') |
| common/approvals/approvals.service.ts:434 | Conflict |  | english | Idempotency key was reused for a different approval decision') |
| common/approvals/approvals.service.ts:447 | Conflict |  | english | This approval chain has already been decided') |
| common/approvals/approvals.service.ts:448 | Conflict |  | english | This approval chain is already complete') |
| common/approvals/approvals.service.ts:450 | Conflict |  | english | There is no level awaiting a decision') |
| common/approvals/approvals.service.ts:452 | Conflict |  | english | Level ${params.expectedLevel} is no longer the pending level |
| common/approvals/approvals.service.ts:455 | Conflict |  | english | The pending level is missing from the policy') |
| common/approvals/approvals.service.ts:462 | Forbidden |  | english |  |
| common/approvals/approvals.service.ts:502 | Conflict |  | english | Idempotency key was reused for a different approval decision') |
| common/approvals/approvals.service.ts:505 | Conflict |  | english | This level was approved by somebody else a moment ago |
| common/approvals/approvals.service.ts:544 | NotFound | APPROVAL_HISTORY_NOT_FOUND | coded |  |
| common/print/print-settings.service.ts:79 | BadRequest |  | bilingual | لا توجد إعدادات للحفظ. / There are no settings to save.', |
| common/print/print-settings.service.ts:84 | BadRequest |  | english | Too many print settings in one request') |
| common/print/print-settings.service.ts:90 | BadRequest |  | bilingual | نوع طباعة غير معروف: ${type} / Unknown print type: ${type}`, |
| common/print/print-settings.service.ts:95 | BadRequest |  | english | Duplicate print type: ${type}`) |
| common/print/print-settings.service.ts:99 | BadRequest |  | bilingual | إعداد غير صالح للنوع ${type}: يجب أن تكون القيم true أو false. / ` + |
| common/warehouse/stock-ledger.service.ts:209 | BadRequest |  | bilingual | Not enough stock in this branch: ${current.quantity.toFixed(MONEY_SCALE)} available, ` + |
| common/warehouse/stock-ledger.service.ts:262 | BadRequest |  | english | Not enough stock in the selected warehouse: ${before.quantity.toFixed(MONEY_SCALE)} available, ` + |
| common/warehouse/stock-ledger.service.ts:349 | BadRequest |  | english | A rebuild needs a warehouse.') |
| common/warehouse/warehouse-access.ts:87 | Forbidden |  | bilingual | You do not have permission to ' + |
| common/warehouse/warehouse.service.ts:96 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| common/warehouse/warehouse.service.ts:104 | Forbidden |  | bilingual | هذا المخزن يخص فرعًا غير مسند إليك. / This warehouse belongs to a branch you are not assigned to.', |
| common/warehouse/warehouse.service.ts:119 | BadRequest |  | english | Provide an Arabic or English warehouse name') |
| common/warehouse/warehouse.service.ts:130 | Conflict |  | english | Warehouse code ${code} is already used`) |
| common/warehouse/warehouse.service.ts:184 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| common/warehouse/warehouse.service.ts:197 | BadRequest |  | english | Provide an Arabic or English warehouse name') |
| common/warehouse/warehouse.service.ts:211 | BadRequest |  | english | A branch must keep a default warehouse |
| common/warehouse/warehouse.service.ts:216 | BadRequest |  | english | The default warehouse of a branch cannot be deactivated |
| common/warehouse/warehouse.service.ts:260 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| common/warehouse/warehouse.service.ts:263 | BadRequest |  | english | The default warehouse of a branch cannot be deactivated |
| common/warehouse/warehouse.service.ts:295 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| common/warehouse/warehouse.service.ts:535 | BadRequest |  | english | The warehouse does not exist in this company') |
| common/warehouse/warehouse.service.ts:537 | BadRequest |  | english | Warehouse ${named.code} belongs to another branch |
| common/warehouse/warehouse.service.ts:542 | BadRequest |  | english | Warehouse ${named.code} is inactive`) |
| common/warehouse/warehouse.service.ts:596 | BadRequest |  | english | The warehouse recorded on the original document is no longer available in this company and branch.', |
| common/warehouse/warehouse.service.ts:674 | BadRequest |  | english | Not enough stock in the selected warehouse: ${available.toFixed(MONEY_SCALE)} available, ` + |
| common/warehouse/warehouse.service.ts:698 | NotFound | WAREHOUSE_NOT_FOUND | coded |  |
| common/warehouse/warehouse.service.ts:752 | BadRequest |  | english | The branch does not exist in this company') |
| common/warehouse/warehouse.service.ts:758 | BadRequest |  | english | ${field} is required`) |
| common/warehouse/warehouse.service.ts:814 | Forbidden |  | bilingual | This branch is outside your assignment. / هذا الفرع خارج نطاق صلاحيتك.', |
| common/warehouse/warehouse.service.ts:822 | Forbidden |  | bilingual | No branch is assigned to this account. / لا يوجد فرع مسند لهذا الحساب.', |
| common/warehouse/warehouse.service.ts:831 | BadRequest |  | bilingual | Select one of your assigned branches. / اختر أحد الفروع المسندة إليك.', |
| common/auth/branch-report-scope.guard.ts:49 | NotFound | REPORT_NOT_FOUND | coded |  |
| common/auth/branch-report-scope.guard.ts:58 | Forbidden |  | english | Choose one of your assigned branches to view this report.') |
| common/guards/audited-super-admin.guard.ts:19 | Forbidden |  | english | Only the program administrator can do this.') |
| common/guards/audited-super-admin.guard.ts:36 | Forbidden |  | english | Only the program administrator can do this.') |
| common/guards/branch-write.guard.ts:60 | Forbidden |  | english | This branch is outside your assignment.') |
| common/guards/branch-write.guard.ts:67 | Forbidden |  | english | This warehouse is outside your assignment.') |
| common/guards/branch-write.guard.ts:86 | NotFound |  | english | Not found') |
| common/guards/jwt-auth.guard.ts:63 | Unauthorized |  | english | Missing bearer token') |
| common/guards/jwt-auth.guard.ts:81 | Unauthorized |  | english | Invalid or expired token') |
| common/guards/jwt-auth.guard.ts:87 | Unauthorized |  | english | A ticket is required for this address') |
| common/guards/jwt-auth.guard.ts:90 | Unauthorized |  | english | A download ticket cannot be used as a bearer token') |
| common/guards/jwt-auth.guard.ts:97 | Unauthorized |  | english | Session is unavailable |
| common/guards/jwt-auth.guard.ts:112 | Unauthorized |  | english | Session is unavailable |
| common/guards/jwt-auth.guard.ts:190 | Unauthorized |  | english | Account is inactive or unavailable') |
| common/guards/permissions.guard.ts:28 | Forbidden |  | english | No principal') |
| common/guards/permissions.guard.ts:33 | Forbidden |  | bilingual | ليس لديك صلاحية تنفيذ هذا الإجراء (${missing.join(', ')}). ` + |
| common/guards/super-admin.guard.ts:10 | Forbidden |  | bilingual | هذه العملية متاحة لمدير البرنامج فقط (حساب المسؤول الأعلى). ' + |
| common/audit/audit-purge.service.ts:311 | BadRequest |  | english | An audit purge needs one of the operations that is allowed to perform it.', |

## purchases

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/purchases/purchase-invoices.service.ts:131 | BadRequest |  | english | Unknown status: ${query.status}`) |
| modules/purchases/purchase-invoices.service.ts:167 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:257 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-invoices.service.ts:264 | BadRequest |  | english | The supplier does not exist') |
| modules/purchases/purchase-invoices.service.ts:265 | BadRequest |  | english | The supplier is inactive') |
| modules/purchases/purchase-invoices.service.ts:364 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-invoices.service.ts:370 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:371 | BadRequest |  | english | Order-linked draft editing requires allocation reconciliation |
| modules/purchases/purchase-invoices.service.ts:373 | BadRequest |  | english | Return documents cannot be edited as purchase invoices') |
| modules/purchases/purchase-invoices.service.ts:376 | BadRequest |  | english | Only a draft purchase invoice can be edited') |
| modules/purchases/purchase-invoices.service.ts:379 | BadRequest |  | english | A draft can only be edited from its assigned branch') |
| modules/purchases/purchase-invoices.service.ts:386 | BadRequest |  | english | The supplier does not exist') |
| modules/purchases/purchase-invoices.service.ts:387 | BadRequest |  | english | The supplier is inactive') |
| modules/purchases/purchase-invoices.service.ts:419 | BadRequest |  | english | This invoice was posted or changed by someone else. Reload it before editing.', |
| modules/purchases/purchase-invoices.service.ts:424 | BadRequest |  | english | Order-linked draft editing requires allocation reconciliation |
| modules/purchases/purchase-invoices.service.ts:498 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-invoices.service.ts:502 | BadRequest |  | english | Invoice is not linked to an order') |
| modules/purchases/purchase-invoices.service.ts:505 | BadRequest |  | english | expectedUpdatedAt is required') |
| modules/purchases/purchase-invoices.service.ts:514 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:519 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:526 | BadRequest |  | english | Order allocation changed |
| modules/purchases/purchase-invoices.service.ts:536 | Conflict |  | english | The idempotency key was used for a different amendment') |
| modules/purchases/purchase-invoices.service.ts:537 | Conflict |  | english | The amended invoice is no longer a draft') |
| modules/purchases/purchase-invoices.service.ts:541 | BadRequest |  | english | Only an active draft invoice can be amended') |
| modules/purchases/purchase-invoices.service.ts:543 | Conflict |  | english | The invoice changed |
| modules/purchases/purchase-invoices.service.ts:544 | BadRequest |  | english | Related order cannot be amended') |
| modules/purchases/purchase-invoices.service.ts:546 | BadRequest |  | english | This invoice has additional charges or discounts |
| modules/purchases/purchase-invoices.service.ts:552 | BadRequest |  | english | Historical invoice lines require manual review') |
| modules/purchases/purchase-invoices.service.ts:560 | BadRequest |  | english | Historical order item changed |
| modules/purchases/purchase-invoices.service.ts:612 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-invoices.service.ts:618 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:620 | BadRequest |  | english | Only a draft invoice can be cancelled') |
| modules/purchases/purchase-invoices.service.ts:631 | BadRequest |  | english | Related order is missing |
| modules/purchases/purchase-invoices.service.ts:637 | BadRequest |  | english | Invoice was posted or cancelled concurrently') |
| modules/purchases/purchase-invoices.service.ts:645 | BadRequest |  | english | Invoice was posted or cancelled concurrently') |
| modules/purchases/purchase-invoices.service.ts:657 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:659 | BadRequest |  | english | Only draft invoices can be posted (current status: ${invoice.status})`, |
| modules/purchases/purchase-invoices.service.ts:672 | BadRequest |  | english | This invoice was posted by someone else a moment ago. Reload it to see the current state.', |
| modules/purchases/purchase-invoices.service.ts:687 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:723 | BadRequest |  | english | A purchase invoice line has no item, so it cannot be posted to stock', |
| modules/purchases/purchase-invoices.service.ts:735 | BadRequest |  | english | An invoice line references a missing item') |
| modules/purchases/purchase-invoices.service.ts:737 | BadRequest |  | english | Item ${item.code} is not stock-tracked, so it cannot be purchased through a ` + |
| modules/purchases/purchase-invoices.service.ts:754 | BadRequest | PURCHASE_LOT_NEEDS_WAREHOUSE | coded |  |
| modules/purchases/purchase-invoices.service.ts:771 | BadRequest | PURCHASE_LOT_DETAILS_REQUIRED | coded |  |
| modules/purchases/purchase-invoices.service.ts:893 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:895 | BadRequest |  | english | Only posted invoices can be reversed') |
| modules/purchases/purchase-invoices.service.ts:898 | BadRequest |  | english | This invoice has no journal entry to reverse') |
| modules/purchases/purchase-invoices.service.ts:910 | NotFound |  | english | The original journal entry is missing') |
| modules/purchases/purchase-invoices.service.ts:912 | BadRequest |  | english | This invoice has already been reversed') |
| modules/purchases/purchase-invoices.service.ts:924 | BadRequest |  | english | This invoice has already been reversed') |
| modules/purchases/purchase-invoices.service.ts:936 | BadRequest |  | english | Reverse the posted purchase returns before reversing their source invoice.', |
| modules/purchases/purchase-invoices.service.ts:968 | BadRequest |  | english | A purchase invoice line has no item, so its stock cannot be returned', |
| modules/purchases/purchase-invoices.service.ts:988 | BadRequest |  | english | Cannot reverse this purchase: part of the stock has already been sold or ' + |
| modules/purchases/purchase-invoices.service.ts:1039 | BadRequest | PURCHASE_REVERSE_LOT_USED | coded |  |
| modules/purchases/purchase-invoices.service.ts:1063 | BadRequest | PURCHASE_REVERSE_SHELF_SHORT | coded |  |
| modules/purchases/purchase-invoices.service.ts:1078 | BadRequest |  | bilingual | تغيرت الدفعة أثناء العكس؛ أعد المحاولة. / The lot changed during the reversal |
| modules/purchases/purchase-invoices.service.ts:1172 | BadRequest |  | english | A purchase invoice may contain at most 50 landed-cost charges') |
| modules/purchases/purchase-invoices.service.ts:1177 | BadRequest |  | english | Landed-cost charge ${index + 1} needs a description of 1–120 characters`) |
| modules/purchases/purchase-invoices.service.ts:1190 | BadRequest |  | english | landedCostAmount (${legacyTotal.toFixed(MONEY_SCALE)}) must equal the sum of named charges (${total.toFixed(MO |
| modules/purchases/purchase-invoices.service.ts:1235 | BadRequest | PURCHASE_LOCATION_NOT_FOUND | coded |  |
| modules/purchases/purchase-invoices.service.ts:1244 | BadRequest | PURCHASE_LOCATION_INACTIVE | coded |  |
| modules/purchases/purchase-invoices.service.ts:1253 | BadRequest | PURCHASE_LOCATION_WRONG_WAREHOUSE | coded |  |
| modules/purchases/purchase-invoices.service.ts:1278 | BadRequest |  | english | Order invoice unit snapshots do not match its lines') |
| modules/purchases/purchase-invoices.service.ts:1295 | BadRequest |  | english | Line ${index + 1}: the item does not exist`) |
| modules/purchases/purchase-invoices.service.ts:1298 | BadRequest |  | english | Line ${index + 1}: the item is inactive`) |
| modules/purchases/purchase-invoices.service.ts:1302 | BadRequest |  | english | Line ${index + 1} quantity must be greater than zero`) |
| modules/purchases/purchase-invoices.service.ts:1337 | BadRequest |  | english | Line ${index + 1}: enter a purchase unit price |
| modules/purchases/purchase-invoices.service.ts:1369 | BadRequest |  | english | Line ${index + 1}: the cost center does not exist`, |
| modules/purchases/purchase-invoices.service.ts:1374 | BadRequest |  | english | Line ${index + 1}: cost center ${center.code} is inactive`, |
| modules/purchases/purchase-invoices.service.ts:1415 | BadRequest |  | english |  |
| modules/purchases/purchase-invoices.service.ts:1436 | BadRequest |  | english |  |
| modules/purchases/purchase-invoices.service.ts:1455 | BadRequest |  | english |  |
| modules/purchases/purchase-invoices.service.ts:1488 | BadRequest |  | english |  |
| modules/purchases/purchase-invoices.service.ts:1501 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/purchases/purchase-invoices.service.ts:1508 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/purchases/purchase-invoices.service.ts:1515 | BadRequest |  | english | ${field} must be between 0 and 100`) |
| modules/purchases/purchase-invoices.service.ts:1524 | BadRequest |  | english | ${field} is not a valid number: ${value}`) |
| modules/purchases/purchase-orders.service.ts:89 | BadRequest |  | english | Unknown order status: ${query.status}`) |
| modules/purchases/purchase-orders.service.ts:138 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:183 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-orders.service.ts:194 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/purchases/purchase-orders.service.ts:204 | BadRequest |  | english | The supplier does not exist in this company') |
| modules/purchases/purchase-orders.service.ts:205 | BadRequest |  | english | Supplier ${supplier.code} is inactive`) |
| modules/purchases/purchase-orders.service.ts:209 | BadRequest |  | english | An order needs at least one line') |
| modules/purchases/purchase-orders.service.ts:287 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-orders.service.ts:289 | BadRequest |  | english | idempotencyKey is required') |
| modules/purchases/purchase-orders.service.ts:296 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:304 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/purchases/purchase-orders.service.ts:311 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:314 | BadRequest |  | english |  |
| modules/purchases/purchase-orders.service.ts:317 | BadRequest |  | english | expectedUpdatedAt is required') |
| modules/purchases/purchase-orders.service.ts:320 | Conflict | ORDER_EDIT_STALE | coded |  |
| modules/purchases/purchase-orders.service.ts:329 | BadRequest |  | english | Order has invoice history |
| modules/purchases/purchase-orders.service.ts:353 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/purchases/purchase-orders.service.ts:377 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:382 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:384 | BadRequest |  | english | Only a draft order can be approved (it is ${order.status})`) |
| modules/purchases/purchase-orders.service.ts:387 | BadRequest |  | english | Segregation of duties is on: the person who raised this order may not approve it') |
| modules/purchases/purchase-orders.service.ts:393 | BadRequest |  | english | This order was approved by someone else a moment ago.') |
| modules/purchases/purchase-orders.service.ts:429 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:431 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:432 | BadRequest |  | english | This order is already cancelled') |
| modules/purchases/purchase-orders.service.ts:436 | BadRequest |  | english | This order has active invoices |
| modules/purchases/purchase-orders.service.ts:469 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/purchases/purchase-orders.service.ts:479 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:484 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/purchases/purchase-orders.service.ts:495 | Conflict |  | english | The idempotency key was used for a different request') |
| modules/purchases/purchase-orders.service.ts:496 | Conflict |  | english | The invoice for this idempotency key is no longer active') |
| modules/purchases/purchase-orders.service.ts:500 | BadRequest |  | english | A cancelled order cannot be invoiced') |
| modules/purchases/purchase-orders.service.ts:501 | BadRequest |  | english | Approve the order before invoicing it') |
| modules/purchases/purchase-orders.service.ts:513 | BadRequest |  | english | Line ${line.lineNumber}: only ${outstanding.toFixed(MONEY_SCALE)} is still outstanding, ` + |
| modules/purchases/purchase-orders.service.ts:539 | BadRequest |  | english | This order is fully invoiced |
| modules/purchases/purchase-orders.service.ts:604 | BadRequest |  | english | Line ${index + 1}: the item does not exist`) |
| modules/purchases/purchase-orders.service.ts:605 | BadRequest |  | english | Line ${index + 1}: item ${item.code} is inactive`) |
| modules/purchases/purchase-orders.service.ts:608 | BadRequest |  | english | Line ${index + 1} quantity must be greater than zero`) |
| modules/purchases/purchase-orders.service.ts:638 | BadRequest |  | english | Line ${index + 1}: enter a purchase unit price |
| modules/purchases/purchase-orders.service.ts:715 | BadRequest |  | english | ${field} is not a date`) |
| modules/purchases/purchase-orders.service.ts:721 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/purchases/purchase-orders.service.ts:730 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/purchases/purchase-orders.service.ts:732 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/purchases/purchase-orders.service.ts:739 | BadRequest |  | english | ${field} cannot exceed 100`) |
| modules/purchases/purchase-orders.service.ts:745 | BadRequest |  | english | ${field} is required`) |

## cash

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/cash/bank-reconciliation.service.ts:54 | NotFound | RECONCILIATION_NOT_FOUND | coded |  |
| modules/cash/bank-reconciliation.service.ts:131 | BadRequest |  | english | cashAccountId is required') |
| modules/cash/bank-reconciliation.service.ts:137 | BadRequest |  | english | The cash account does not exist') |
| modules/cash/bank-reconciliation.service.ts:143 | BadRequest |  | english | periodTo must not be before periodFrom') |
| modules/cash/bank-reconciliation.service.ts:150 | BadRequest |  | english | statementBalance is not a valid amount') |
| modules/cash/bank-reconciliation.service.ts:228 | BadRequest |  | english | One or more vouchers were already matched by another reconciliation', |
| modules/cash/bank-reconciliation.service.ts:272 | BadRequest |  | english | One or more vouchers do not exist in this company') |
| modules/cash/bank-reconciliation.service.ts:276 | BadRequest |  | english | Voucher ${wrongAccount[0].voucherNumber} belongs to another cash account`, |
| modules/cash/bank-reconciliation.service.ts:282 | BadRequest |  | english | Voucher ${notPosted[0].voucherNumber} is not posted, so it cannot appear on a bank statement match`, |
| modules/cash/bank-reconciliation.service.ts:288 | BadRequest |  | english | Voucher ${alreadyMatched[0].voucherNumber} is already matched to another reconciliation`, |
| modules/cash/bank-reconciliation.service.ts:296 | BadRequest |  | english | ${field} is not a valid date`) |
| modules/cash/cash-accounts.service.ts:40 | BadRequest |  | english | Unknown kind: ${query.kind}`) |
| modules/cash/cash-accounts.service.ts:65 | NotFound | CASH_ACCOUNT_NOT_FOUND | coded |  |
| modules/cash/cash-accounts.service.ts:73 | BadRequest |  | english | Provide an Arabic or English name') |
| modules/cash/cash-accounts.service.ts:79 | BadRequest |  | english | kind must be CASH or BANK') |
| modules/cash/cash-accounts.service.ts:87 | Conflict |  | english | Cash account code ${code} is already used`) |
| modules/cash/cash-accounts.service.ts:97 | BadRequest |  | english | The ledger account does not exist') |
| modules/cash/cash-accounts.service.ts:99 | BadRequest |  | english | Account ${account.code} is a grouping account and cannot be a cash or bank account`, |
| modules/cash/cash-accounts.service.ts:103 | BadRequest |  | english | Account ${account.code} is inactive`) |
| modules/cash/cash-accounts.service.ts:110 | Conflict |  | english | Account ${account.code} already belongs to cash account ${taken.code}`, |
| modules/cash/cash-accounts.service.ts:151 | NotFound | CASH_ACCOUNT_NOT_FOUND | coded |  |
| modules/cash/cash-accounts.service.ts:155 | BadRequest |  | english | Provide an Arabic or English name') |
| modules/cash/cash-accounts.service.ts:173 | BadRequest |  | english | This cash account already has posted movements, so its ledger account cannot be changed. Create a new cash acc |
| modules/cash/cash-accounts.service.ts:203 | NotFound | CASH_ACCOUNT_NOT_FOUND | coded |  |
| modules/cash/cash-accounts.service.ts:270 | NotFound | CASH_ACCOUNT_NOT_FOUND | coded |  |
| modules/cash/cash-accounts.service.ts:337 | BadRequest |  | english | ${field} is required`) |
| modules/cash/cash-transfers.service.ts:75 | NotFound | TRANSFER_NOT_FOUND | coded |  |
| modules/cash/cash-transfers.service.ts:93 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/cash/cash-transfers.service.ts:96 | BadRequest |  | english | A transfer needs two different accounts') |
| modules/cash/cash-transfers.service.ts:103 | BadRequest |  | english | The two accounts use different currencies (${from.currency} and ${to.currency}). ` + |
| modules/cash/cash-transfers.service.ts:122 | BadRequest | CASH_SAVE_BALANCE_SHORT | coded |  |
| modules/cash/cash-transfers.service.ts:136 | BadRequest | CASH_SAVE_BALANCE_SHORT | coded |  |
| modules/cash/cash-transfers.service.ts:191 | NotFound | TRANSFER_NOT_FOUND | coded |  |
| modules/cash/cash-transfers.service.ts:193 | BadRequest |  | english | Only a draft transfer can be posted (current status: ${transfer.status})`, |
| modules/cash/cash-transfers.service.ts:204 | BadRequest |  | english | This transfer has just been posted by someone else.') |
| modules/cash/cash-transfers.service.ts:261 | NotFound | TRANSFER_NOT_FOUND | coded |  |
| modules/cash/cash-transfers.service.ts:263 | BadRequest |  | english | Only a posted transfer can be reversed') |
| modules/cash/cash-transfers.service.ts:272 | BadRequest |  | english | This transfer has just been changed by someone else.') |
| modules/cash/cash-transfers.service.ts:302 | BadRequest |  | english | The ${side} cash account is required`) |
| modules/cash/cash-transfers.service.ts:308 | BadRequest |  | english | The ${side} cash account does not exist`) |
| modules/cash/cash-transfers.service.ts:309 | BadRequest |  | english | The ${side} cash account is inactive`) |
| modules/cash/cash-transfers.service.ts:318 | BadRequest |  | english | amount is not a valid amount') |
| modules/cash/cash-transfers.service.ts:321 | BadRequest |  | english | amount must be greater than zero') |
| modules/cash/cash-transfers.service.ts:328 | BadRequest |  | english | transferDate is not a valid date') |
| modules/cash/cash-vouchers.service.ts:69 | BadRequest |  | english | Unknown voucher kind: ${query.kind}`) |
| modules/cash/cash-vouchers.service.ts:116 | NotFound | CASH_VOUCHER_NOT_FOUND | coded |  |
| modules/cash/cash-vouchers.service.ts:189 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/cash/cash-vouchers.service.ts:194 | BadRequest |  | english | kind must be RECEIPT or PAYMENT') |
| modules/cash/cash-vouchers.service.ts:199 | BadRequest |  | english | That cash account is inactive') |
| modules/cash/cash-vouchers.service.ts:212 | BadRequest |  | english | The cost center does not exist') |
| modules/cash/cash-vouchers.service.ts:214 | BadRequest |  | english | Cost center ${center.code} is inactive`) |
| modules/cash/cash-vouchers.service.ts:217 | BadRequest |  | english | A cost center can only be recorded on a voucher that names a counter account', |
| modules/cash/cash-vouchers.service.ts:229 | BadRequest |  | english | The allocations (${allocationTotal.toFixed(MONEY_SCALE)}) are more than the voucher ` + |
| modules/cash/cash-vouchers.service.ts:235 | BadRequest |  | english | A voucher can only be allocated against invoices when it names a customer or a supplier', |
| modules/cash/cash-vouchers.service.ts:259 | BadRequest | CASH_SAVE_BALANCE_SHORT | coded |  |
| modules/cash/cash-vouchers.service.ts:273 | BadRequest | CASH_SAVE_BALANCE_SHORT | coded |  |
| modules/cash/cash-vouchers.service.ts:353 | NotFound | CASH_VOUCHER_NOT_FOUND | coded |  |
| modules/cash/cash-vouchers.service.ts:355 | BadRequest |  | english | Only a draft voucher can be posted (current status: ${voucher.status})`, |
| modules/cash/cash-vouchers.service.ts:360 | BadRequest |  | english | That cash account is inactive') |
| modules/cash/cash-vouchers.service.ts:377 | BadRequest |  | english | This voucher has just been posted by someone else. Reload it to see the current state.', |
| modules/cash/cash-vouchers.service.ts:388 | BadRequest |  | english | Each allocation must name exactly one invoice') |
| modules/cash/cash-vouchers.service.ts:392 | BadRequest |  | english | A sales invoice can only be settled by a receipt') |
| modules/cash/cash-vouchers.service.ts:406 | BadRequest |  | english | An allocation references a missing sales invoice') |
| modules/cash/cash-vouchers.service.ts:408 | BadRequest |  | english | Sales invoice ${invoice.invoiceNumber} is not posted, so it cannot be paid`, |
| modules/cash/cash-vouchers.service.ts:413 | BadRequest |  | english | Sales invoice ${invoice.invoiceNumber} does not belong to this voucher's customer`, |
| modules/cash/cash-vouchers.service.ts:418 | BadRequest |  | english | Sales invoice ${invoice.invoiceNumber} is in ${invoice.currency} |
| modules/cash/cash-vouchers.service.ts:424 | BadRequest |  | english | Sales invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay |
| modules/cash/cash-vouchers.service.ts:436 | BadRequest |  | english | A purchase invoice can only be settled by a payment') |
| modules/cash/cash-vouchers.service.ts:450 | BadRequest |  | english | An allocation references a missing purchase invoice') |
| modules/cash/cash-vouchers.service.ts:452 | BadRequest |  | english | Purchase invoice ${invoice.invoiceNumber} is not posted, so it cannot be paid`, |
| modules/cash/cash-vouchers.service.ts:457 | BadRequest |  | english | Purchase invoice ${invoice.invoiceNumber} does not belong to this voucher's supplier`, |
| modules/cash/cash-vouchers.service.ts:462 | BadRequest |  | english | Purchase invoice ${invoice.invoiceNumber} is in ${invoice.currency} |
| modules/cash/cash-vouchers.service.ts:468 | BadRequest |  | english | Purchase invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay |
| modules/cash/cash-vouchers.service.ts:518 | BadRequest |  | english | Give the voucher a customer, a supplier or a counter account: the money has to come from somewhere.', |
| modules/cash/cash-vouchers.service.ts:577 | BadRequest |  | english |  |
| modules/cash/cash-vouchers.service.ts:638 | NotFound | CASH_VOUCHER_NOT_FOUND | coded |  |
| modules/cash/cash-vouchers.service.ts:640 | BadRequest |  | english | Only a posted voucher can be reversed') |
| modules/cash/cash-vouchers.service.ts:649 | BadRequest |  | english | This voucher has just been changed by someone else.') |
| modules/cash/cash-vouchers.service.ts:804 | BadRequest |  | english | Each allocation must name exactly one invoice') |
| modules/cash/cash-vouchers.service.ts:807 | BadRequest |  | english | A sales invoice can only be settled by a receipt') |
| modules/cash/cash-vouchers.service.ts:810 | BadRequest |  | english | A purchase invoice can only be settled by a payment') |
| modules/cash/cash-vouchers.service.ts:835 | BadRequest |  | english | An allocation references a missing sales invoice') |
| modules/cash/cash-vouchers.service.ts:840 | BadRequest |  | english | Sales invoice ${invoice.invoiceNumber} does not belong to this voucher's customer`, |
| modules/cash/cash-vouchers.service.ts:875 | BadRequest |  | english | An allocation references a missing purchase invoice') |
| modules/cash/cash-vouchers.service.ts:880 | BadRequest |  | english | Purchase invoice ${invoice.invoiceNumber} does not belong to this voucher's supplier`, |
| modules/cash/cash-vouchers.service.ts:905 | BadRequest |  | english | ${label} ${invoice.invoiceNumber} has been reversed, so it cannot be paid`, |
| modules/cash/cash-vouchers.service.ts:910 | BadRequest |  | english | ${label} ${invoice.invoiceNumber} is in ${invoice.currency} |
| modules/cash/cash-vouchers.service.ts:939 | BadRequest |  | english | ${label} ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay |
| modules/cash/cash-vouchers.service.ts:952 | BadRequest |  | english | Choose the cash account the money moved through') |
| modules/cash/cash-vouchers.service.ts:958 | BadRequest |  | english | The cash account does not exist') |
| modules/cash/cash-vouchers.service.ts:971 | BadRequest |  | english | The customer does not exist') |
| modules/cash/cash-vouchers.service.ts:972 | BadRequest |  | english | The customer is inactive') |
| modules/cash/cash-vouchers.service.ts:979 | BadRequest |  | english | The supplier does not exist') |
| modules/cash/cash-vouchers.service.ts:980 | BadRequest |  | english | The supplier is inactive') |
| modules/cash/cash-vouchers.service.ts:987 | BadRequest |  | english | The counter account does not exist') |
| modules/cash/cash-vouchers.service.ts:989 | BadRequest |  | english | Account ${account.code} is a grouping account`) |
| modules/cash/cash-vouchers.service.ts:991 | BadRequest |  | english | Account ${account.code} is inactive`) |
| modules/cash/cash-vouchers.service.ts:996 | BadRequest |  | english | A voucher is against a customer or a supplier, not both') |
| modules/cash/cash-vouchers.service.ts:1011 | BadRequest |  | english | ${field} is not a valid amount`) |
| modules/cash/cash-vouchers.service.ts:1014 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/cash/cash-vouchers.service.ts:1021 | BadRequest |  | english | ${field} is not a valid date`) |

## returns

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/returns/returns.service.ts:154 | NotFound | RETURN_DOCUMENT_NOT_FOUND | coded |  |
| modules/returns/returns.service.ts:198 | NotFound | RETURN_DOCUMENT_NOT_FOUND | coded |  |
| modules/returns/returns.service.ts:255 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/returns/returns.service.ts:265 | BadRequest |  | english | The original sales invoice does not exist') |
| modules/returns/returns.service.ts:267 | BadRequest |  | english | Only a posted sales invoice can be returned') |
| modules/returns/returns.service.ts:270 | BadRequest |  | english | A return document cannot itself be returned') |
| modules/returns/returns.service.ts:273 | BadRequest |  | english | A return must be recorded in the branch that issued the original invoice') |
| modules/returns/returns.service.ts:276 | BadRequest |  | english | A return needs at least one line') |
| modules/returns/returns.service.ts:281 | BadRequest |  | english | The return date cannot be before the invoice date') |
| modules/returns/returns.service.ts:308 | BadRequest |  | english | Line ${index + 1}: that line does not belong to the invoice`) |
| modules/returns/returns.service.ts:311 | BadRequest |  | english | Line ${index + 1}: an invoice line may appear only once in a return`) |
| modules/returns/returns.service.ts:321 | BadRequest |  | english | Line ${index + 1}: ${remaining.toFixed(MONEY_SCALE)} of ${originalLine.description} ` + |
| modules/returns/returns.service.ts:350 | BadRequest |  | english | Line ${index + 1}: a sales return uses the original invoice unit price ` + |
| modules/returns/returns.service.ts:498 | BadRequest | PURCHASE_RETURN_LOT_SHORT | coded |  |
| modules/returns/returns.service.ts:522 | BadRequest | PURCHASE_RETURN_SHELF_SHORT | coded |  |
| modules/returns/returns.service.ts:537 | BadRequest |  | bilingual | تغيرت الدفعة أثناء الترحيل؛ أعد المحاولة. / The lot changed while posting |
| modules/returns/returns.service.ts:604 | BadRequest | RETURN_REVERSE_COST_MISMATCH | coded |  |
| modules/returns/returns.service.ts:622 | BadRequest | RETURN_REVERSE_LOT_SHORT | coded |  |
| modules/returns/returns.service.ts:643 | BadRequest | RETURN_REVERSE_SHELF_SHORT | coded |  |
| modules/returns/returns.service.ts:659 | BadRequest |  | bilingual | تغيرت الدفعة أثناء العكس؛ أعد المحاولة. / The lot changed during the reversal |
| modules/returns/returns.service.ts:701 | NotFound | RETURN_DOCUMENT_NOT_FOUND | coded |  |
| modules/returns/returns.service.ts:703 | BadRequest |  | english | Only a sales credit note can be posted as a sales return.') |
| modules/returns/returns.service.ts:706 | BadRequest |  | english | Only a draft return can be posted (current status: ${document.status})`, |
| modules/returns/returns.service.ts:711 | BadRequest |  | english | A return must name the invoice it returns') |
| modules/returns/returns.service.ts:729 | BadRequest |  | english | The source sales invoice is no longer posted |
| modules/returns/returns.service.ts:737 | BadRequest |  | english | This return has just been posted by someone else.') |
| modules/returns/returns.service.ts:779 | BadRequest |  | english | ${remaining.toFixed(MONEY_SCALE)} of "${matching.description}" is still returnable |
| modules/returns/returns.service.ts:839 | BadRequest |  | english | A sales-return item no longer exists') |
| modules/returns/returns.service.ts:841 | BadRequest |  | english | A sales-return item is no longer tracked in stock') |
| modules/returns/returns.service.ts:945 | BadRequest |  | bilingual | دفعة الفاتورة الأصلية لم تعد موجودة. / The original invoice lot no longer exists.', |
| modules/returns/returns.service.ts:1178 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/returns/returns.service.ts:1185 | BadRequest |  | english | The original purchase invoice does not exist') |
| modules/returns/returns.service.ts:1187 | BadRequest |  | english | Only a posted purchase invoice can be returned') |
| modules/returns/returns.service.ts:1190 | BadRequest |  | english | A return document cannot itself be returned') |
| modules/returns/returns.service.ts:1193 | BadRequest |  | english | A return must be recorded in the branch that issued the original invoice') |
| modules/returns/returns.service.ts:1196 | BadRequest |  | english | A return needs at least one line') |
| modules/returns/returns.service.ts:1201 | BadRequest |  | english | The return date cannot be before the invoice date') |
| modules/returns/returns.service.ts:1227 | BadRequest |  | english | Line ${index + 1}: that line does not belong to the invoice`) |
| modules/returns/returns.service.ts:1230 | BadRequest |  | english | Line ${index + 1}: an invoice line may appear only once in a return`) |
| modules/returns/returns.service.ts:1239 | BadRequest |  | english | Line ${index + 1}: ${remaining.toFixed(MONEY_SCALE)} of ${originalLine.description} ` + |
| modules/returns/returns.service.ts:1264 | BadRequest |  | english | Line ${index + 1}: a purchase return uses the original invoice unit price ` + |
| modules/returns/returns.service.ts:1291 | BadRequest |  | english | Line ${index + 1}: allocated inventory cost is below the returned invoice value`) |
| modules/returns/returns.service.ts:1379 | NotFound | RETURN_DOCUMENT_NOT_FOUND | coded |  |
| modules/returns/returns.service.ts:1381 | BadRequest |  | english | Only a purchase debit note can be posted as a purchase return.') |
| modules/returns/returns.service.ts:1384 | BadRequest |  | english | Only a draft return can be posted (current status: ${document.status})`, |
| modules/returns/returns.service.ts:1389 | BadRequest |  | english | A return must name the invoice it returns') |
| modules/returns/returns.service.ts:1405 | BadRequest |  | english | The source purchase invoice is no longer posted |
| modules/returns/returns.service.ts:1413 | BadRequest |  | english | This return has just been posted by someone else.') |
| modules/returns/returns.service.ts:1454 | BadRequest |  | english | ${remaining.toFixed(MONEY_SCALE)} of "${matching.description}" is still returnable |
| modules/returns/returns.service.ts:1482 | BadRequest |  | english | Return line ${line.lineNumber}: allocated inventory cost is below the returned invoice value.`, |
| modules/returns/returns.service.ts:1528 | BadRequest |  | english | A purchase-return item is no longer tracked in stock') |
| modules/returns/returns.service.ts:1544 | BadRequest |  | english | Cannot return ${line.quantity.toFixed(MONEY_SCALE)} to the supplier: ` + |
| modules/returns/returns.service.ts:1550 | BadRequest |  | english | Cannot reverse ${returnedCost.toFixed(MONEY_SCALE)} of inventory cost |
| modules/returns/returns.service.ts:1716 | NotFound | RETURN_DOCUMENT_NOT_FOUND | coded |  |
| modules/returns/returns.service.ts:1718 | BadRequest |  | english | Only a sales credit note can be reversed as a sales return.') |
| modules/returns/returns.service.ts:1721 | BadRequest |  | english | Only a posted return can be reversed') |
| modules/returns/returns.service.ts:1730 | BadRequest |  | english | This return has just been changed by someone else.') |
| modules/returns/returns.service.ts:1765 | BadRequest |  | english | A sales-return item no longer exists') |
| modules/returns/returns.service.ts:1782 | BadRequest |  | english | Cannot reverse this return: ${onHand.toFixed(MONEY_SCALE)} is available in stock, ` + |
| modules/returns/returns.service.ts:1788 | BadRequest |  | english | Cannot reverse this return: ${balance.value.toFixed(MONEY_SCALE)} of inventory value ` + |
| modules/returns/returns.service.ts:1856 | NotFound | RETURN_DOCUMENT_NOT_FOUND | coded |  |
| modules/returns/returns.service.ts:1858 | BadRequest |  | english | Only a purchase debit note can be reversed as a purchase return.') |
| modules/returns/returns.service.ts:1861 | BadRequest |  | english | Only a posted return can be reversed') |
| modules/returns/returns.service.ts:1870 | BadRequest |  | english | This return has just been changed by someone else.') |
| modules/returns/returns.service.ts:2002 | BadRequest |  | english | The original invoice line could not be found') |
| modules/returns/returns.service.ts:2039 | BadRequest |  | english | The original invoice line could not be found') |
| modules/returns/returns.service.ts:2075 | BadRequest |  | english | ${field} has an invalid negative amount`) |
| modules/returns/returns.service.ts:2080 | BadRequest |  | english | ${field} is already fully returned or inconsistent`) |
| modules/returns/returns.service.ts:2083 | BadRequest |  | english | ${field} exceeds the original line's remaining quantity`) |
| modules/returns/returns.service.ts:2096 | BadRequest |  | english | ${field} is required`) |
| modules/returns/returns.service.ts:2121 | BadRequest |  | english | ${field} quantity must be greater than zero`) |
| modules/returns/returns.service.ts:2124 | BadRequest |  | english | ${field}: unit id cannot be verified against the original invoice`) |
| modules/returns/returns.service.ts:2132 | BadRequest |  | english | ${field}: legacy invoice has no trusted conversion for the requested unit`) |
| modules/returns/returns.service.ts:2141 | BadRequest |  | english | ${field}: a return must use the original document's unit (${originalLine.unitName})`, |
| modules/returns/returns.service.ts:2162 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/returns/returns.service.ts:2165 | BadRequest |  | english | ${field} must be greater than zero`) |
| modules/returns/returns.service.ts:2175 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/returns/returns.service.ts:2178 | BadRequest |  | english | ${field} cannot be negative`) |
| modules/returns/returns.service.ts:2185 | BadRequest |  | english | ${field} is not a valid date`) |

## backup

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/backup/backup.controller.ts:162 | BadRequest |  | english | No file was uploaded.') |
| modules/backup/backup.controller.ts:165 | BadRequest |  | english | The backup file is larger than 64 MB.') |
| modules/backup/backup.controller.ts:171 | BadRequest |  | bilingual | هذا الملف هو أرشيف قاعدة بيانات PostgreSQL (.dump) وليس ملف نسخة احتياطية لبيانات الشركة بصيغة JSON. ' + |
| modules/backup/backup.controller.ts:179 | BadRequest |  | english | The file is not readable as a JSON company backup. It may be incomplete or invalid JSON.', |
| modules/backup/backup.service.ts:396 | BadRequest |  | english | Company not found') |
| modules/backup/backup.service.ts:477 | BadRequest |  | english | The packaged demo company backup is not valid JSON.') |
| modules/backup/backup.service.ts:481 | BadRequest |  | english | The packaged demo company backup has the wrong identity.') |
| modules/backup/backup.service.ts:489 | NotFound |  | english | The demo company backup is not included in this installation.') |
| modules/backup/backup.service.ts:667 | BadRequest |  | english | The company in this backup does not exist here. Restore it on the installation it came from.', |
| modules/backup/backup.service.ts:679 | BadRequest |  | english | This backup belongs to another company. Sign in to that company and restore it there.', |
| modules/backup/backup.service.ts:712 | BadRequest |  | english | This backup is missing tables that currently contain company data: ${missingTablesWithLiveData.join(', ')}. Cr |
| modules/backup/backup.service.ts:717 | BadRequest |  | english | This company already holds data (${describe(existing)}). Confirm that you want to replace it to restore over i |
| modules/backup/backup.service.ts:923 | BadRequest |  | english | This file is not a KAYAN backup. Choose a file that was downloaded from the backup screen.', |
| modules/backup/backup.service.ts:932 | BadRequest |  | english | This backup was written by a newer version of the program (format ${file.version}). Update the program first.` |
| modules/backup/backup.service.ts:937 | BadRequest |  | english | The backup file has no tables in it.') |
| modules/backup/backup.service.ts:942 | BadRequest |  | english | The backup table "${name}" must contain a list of rows.`) |
| modules/backup/backup.service.ts:945 | BadRequest |  | english | The backup contains data for unsupported table "${name}". Use a matching program version |
| modules/backup/backup.service.ts:951 | BadRequest |  | english | The backup row ${index + 1} in table "${name}" must be a JSON object |
| modules/backup/backup.service.ts:963 | BadRequest |  | english | The backup row counts are invalid |
| modules/backup/backup.service.ts:968 | BadRequest |  | english | The backup row count for "${name}" does not match its data |
| modules/backup/backup.service.ts:973 | BadRequest |  | english | The backup is missing its company identity or creation date.') |
| modules/backup/backup.service.ts:979 | BadRequest |  | english | The backup company profile is invalid.') |
| modules/backup/backup.service.ts:987 | BadRequest |  | english | The backup company profile is missing its required fields.') |
| modules/backup/backup.service.ts:995 | BadRequest |  | english | The backup company profile field "${field}" is invalid.`) |
| modules/backup/backup.service.ts:1005 | BadRequest |  | english | The backup company logo is not valid base64.') |
| modules/backup/backup.service.ts:1009 | BadRequest |  | english | The backup company logo is not valid base64.') |
| modules/backup/backup.service.ts:1017 | BadRequest |  | english | The backup company logo must be between 32px and 2048px.') |
| modules/backup/backup.service.ts:1020 | BadRequest |  | english | The backup company logo type is inconsistent.') |
| modules/backup/backup.service.ts:1205 | BadRequest |  | english | This older backup does not include permission codes, and its permission IDs do not match this installation. '  |
| modules/backup/full-backup.service.ts:535 | NotFound |  | english | No backup file named "${name}" on this server`) |
| modules/backup/full-backup.service.ts:557 | NotFound |  | english | The backup file "${name}" is not on this server, or it is empty.`, |
| modules/backup/full-backup.service.ts:644 | BadRequest |  | english | The file "${label}" is not a PostgreSQL archive pg_restore can read ` + |
| modules/backup/full-backup.service.ts:652 | BadRequest |  | english | The file "${label}" holds no database objects, so it cannot be ` + |
| modules/backup/full-backup.service.ts:660 | BadRequest |  | english | The backup archive contains data that pg_restore could not read. The current database was not changed.', |
| modules/backup/full-backup.service.ts:691 | Conflict | BACKUP_DELETE_LAST | coded |  |
| modules/backup/full-backup.service.ts:703 | Conflict | BACKUP_DELETE_IN_USE | coded |  |
| modules/backup/full-backup.service.ts:710 | Conflict | BACKUP_DELETE_IN_USE | coded |  |
| modules/backup/full-backup.service.ts:722 | NotFound |  | english | No backup file named "${name}" on this server`) |
| modules/backup/full-backup.service.ts:750 | BadRequest |  | english | A full restore replaces the whole database. Send confirm=true to say you understand that.', |
| modules/backup/full-backup.service.ts:763 | BadRequest |  | english | Choose a backup file to restore: either upload one or name one on this server.') |
| modules/backup/full-backup.service.ts:806 | BadRequest |  | english | Choose a backup file to restore: either upload one or name one on this server.', |
| modules/backup/full-backup.service.ts:918 | BadRequest |  | english | This file did not restore cleanly into a test database, so the ' + |
| modules/backup/full-backup.service.ts:929 | Conflict |  | english | Another maintenance operation started during restore rehearsal. The database was not changed.') |
| modules/backup/full-backup.service.ts:1348 | BadRequest |  | english | That is not a backup file name. Choose one from the list.', |
| modules/backup/full-backup.service.ts:1356 | BadRequest |  | english | That file is outside the backup folder.') |
| modules/backup/full-backup.service.ts:1406 | BadRequest |  | english | The backup file is empty.') |
| modules/backup/full-backup.service.ts:1409 | BadRequest |  | english | The backup file is larger than 2 GB.') |
| modules/backup/full-backup.service.ts:1413 | BadRequest |  | bilingual | الملف "${label}" هو ملف نسخة احتياطية لبيانات الشركة بصيغة JSON، وليس ملف أرشيف PostgreSQL (.dump). ` + |
| modules/backup/full-backup.service.ts:1419 | BadRequest |  | bilingual | الملف "${label}" ليس ملف أرشيف PostgreSQL صالحاً بصيغة Custom Format (.dump). ` + |
| modules/backup/system/complete-backup.controller.ts:111 | BadRequest |  | english | No file was uploaded.') |
| modules/backup/system/complete-backup.service.ts:523 | BadRequest |  | english | That is not a complete-backup file name. Choose one from the list.', |
| modules/backup/system/complete-backup.service.ts:533 | NotFound |  | english | No backup file named "${name}" on this server`) |
| modules/backup/system/complete-backup.service.ts:548 | NotFound |  | english | No backup file named "${name}" on this server`) |
| modules/backup/system/complete-backup.service.ts:570 | NotFound |  | english | No backup file named "${name}" on this server`) |
| modules/backup/system/complete-backup.service.ts:580 | BadRequest |  | english | No file was uploaded.') |
| modules/backup/system/complete-backup.service.ts:582 | BadRequest |  | english | The backup file is larger than 2 GB.') |
| modules/backup/system/restore-authority.ts:12 | Unauthorized |  | english | Session is unavailable |
| modules/backup/system/restore-authority.ts:23 | Unauthorized |  | english | Session changed while waiting to restore |
| modules/backup/system/restore-authority.ts:34 | Unauthorized |  | english | Account is inactive or unavailable') |
| modules/backup/system/restore-authority.ts:39 | Forbidden |  | english | Restore permission changed while waiting. No data was changed.') |
| modules/backup/system/restore-lock.ts:23 | Conflict |  | english | Another process is already restoring this database.') |
| modules/backup/system/system-restore.service.ts:218 | BadRequest |  | english | A complete restore replaces the whole database. Send confirm=true once you have read the warning.', |
| modules/backup/system/system-restore.service.ts:223 | BadRequest |  | bilingual | اكتب كلمة RESTORE لتأكيد الاستعادة. / Type RESTORE to confirm that you want to replace everything.', |
| modules/backup/system/system-restore.service.ts:229 | Conflict |  | english | A restore is already running. Wait for it to finish before starting another one.', |
| modules/backup/system/system-restore.service.ts:250 | BadRequest |  | english | The backup file is larger than 2 GB.') |
| modules/backup/system/system-restore.service.ts:260 | BadRequest |  | english | There is no backup named "${input.fileName}" on this server.`) |
| modules/backup/system/system-restore.service.ts:263 | BadRequest |  | english | Choose a backup to restore: upload one or name one already on this server.', |
| modules/backup/system/system-restore.service.ts:269 | BadRequest |  | bilingual | هذا أرشيف قاعدة بيانات (.dump) وليس نسخة نظام كاملة. استخدم قسم أرشيف قاعدة البيانات. / ' + |
| modules/backup/system/system-restore.service.ts:283 | Conflict |  | english | A restore or recovery is already running.') |
| modules/backup/system/system-restore.service.ts:300 | BadRequest |  | english |  |
| modules/backup/system/system-restore.service.ts:338 | BadRequest |  | english | The database dump inside this archive is not a PostgreSQL archive. Nothing was changed.', |
| modules/backup/system/system-restore.service.ts:376 | BadRequest |  | english | This backup did not restore cleanly into a test database, so the current data was ' + |
| modules/backup/system/system-restore.service.ts:396 | Conflict |  | english | Another maintenance operation started during restore rehearsal. The database was not changed.') |
| modules/backup/system/system-restore.service.ts:614 | Conflict |  | english | A restore or recovery is already running.') |

## admin

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/admin/roles.service.ts:77 | NotFound | ROLE_NOT_FOUND | coded |  |
| modules/admin/roles.service.ts:123 | BadRequest |  | english | A role code is 2-40 letters, digits, underscores or hyphens', |
| modules/admin/roles.service.ts:128 | Conflict |  | english | That role code is reserved') |
| modules/admin/roles.service.ts:133 | Conflict |  | english | A role with that code already exists') |
| modules/admin/roles.service.ts:147 | NotFound |  | english | The role to copy was not found') |
| modules/admin/roles.service.ts:191 | NotFound | ROLE_NOT_FOUND | coded |  |
| modules/admin/roles.service.ts:193 | BadRequest |  | english | A system role cannot be renamed') |
| modules/admin/roles.service.ts:198 | BadRequest |  | english | The system administrator role cannot be disabled') |
| modules/admin/roles.service.ts:245 | BadRequest |  | english | Unknown permission(s): ${unknown.join(', ')}`) |
| modules/admin/roles.service.ts:280 | NotFound | ROLE_NOT_FOUND | coded |  |
| modules/admin/roles.service.ts:286 | Forbidden |  | english | Only a super administrator can change permissions on a global system role', |
| modules/admin/roles.service.ts:300 | NotFound | ROLE_NOT_FOUND | coded |  |
| modules/admin/roles.service.ts:302 | Forbidden |  | english | Only a super administrator can change permissions on a global system role') |
| modules/admin/roles.service.ts:311 | Conflict |  | english | Role permissions changed since they were loaded. Refresh and review them before saving.') |
| modules/admin/roles.service.ts:331 | NotFound | ROLE_NOT_FOUND | coded |  |
| modules/admin/roles.service.ts:332 | BadRequest |  | english | A system role cannot be removed') |
| modules/admin/roles.service.ts:334 | BadRequest |  | english | ${role._count.userRoles} user(s) still hold this role. Move them to another role first.`, |
| modules/admin/roles.service.ts:361 | Forbidden |  | english | You cannot grant permissions you do not hold: ${forbidden.join(', ')}`, |
| modules/admin/roles.service.ts:380 | BadRequest |  | english | Unknown permission(s): ${missing.join(', ')}`, |
| modules/admin/users.controller.ts:70 | Forbidden |  | bilingual | You can only assign branches you are assigned to. / لا يمكنك إسناد فروع خارج فروعك.') |
| modules/admin/users.controller.ts:89 | Forbidden |  | bilingual | You can only assign branches you are assigned to. / لا يمكنك إسناد فروع خارج فروعك.') |
| modules/admin/users.controller.ts:124 | BadRequest |  | english | No photo file was uploaded') |
| modules/admin/users.service.ts:134 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:148 | Conflict |  | english | That username is reserved') |
| modules/admin/users.service.ts:151 | Conflict |  | english | That username is already taken. Choose a different username.') |
| modules/admin/users.service.ts:226 | BadRequest |  | english | Extra permissions must be an array when supplied.') |
| modules/admin/users.service.ts:229 | BadRequest |  | english | Denied permissions must be an array when supplied.') |
| modules/admin/users.service.ts:234 | BadRequest |  | english | An expected permission set requires its corresponding replacement.') |
| modules/admin/users.service.ts:239 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:241 | Forbidden |  | english | Only a super administrator can modify a super administrator account') |
| modules/admin/users.service.ts:244 | BadRequest |  | english | The system administrator cannot be deactivated') |
| modules/admin/users.service.ts:272 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:274 | Forbidden |  | english | Only a super administrator can modify a super administrator account') |
| modules/admin/users.service.ts:277 | BadRequest |  | english | The system administrator cannot be deactivated') |
| modules/admin/users.service.ts:289 | Conflict |  | english | User roles changed since they were loaded. Refresh and review them before saving.') |
| modules/admin/users.service.ts:296 | Conflict |  | english | User permissions changed since they were loaded. Refresh and review them before saving.') |
| modules/admin/users.service.ts:303 | Conflict |  | english | User permissions changed since they were loaded. Refresh and review them before saving.') |
| modules/admin/users.service.ts:364 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:366 | Forbidden |  | english | Only a super administrator can reset a super administrator password') |
| modules/admin/users.service.ts:410 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:412 | BadRequest |  | english | You cannot deactivate your own account') |
| modules/admin/users.service.ts:415 | Forbidden |  | english | Only a super administrator can deactivate a super administrator account') |
| modules/admin/users.service.ts:418 | BadRequest |  | english | The system administrator cannot be deactivated') |
| modules/admin/users.service.ts:491 | BadRequest |  | english | One of the roles does not exist in this company') |
| modules/admin/users.service.ts:505 | Forbidden |  | english | You cannot assign permissions you do not hold: ${forbidden.join(', ')}`, |
| modules/admin/users.service.ts:530 | BadRequest |  | english | Unknown permission code(s): ${unknown.join(', ')}`, |
| modules/admin/users.service.ts:537 | Forbidden |  | english | You cannot grant permissions you do not hold: ${forbidden.join(', ')}`, |
| modules/admin/users.service.ts:558 | BadRequest |  | english | Unknown permission code(s): ${unknown.join(', ')}`) |
| modules/admin/users.service.ts:592 | BadRequest |  | english | One of the permissions no longer exists') |
| modules/admin/users.service.ts:618 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:648 | NotFound | USER_NOT_FOUND | coded |  |
| modules/admin/users.service.ts:716 | BadRequest |  | english | One of the branches does not exist in this company') |

## company

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/company/companies.controller.ts:82 | NotFound | COMPANY_LOGO_NOT_FOUND | coded |  |
| modules/company/companies.controller.ts:111 | BadRequest |  | bilingual | لم يتم اختيار ملف للشعار / No logo file was uploaded.') |
| modules/company/companies.controller.ts:135 | NotFound | COMPANY_LOGO_NOT_FOUND | coded |  |
| modules/company/company.controller.ts:88 | BadRequest |  | bilingual | لم يتم اختيار ملف للشعار / No logo file was uploaded.') |
| modules/company/company.service.ts:110 | NotFound | COMPANY_NOT_FOUND | coded |  |
| modules/company/company.service.ts:155 | NotFound | COMPANY_NOT_FOUND | coded |  |
| modules/company/company.service.ts:173 | NotFound | COMPANY_NOT_FOUND | coded |  |
| modules/company/company.service.ts:180 | BadRequest |  | english | Company names cannot be blank') |
| modules/company/company.service.ts:190 | Conflict |  | english | Another company already uses the code "${code}"`, |
| modules/company/company.service.ts:248 | NotFound | COMPANY_NOT_FOUND | coded |  |
| modules/company/company.service.ts:317 | NotFound | COMPANY_NOT_FOUND | coded |  |
| modules/company/company.service.ts:373 | Conflict |  | english | Branch code "${dto.code}" already exists in this company`, |
| modules/company/company.service.ts:384 | Conflict |  | english | This company already has a headquarters (code "${existingHq.code}"). ` + |
| modules/company/company.service.ts:473 | Conflict |  | english | This company already has a headquarters (code "${otherHq.code}")`, |
| modules/company/company.service.ts:483 | BadRequest |  | english | The headquarters cannot have a parent unit', |
| modules/company/company.service.ts:550 | BadRequest |  | english | This unit has sub-units under it. Move or delete them first.', |
| modules/company/company.service.ts:555 | BadRequest |  | english | This unit already has accounting or stock movements. ' + |
| modules/company/company.service.ts:561 | BadRequest |  | english | Users are still assigned to this unit. Unassign them first.', |
| modules/company/company.service.ts:669 | NotFound | BRANCH_NOT_FOUND | coded |  |
| modules/company/company.service.ts:688 | BadRequest |  | english | The headquarters cannot have a parent unit', |
| modules/company/company.service.ts:697 | BadRequest |  | english | A unit cannot be its own parent') |
| modules/company/company.service.ts:703 | BadRequest |  | english | The parent unit does not exist in this company', |
| modules/company/company.service.ts:714 | BadRequest |  | english | This would make the unit its own ancestor. Choose another parent.', |
| modules/company/company.service.ts:738 | BadRequest |  | english | A branch needs a parent unit. Create the headquarters first, or name the parent explicitly.', |
| modules/company/company.service.ts:776 | BadRequest |  | bilingual | يجب أن يكون الشعار صورة PNG أو JPEG أو WebP / The logo must be PNG, JPEG or WebP.', |
| modules/company/company.service.ts:781 | BadRequest |  | bilingual | ملف الشعار فارغ / The logo file is empty.') |
| modules/company/company.service.ts:784 | BadRequest |  | bilingual | حجم الشعار يتجاوز ${Math.round(maxBytes / 1024 / 1024)} ميجابايت / The logo exceeds ${Math.round(maxBytes / 10 |
| modules/company/company.service.ts:792 | BadRequest |  | bilingual | محتوى الملف لا يطابق نوع الصورة. اختر ملف PNG أو JPEG أو WebP حقيقيًا / The file content does not match its im |
| modules/company/company.service.ts:800 | BadRequest |  | bilingual | ملف WebP غير صالح / The file is not a valid WebP image.') |
| modules/company/company.service.ts:852 | BadRequest |  | bilingual | تعذّر فتح الصورة. اختر ملف PNG أو JPEG أو WebP سليمًا / The image could not be decoded.', |
| modules/company/company.service.ts:863 | BadRequest |  | bilingual | يجب أن تكون أبعاد الشعار ٣٢ × ٣٢ بكسل على الأقل، وألا تتجاوز الصورة المتحركة ١٦ مليون بكسل / Use a non-animate |
| modules/company/company.service.ts:888 | BadRequest |  | bilingual | تعذّر ضغط الشعار. اختر صورة صالحة وحاول مرة أخرى / The logo could not be resized.', |
| modules/company/company.service.ts:894 | BadRequest |  | bilingual | تعذّر ضغط الشعار إلى الحجم المسموح. اختر صورة أصغر / The logo remains too large after compression |
| modules/company/setup.service.ts:84 | Conflict |  | english | This installation already contains company or user data. Initial setup is closed |
| modules/company/setup.service.ts:107 | Conflict |  | english | This installation already contains company or user data. Initial setup is closed |

## fixed-assets

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/fixed-assets/fixed-assets.service.ts:121 | BadRequest |  | english | The purchase invoice line does not exist') |
| modules/fixed-assets/fixed-assets.service.ts:136 | BadRequest |  | english | The purchase line belongs to a different invoice than the one given', |
| modules/fixed-assets/fixed-assets.service.ts:159 | BadRequest |  | english | Purchase line on ${line.invoice.invoiceNumber} received ${money(lineCost)} and ` + |
| modules/fixed-assets/fixed-assets.service.ts:170 | BadRequest |  | english | The quantity capitalised from a purchase line must be greater than zero', |
| modules/fixed-assets/fixed-assets.service.ts:175 | BadRequest |  | english | Purchase line on ${line.invoice.invoiceNumber} received ${money(lineQuantity)} unit(s) ` + |
| modules/fixed-assets/fixed-assets.service.ts:248 | Conflict |  | english | An asset with that code already exists') |
| modules/fixed-assets/fixed-assets.service.ts:269 | BadRequest |  | english | Unknown asset status: ${query.status}`) |
| modules/fixed-assets/fixed-assets.service.ts:314 | NotFound | FIXED_ASSET_NOT_FOUND | coded |  |
| modules/fixed-assets/fixed-assets.service.ts:372 | BadRequest |  | english | Only a draft asset can be edited |
| modules/fixed-assets/fixed-assets.service.ts:447 | BadRequest |  | english | Only a draft asset can be deleted |
| modules/fixed-assets/fixed-assets.service.ts:481 | NotFound | FIXED_ASSET_NOT_FOUND | coded |  |
| modules/fixed-assets/fixed-assets.service.ts:482 | BadRequest |  | english | Only a draft asset can be activated (current status: ${asset.status})`, |
| modules/fixed-assets/fixed-assets.service.ts:506 | BadRequest |  | english | The linked purchase invoice no longer exists, so this asset cannot be activated against it', |
| modules/fixed-assets/fixed-assets.service.ts:511 | BadRequest |  | english | Purchase invoice ${invoice.invoiceNumber} is not posted yet. ` + |
| modules/fixed-assets/fixed-assets.service.ts:518 | BadRequest |  | english | This asset came from purchase invoice ${invoice.invoiceNumber}, which already ` + |
| modules/fixed-assets/fixed-assets.service.ts:552 | BadRequest |  | english | This asset is linked to a purchase line but records no quantity to issue from stock', |
| modules/fixed-assets/fixed-assets.service.ts:561 | BadRequest |  | english | The linked purchase line has no stocked item to issue', |
| modules/fixed-assets/fixed-assets.service.ts:585 | BadRequest |  | english | Cannot capitalise from stock: ${money(qtyOnHand)} unit(s) worth ${money(valueOnHand)} ` + |
| modules/fixed-assets/fixed-assets.service.ts:717 | BadRequest |  | english | Nothing to depreciate for ${periodKey}${reasons ? ` — ${reasons}` : ''}`, |
| modules/fixed-assets/fixed-assets.service.ts:816 | Conflict |  | english | Depreciation for ${periodKey} was already recorded for at least one of these assets`, |
| modules/fixed-assets/fixed-assets.service.ts:885 | BadRequest |  | english | Disposal proceeds cannot be negative') |
| modules/fixed-assets/fixed-assets.service.ts:888 | BadRequest |  | english | Name the account that received the proceeds (cash, bank or receivable)', |
| modules/fixed-assets/fixed-assets.service.ts:897 | NotFound | FIXED_ASSET_NOT_FOUND | coded |  |
| modules/fixed-assets/fixed-assets.service.ts:902 | BadRequest |  | english | Only an active asset can be disposed of (current status: ${asset.status})`, |
| modules/fixed-assets/fixed-assets.service.ts:920 | Conflict |  | english | The asset was disposed of by another request') |
| modules/fixed-assets/fixed-assets.service.ts:1215 | BadRequest |  | english | Your session is not attached to a branch, so it cannot own assets or depreciation runs', |
| modules/fixed-assets/fixed-assets.service.ts:1268 | NotFound | FIXED_ASSET_NOT_FOUND | coded |  |
| modules/fixed-assets/fixed-assets.service.ts:1360 | BadRequest |  | english | The ${role} account does not exist in this company`) |
| modules/fixed-assets/fixed-assets.service.ts:1363 | BadRequest |  | english | Account ${account.code} cannot receive postings`) |

## cheques

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/cheques/cheques.service.ts:98 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:101 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:108 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:114 | BadRequest |  | english | The signed-in user is not assigned to a branch') |
| modules/cheques/cheques.service.ts:117 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:127 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:130 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:135 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:138 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:139 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:141 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:143 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:144 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:146 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:150 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:152 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:159 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:161 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:166 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:184 | Conflict | CHEQUE_DUPLICATE | coded |  |
| modules/cheques/cheques.service.ts:203 | NotFound | CHEQUE_NOT_FOUND | coded |  |
| modules/cheques/cheques.service.ts:213 | BadRequest |  | english | direction must be RECEIVED or ISSUED') |
| modules/cheques/cheques.service.ts:220 | BadRequest |  | english | status must be OPEN or one of ' + CHEQUE_STATUSES.join(', ')) |
| modules/cheques/cheques.service.ts:251 | NotFound | CHEQUE_NOT_FOUND | coded |  |
| modules/cheques/cheques.service.ts:256 | Conflict | CHEQUE_STATE | coded |  |
| modules/cheques/cheques.service.ts:261 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:265 | BadRequest | VALIDATION | coded |  |
| modules/cheques/cheques.service.ts:273 | Conflict | CHEQUE_STATE | coded |  |

## master-data-backup

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/master-data-backup/master-data-backup.controller.ts:115 | BadRequest |  | english | Unknown master-data backup type: ${value}.`) |
| modules/master-data-backup/master-data-backup.controller.ts:122 | Forbidden |  | english | Missing permission: ${permission}.`) |
| modules/master-data-backup/master-data-backup.controller.ts:130 | Forbidden |  | english | Restoring ${kind} requires both ${needed[0]} and ${needed[1]}.`, |
| modules/master-data-backup/master-data-backup.service.ts:135 | BadRequest |  | english | This master list is too large for a single backup.') |
| modules/master-data-backup/master-data-backup.service.ts:177 | BadRequest |  | english | Preview the backup before restoring it.') |
| modules/master-data-backup/master-data-backup.service.ts:183 | Conflict |  | english | The backup or destination data changed after preview. Preview it again before restoring.', |
| modules/master-data-backup/master-data-backup.service.ts:188 | Conflict |  | english | Restore stopped without changes: ${plan.conflicts.length} records conflict with deleted records.`, |
| modules/master-data-backup/master-data-backup.service.ts:235 | BadRequest |  | english | The selected file is not a KAYAN master-data backup.') |
| modules/master-data-backup/master-data-backup.service.ts:239 | BadRequest |  | english | Unsupported master-data backup format or version.') |
| modules/master-data-backup/master-data-backup.service.ts:242 | BadRequest |  | english | This is a ${String(archive.kind)} backup, not a ${kind} backup.`) |
| modules/master-data-backup/master-data-backup.service.ts:245 | BadRequest |  | english | This backup belongs to a different company. Nothing was changed.') |
| modules/master-data-backup/master-data-backup.service.ts:251 | BadRequest |  | english | The backup contains unsupported top-level fields.') |
| modules/master-data-backup/master-data-backup.service.ts:254 | BadRequest |  | english | The backup creation date is invalid.') |
| modules/master-data-backup/master-data-backup.service.ts:258 | BadRequest |  | english | The backup record count is invalid or exceeds the safety limit.') |
| modules/master-data-backup/master-data-backup.service.ts:262 | BadRequest |  | english | The master-data backup exceeds the 5 MB restore limit.') |
| modules/master-data-backup/master-data-backup.service.ts:269 | BadRequest |  | english | Record ${index + 1} is not an object.`) |
| modules/master-data-backup/master-data-backup.service.ts:275 | Forbidden |  | english | This backup contains sale prices you are not allowed to restore.') |
| modules/master-data-backup/master-data-backup.service.ts:278 | Forbidden |  | english | This backup contains purchase prices you are not allowed to restore.') |
| modules/master-data-backup/master-data-backup.service.ts:280 | BadRequest |  | english | Record ${index + 1} contains unsupported fields.`) |
| modules/master-data-backup/master-data-backup.service.ts:284 | BadRequest |  | english | Record ${index + 1} has an invalid code.`) |
| modules/master-data-backup/master-data-backup.service.ts:286 | BadRequest |  | english | Code "${code}" appears more than once in the backup.`) |
| modules/master-data-backup/master-data-backup.service.ts:294 | BadRequest |  | english | Record ${index + 1} must include both Arabic and English names.`) |
| modules/master-data-backup/master-data-backup.service.ts:303 | BadRequest |  | english | Record ${index}: ${key} must be true or false.`) |
| modules/master-data-backup/master-data-backup.service.ts:311 | BadRequest |  | english | Record ${index}: ${key} must be a non-negative decimal string.`) |
| modules/master-data-backup/master-data-backup.service.ts:314 | BadRequest |  | english | Record ${index}: taxRate must not exceed 100.`) |
| modules/master-data-backup/master-data-backup.service.ts:320 | BadRequest |  | english | Record ${index}: ${key} must be an integer from 0 to 3650.`) |
| modules/master-data-backup/master-data-backup.service.ts:325 | BadRequest |  | english | Record ${index}: ${key} must be text no longer than ${MAX_TEXT_LENGTH} characters.`) |

## licensing

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/licensing/license.guard.ts:73 | Forbidden |  | bilingual |  |
| modules/licensing/licensing.controller.ts:101 | Forbidden |  | english | Applying a licence key changes the whole installation, so only a super administrator may do it.', |
| modules/licensing/licensing.service.ts:537 | Forbidden | LICENSE_STATE_ID_MISMATCH | coded |  |
| modules/licensing/licensing.service.ts:739 | Forbidden | LICENSE_KEY_WRONG_TYPE | coded |  |
| modules/licensing/licensing.service.ts:750 | Forbidden | LICENSE_KEY_FUTURE | coded |  |
| modules/licensing/licensing.service.ts:761 | Forbidden | LICENSE_KEY_WRONG_MACHINE | coded |  |
| modules/licensing/licensing.service.ts:773 | Forbidden |  | english |  |
| modules/licensing/licensing.service.ts:782 | Forbidden |  | english |  |
| modules/licensing/licensing.service.ts:791 | Forbidden | LICENSE_KEY_WRONG_MACHINE | coded |  |
| modules/licensing/licensing.service.ts:800 | Forbidden | LICENSE_KEY_WRONG_LICENSE | coded |  |
| modules/licensing/licensing.service.ts:811 | Forbidden |  | english |  |
| modules/licensing/licensing.service.ts:827 | Forbidden | LICENSE_NOT_INSTALLED | coded |  |
| modules/licensing/licensing.service.ts:834 | Forbidden | LICENSE_KEY_INCOMPLETE | coded |  |
| modules/licensing/licensing.service.ts:880 | Forbidden | LICENSE_KEY_WRONG_TYPE | coded |  |
| modules/licensing/licensing.service.ts:951 | Forbidden |  | english |  |
| modules/licensing/licensing.service.ts:1057 | Forbidden | LICENSE_SEATS_BELOW_USED | coded |  |
| modules/licensing/licensing.service.ts:1091 | Forbidden | LICENSE_SEATS_BELOW_USED | coded |  |
| modules/licensing/licensing.service.ts:1174 | BadRequest |  | english | The licence identifier is not valid.') |
| modules/licensing/licensing.service.ts:1183 | Forbidden | LICENSE_NOT_FOUND_FOR_COMPANY | coded |  |
| modules/licensing/licensing.service.ts:1191 | Forbidden | LICENSE_KEY_WRONG_MACHINE | coded |  |
| modules/licensing/licensing.service.ts:1235 | Forbidden | LICENSE_SEATS_EXHAUSTED | coded |  |
| modules/licensing/licensing.service.ts:1498 | Forbidden | LICENSE_RECONCILE_STALE | coded |  |
| modules/licensing/licensing.service.ts:1555 | Forbidden | LICENSE_NOT_INSTALLED | coded |  |
| modules/licensing/licensing.service.ts:1561 | Forbidden | LICENSE_KEY_WRONG_MACHINE | coded |  |
| modules/licensing/licensing.service.ts:1571 | Forbidden | LICENSE_CLOCK_STILL_BEHIND | coded |  |

## export

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/export/documents.service.ts:77 | BadRequest |  | english | Unknown document "${kind}". Known: ${DOCUMENT_KINDS.join(', ')}.`, |
| modules/export/documents.service.ts:128 | NotFound | STOCK_VOUCHER_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:184 | NotFound | SALES_INVOICE_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:245 | NotFound | PURCHASE_INVOICE_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:303 | NotFound | SALES_ORDER_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:352 | NotFound | PURCHASE_ORDER_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:411 | NotFound | QUOTATION_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:535 | NotFound | CASH_VOUCHER_NOT_FOUND | coded |  |
| modules/export/documents.service.ts:595 | NotFound | JOURNAL_ENTRY_NOT_FOUND | coded |  |
| modules/export/export.controller.ts:243 | BadRequest |  | english | Unknown format "${query.format}". Use format=xlsx or format=csv.`, |
| modules/export/export.controller.ts:329 | Forbidden |  | english | Missing permission: ${permission}`) |
| modules/export/export.controller.ts:340 | Forbidden |  | english | Missing permission: ${exportPermission}`) |
| modules/export/export.controller.ts:351 | Forbidden |  | english | Missing permission: ${permission ?? `reports.${report}.read`}`) |
| modules/export/export.controller.ts:385 | BadRequest |  | english | Unknown format "${wanted}". Use format=xlsx or format=csv.`, |
| modules/export/export.controller.ts:448 | Forbidden |  | english | Missing permission: reports.print') |
| modules/export/export.controller.ts:471 | BadRequest |  | english | Unknown report "${report}". Known reports: ${EXPORTABLE_REPORTS.join(', ')}.`, |
| modules/export/list-tables.service.ts:98 | BadRequest |  | english | Unknown list "${slug}". Known lists: ${LIST_SLUGS.join(', ')}.`, |
| modules/export/list-tables.service.ts:170 | BadRequest |  | english | The stock ledger needs itemId, the item whose movements are wanted.', |
| modules/export/list-tables.service.ts:178 | BadRequest |  | english | The item does not exist') |
| modules/export/pdf.service.ts:57 | UnprocessableEntity |  | english | This server has no browser installed, so it cannot make a PDF by itself. ' + |
| modules/export/pdf.service.ts:194 | UnprocessableEntity |  | english | The report could not be turned into a PDF on this machine. ' + |
| modules/export/report-tables.service.ts:391 | BadRequest |  | english | The account ledger needs an account: pass accountId.', |
| modules/export/report-tables.service.ts:1007 | BadRequest |  | english | A party statement needs a partner: pass partyId and kind.', |

## reports

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/reports/financial-statements.service.ts:16 | BadRequest |  | english | "from" must not be after "to"') |
| modules/reports/operations-reports.service.ts:40 | BadRequest |  | english | "from" must not be after "to"') |
| modules/reports/operations-reports.service.ts:49 | BadRequest |  | english | status must be DRAFT, POSTED, REVERSED or ALL') |
| modules/reports/operations-reports.service.ts:305 | BadRequest |  | english | kind must be RECEIPT, PAYMENT or ALL') |
| modules/reports/operations-reports.service.ts:453 | BadRequest |  | english | kind must be sales or purchases') |
| modules/reports/party-reconciliation.service.ts:66 | NotFound |  | english | Control account ${controlCode} does not exist in this company's chart`, |
| modules/reports/reports.controller.ts:170 | BadRequest |  | english | costCenterId must be a UUID or "unallocated"') |
| modules/reports/reports.controller.ts:188 | Forbidden |  | english | Company-wide budget figures are restricted to company and finance managers.') |
| modules/reports/reports.service.ts:32 | BadRequest |  | english | "${field}" must be an ISO date or timestamp`) |
| modules/reports/reports.service.ts:42 | BadRequest |  | english | "${field}" must be a valid calendar date`) |
| modules/reports/reports.service.ts:47 | BadRequest |  | english | "${field}" must be a valid date`) |
| modules/reports/reports.service.ts:58 | BadRequest |  | english | "from" must not be after "to"') |
| modules/reports/reports.service.ts:515 | NotFound |  | english | The account does not exist in this company') |
| modules/reports/vat-return.service.ts:65 | BadRequest |  | english | Dates must be YYYY-MM-DD') |
| modules/reports/vat-return.service.ts:66 | BadRequest |  | english | "from" must not be after "to"') |

## import

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/import/import.controller.ts:113 | Forbidden |  | bilingual | ليس لديك صلاحية تعديل السجلات الموجودة بالاستيراد (${needed}). ` + |
| modules/import/import.controller.ts:122 | BadRequest |  | english | No file arrived. Choose a .xlsx or .csv file and try again.', |
| modules/import/import.controller.ts:136 | BadRequest |  | english | Unknown import "${value}". Known imports: ${IMPORT_KINDS.join(', ')}.`, |
| modules/import/import.controller.ts:146 | Forbidden |  | bilingual | ليس لديك صلاحية استخدام هذا الاستيراد (${needed.join(' or ')}). ` + |
| modules/import/import.service.ts:509 | BadRequest |  | english | Unknown import "${kind}". Known imports: ${IMPORT_KINDS.join(', ')}.`, |
| modules/import/import.service.ts:514 | BadRequest |  | english | No file was uploaded.') |
| modules/import/import.service.ts:524 | BadRequest |  | english |  |
| modules/import/import.service.ts:567 | BadRequest |  | english |  |
| modules/import/import.service.ts:577 | BadRequest |  | english | The file contains multiple tax rate columns. Keep only one.') |
| modules/import/import.service.ts:1063 | BadRequest |  | english | An account parent changed while this workbook was being imported. Read it again and retry.') |
| modules/import/import.service.ts:1068 | BadRequest |  | english | Account code "${row.code}" changed while this workbook was being imported. Read it again and retry.`) |
| modules/import/import.service.ts:1110 | BadRequest |  | english | Parent account "${row.parentCode}" already has ledger movements and cannot become a grouping account. Nothing  |
| modules/import/import.service.ts:1122 | BadRequest |  | english | The parent hierarchy changed or contains an unresolved cycle. Nothing was imported.') |

## auth

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/auth/auth.service.ts:97 | Unauthorized |  | english | Account temporarily locked after repeated failed sign-ins', |
| modules/auth/auth.service.ts:215 | BadRequest |  | english | New password confirmation does not match') |
| modules/auth/auth.service.ts:266 | BadRequest |  | english | New password must differ from the current password') |
| modules/auth/auth.service.ts:339 | Unauthorized |  | english | Invalid or expired refresh token') |
| modules/auth/auth.service.ts:352 | Unauthorized |  | english | Account is inactive') |
| modules/auth/auth.service.ts:364 | Unauthorized |  | english | Invalid or expired refresh token') |
| modules/auth/auth.service.ts:424 | Unauthorized |  | english | Account or session is inactive or unavailable') |
| modules/auth/profile-photo.controller.ts:16 | Forbidden |  | english | The signed-in user changed |
| modules/auth/profile-photo.controller.ts:30 | BadRequest |  | english | No photo file was uploaded') |
| modules/auth/profile-photo.service.ts:36 | NotFound | USER_NOT_FOUND | coded |  |
| modules/auth/profile-photo.service.ts:38 | NotFound | USER_PHOTO_NOT_FOUND | coded |  |
| modules/auth/profile-photo.service.ts:62 | NotFound | USER_NOT_FOUND | coded |  |

## serials

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/serials/serials.service.ts:28 | BadRequest |  | english |  |
| modules/serials/serials.service.ts:101 | NotFound | SERIAL_NOT_FOUND | coded |  |
| modules/serials/serials.service.ts:146 | Conflict | SERIAL_DUPLICATE | coded |  |
| modules/serials/serials.service.ts:167 | Conflict | SERIAL_DUPLICATE | coded |  |
| modules/serials/serials.service.ts:207 | BadRequest | SERIAL_NOT_FOUND | coded |  |
| modules/serials/serials.service.ts:212 | BadRequest | SERIAL_TOO_MANY | coded |  |
| modules/serials/serials.service.ts:222 | Conflict | SERIAL_STATE | coded |  |
| modules/serials/serials.service.ts:246 | NotFound | SERIAL_NUMBER_NOT_FOUND | coded |  |
| modules/serials/serials.service.ts:251 | Conflict | SERIAL_STATE | coded |  |

## commissions

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/commissions/commissions.service.ts:10 | BadRequest |  | english |  |
| modules/commissions/commissions.service.ts:65 | Conflict | REP_DUPLICATE | coded |  |
| modules/commissions/commissions.service.ts:77 | NotFound | REP_NOT_FOUND | coded |  |
| modules/commissions/commissions.service.ts:86 | Conflict | REP_DUPLICATE | coded |  |
| modules/commissions/commissions.service.ts:108 | Conflict | COMMISSION_EXISTS | coded |  |
| modules/commissions/commissions.service.ts:142 | NotFound | COMMISSION_NOT_FOUND | coded |  |
| modules/commissions/commissions.service.ts:143 | Conflict | COMMISSION_PAID | coded |  |
| modules/commissions/commissions.service.ts:147 | Conflict | COMMISSION_HAS_RETURN | coded |  |

## invoicing

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/invoicing/invoice-discount.ts:35 | BadRequest |  | english | Choose either a percentage discount or a fixed discount, not both') |
| modules/invoicing/invoice-discount.ts:38 | BadRequest |  | english | discountPercent must be between 0 and 100') |
| modules/invoicing/invoice-discount.ts:46 | BadRequest |  | english | discountAmount cannot exceed the invoice subtotal') |
| modules/invoicing/invoice-discount.ts:49 | BadRequest |  | english | A percentage discount requires a non-zero subtotal') |
| modules/invoicing/invoice-discount.ts:113 | BadRequest |  | english | ${field} is not a valid number`) |
| modules/invoicing/invoice-discount.ts:115 | BadRequest |  | english | ${field} cannot be negative`) |

## parties

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/parties/parties.service.ts:125 | NotFound |  | english | ${kind} not found`) |
| modules/parties/parties.service.ts:370 | NotFound |  | english | ${kind} not found`) |
| modules/parties/parties.service.ts:447 | NotFound |  | english | ${kind} not found`) |
| modules/parties/parties.service.ts:670 | Conflict |  | english | ${kind} code ${code} is already used`) |
| modules/parties/parties.service.ts:724 | NotFound |  | english | ${kind} not found`) |
| modules/parties/parties.service.ts:795 | NotFound |  | english | ${kind} not found`) |

## notifications

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/notifications/notification-kinds.ts:312 | BadRequest |  | english | Unknown notification type: ${type}`) |
| modules/notifications/notifications.controller.ts:184 | BadRequest |  | english | days must be an integer between 1 and 3650') |
| modules/notifications/notifications.service.ts:362 | BadRequest |  | english | days must be an integer between 1 and 3650') |
| modules/notifications/notifications.service.ts:500 | NotFound | NOTIFICATION_NOT_FOUND | coded |  |
| modules/notifications/notifications.service.ts:503 | NotFound | NOTIFICATION_NOT_FOUND | coded |  |
| modules/notifications/notifications.service.ts:598 | NotFound |  | english | Unknown severity: ${dto.severity}`) |

## withholding

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/withholding/withholding.service.ts:40 | BadRequest |  | english |  |
| modules/withholding/withholding.service.ts:105 | Conflict | WITHHOLDING_RATE_DUPLICATE | coded |  |
| modules/withholding/withholding.service.ts:116 | NotFound | WITHHOLDING_RATE_NOT_FOUND | coded |  |
| modules/withholding/withholding.service.ts:125 | Conflict | WITHHOLDING_RATE_IN_USE | coded |  |
| modules/withholding/withholding.service.ts:147 | NotFound | VOUCHER_NOT_FOUND | coded |  |
| modules/withholding/withholding.service.ts:149 | Conflict | WITHHOLDING_VOUCHER_POSTED | coded |  |

## installments

| file:line | kind | code | status | sentence start |
|---|---|---|---|---|
| modules/installments/installments.service.ts:10 | BadRequest |  | english |  |
| modules/installments/installments.service.ts:42 | NotFound | INVOICE_NOT_FOUND | coded |  |
| modules/installments/installments.service.ts:73 | NotFound | PLAN_NOT_FOUND | coded |  |
| modules/installments/installments.service.ts:111 | NotFound | PLAN_NOT_FOUND | coded |  |
