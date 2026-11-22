# FINAL_REVIEW_DIFF — تقرير مراجعة كامل

**الفرع:** `arena/56e71924-erp-kayan` @ `d3f62e9`
**تاريخ التقرير:** 2026-11-07
**العمليات المنفَّذة:** قراءة فقط. لا commit، لا push، لا merge، لا تغيير فرع، لا حذف، لا تعديل أي ملف.

---

## ⚠️ 0. اقرأ هذا أولًا: التعديلات التي طلبتَ مراجعتها لم تعد موجودة

طلبك كان «أتيح التعديلات الحالية للمراجعة دون تغييرها». قبل أن أكتب أي شيء فتحتُ الشجرة،
وهذا ما وجدته:

**العمل الذي وصفته في الرسالة السابقة (110 ملفًا، منها 20 ملفًا في `lib/`) لم يعد موجودًا
على القرص ولا في Git.**

### البرهان

| الفحص | النتيجة |
|---|---|
| `git status --porcelain -uall` | **73** ملفًا فقط، وكلها تحت `backend/` |
| أي ملف تحت `lib/` أو `test/` في التغييرات | **صفر** |
| `git diff --stat HEAD -- lib/ test/` | **فارغ** — الشجرة الأمامية مطابقة تمامًا لكوميت `d3f62e9` |
| `lib/core/units/item_units.dart` | **غير موجود** |
| `lib/features/inventory/presentation/widgets/item_units_editor.dart` | **غير موجود** |
| `lib/features/data/presentation/widgets/print_visibility_prompt.dart` | **غير موجود** |
| 9 شاشات مخزون منقولة | **غير موجودة** (المجلد فيه 3 ملفات فقط: items, stock, stock_vouchers) |
| مسارات المخزون التسعة في `app_router.dart` | **صفر** |
| `lib/l10n/generated/*` مقابل HEAD | **غير معدَّلة** (الـ15 مفتاحًا التي أضفتها ذهبت) |
| تعديلات `items_screen.dart` (`onSubmitted`, `_saveWithUnits`, `_refreshAfterUncertainWrite`) | **صفر** — الملف مطابق لـ HEAD |
| `lib/features/settings/data/print_settings_data_source.dart` | **غير موجود** |
| `git stash list` | فارغ |
| `git reflog` | سجلّان فقط: `clone` ثم `checkout` إلى هذا الفرع. **لا commit عالق ولا شيء يمكن استرجاعه** |
| `git fsck --lost-found` | لا commits معلّقة |
| نسخة أخرى على القرص (`/home/user`, `/tmp`) | **لا شيء** |

كذلك ملف `FINAL_REPORT_PR67_PORT.md` الذي كتبته في الرسالة السابقة **غير موجود** في المشروع.

### ما معنى هذا

كل العمل الأمامي (منفذ PR67) **مفقود وغير قابل للاسترجاع من هذه البيئة**. ما بقي محفوظًا هو
العمل الخلفي فقط (Backend)، وهو الجزء الذي كان مُختبَرًا فعليًا.

**لم أقم بأي عملية حذف أو استرجاع.** أنا لا أعرف سبب الاختفاء، ولا أدّعي معرفته؛ الأرجح أن
جلسة العمل لم تُثبَّت تغييراتها على القرص بين الرسالتين — لكن هذا تخمين لا برهان. الذي أثبته
بالأدلة أعلاه هو **الحالة**، لا السبب.

### أثر ذلك على هذا التقرير

طلبت «Diff لجميع الملفات الـ110». لا يوجد 110 ملفًا لأعرضها. لذلك:

* هذا التقرير يغطي **الـ73 ملفًا الموجودة فعليًا**، بدقتها الكاملة.
* قسم خاص يوثّق **الـ37 ملفًا المفقود** بالاسم، اعتمادًا على ما وثّقته في الرسالة السابقة
  وذاكرة الجلسة — وبوضوح على أنه **سجل تاريخي لا diff قابل للمراجعة**، لأن الملفات نفسها لم
  تبقَ لأُقارنها.
* القسم الخاص بـ«الملفات المحمية الثلاثة» و«عروض الأسعار» مُجاب عنه بصراحة، مع تصحيح فهم
  كان خاطئًا لديّ (القسم 3).

---

## 1. حصيلة التغييرات الفعلية

| | العدد |
|---|---|
| إجمالي الملفات في التغيير | **73** |
| معدَّلة (`M`) | **28** |
| جديدة غير متتبَّعة (`??`) | **45** |
| محذوفة | **0** |
| إجمالي الأسطر المضافة (المعدَّلة) | 2,865 |
| إجمالي الأسطر المحذوفة (المعدَّلة) | 534 |
| حجم الـ diff النصي للمعدَّلة | ≈ 224 KB |
| حجم الملفات الجديدة | ≈ 494 KB، 14,000+ سطر |

**كل الملفات الـ73 تحت `backend/`. لا يوجد أي ملف أمامي (Flutter/Dart) في التغيير.**

---

## 2. الملفات المعدَّلة (28)

| # | الملف | الحالة | +/− | ملخص التغيير الفعلي |
|---|---|---|---|---|
| 1 | `backend/prisma/migrations/20261104140000_stock_voucher_workflow/migration.sql` | M | +29/−8 | جُعلت idempotent: كل `ADD CONSTRAINT` و`CREATE INDEX` صار محميًا بفحص وجود، فإعادة تشغيلها على قاعدة شُغِّلت عليها لا تفشل. |
| 2 | `backend/prisma/permissions.ts` | M | +27/−0 | 21 صلاحية جديدة: 5 للدفعات (`inventory.batches.*`)، 5 للجرد (`inventory.stocktake.*`)، 4 للإعدام (`inventory.writeoff.*`)، 2 لصلاحيات المخازن (`inventory.warehouse.access.*`)، 2 للتنبيهات (`notifications.*`). |
| 3 | `backend/prisma/schema.prisma` | M | +555/−2 | 11 موديلًا جديدًا: `StorageLocation`, `ItemWarehouseSetting`, `ItemBatch`, `ItemCostHistory`, `WarehouseStockBalance`, `UserWarehouseAccess`, `StockTakeSession`, `StockTakeLine`, `Notification`, `NotificationSetting`, `PrintPriceSetting` + علاقاتها على `Item`/`Warehouse`/`User`. |
| 4 | `backend/src/app.module.ts` | M | +2/−0 | تسجيل `PrintSettingsModule` في التطبيق. |
| 5 | `backend/src/common/decorators/current-user.decorator.ts` | M | +23/−0 | إضافة `canReadCost(user)` — نقطة واحدة تقرأ `inventory.cost.read` بدل تكرارها في كل controller. |
| 6 | `backend/src/common/guards/jwt-auth.guard.spec.ts` | M | +24/−1 | اختبارات للـ guard بعد إضافة مسار التحقق من صلاحية المخزن. |
| 7 | `backend/src/common/guards/jwt-auth.guard.ts` | M | +33/−0 | الحارس صار يستدعي فحص صلاحية المخزن/الفرع لما بعد المصادقة. |
| 8 | `backend/src/common/units/unit-math.ts` | M | +113/−0 | `movementUnitSnapshot` وتحويلات الوحدة↔الوحدة الأساسية: الرقم المخزَّن يبقى بالوحدة الأساسية، والوحدة المُدخلة تُحفظ كـ snapshot على الحركة. |
| 9 | `backend/src/common/warehouse/warehouse.module.ts` | M | +3/−2 | تصدير الخدمات الجديدة للوحدات التي تحتاجها. |
| 10 | `backend/src/common/warehouse/warehouse.service.ts` | M | +311/−6 | منطق المخزن: النطاق (scope)، الرصيد لكل مخزن، وقراءة حساسة للتاريخ (date-aware). |
| 11 | `backend/src/modules/accounting/posting.service.ts` | M | +6/−0 | الترحيل يمرّر بيانات الوحدة إلى قيد المخزون. |
| 12 | `backend/src/modules/inventory/cost-redaction.spec.ts` | M | +3/−6 | تحديث الاختبار ليطابق `canReadCost` الموحّد. |
| 13 | `backend/src/modules/inventory/dto/item.dto.ts` | M | +37/−0 | `ItemUnitRowDto` (صف تعبئة كامل) و`units[]` على Create/Update Item. |
| 14 | `backend/src/modules/inventory/inventory-reports.service.ts` | M | +146/−1 | كتالوج الـ20 تقريرًا + `listUnits`/`addUnit`/`updateUnit`/`removeUnit`. |
| 15 | `backend/src/modules/inventory/inventory.module.ts` | M | +35/−1 | تسجيل الـ controllers والخدمات الجديدة (batches, stock-takes, locations, analysis, print, warehouse-access, item-warehouse-settings). |
| 16 | `backend/src/modules/inventory/item-tax-blank.spec.ts` | M | +4/−3 | تثبيت أن `''`/`'   '`/`null` تُخزَّن `'0'`، وأن الحذف الكامل لا يلمس القيمة التاريخية. |
| 17 | `backend/src/modules/inventory/item-tax-http.spec.ts` | M | +4/−3 | نفس القاعدة على مستوى HTTP. |
| 18 | `backend/src/modules/inventory/items.barcode.spec.ts` | M | +2/−37 | تقليص الاختبار: منطق الباركود انتقل إلى وحدة الوحدات، فلم يبقَ ما يُختبر هنا. |
| 19 | `backend/src/modules/inventory/items.controller.ts` | M | +2/−0 | تعليق يوجِّه أن مسارات `items/:id/units` يملكها `InventoryReportsController` — مسؤول واحد لكل مسار، بلا تسجيل مزدوج. |
| 20 | `backend/src/modules/inventory/items.service.spec.ts` | M | +26/−21 | مواءمة الاختبارات مع `parseUnitRows`/`planUnitChanges`. |
| 21 | `backend/src/modules/inventory/items.service.ts` | M | +425/−63 | كتابة الصنف ووحداته في transaction واحد، استنتاج الوحدة الأساسية، ومنع صنف بوحدتين أساسيتين. |
| 22 | `backend/src/modules/inventory/stock-documents.controller.ts` | M | +83/−8 | مسارات المستندات: تحويل، استلام، صرف، إعدام، عكس، مع حارس المخزن. |
| 23 | `backend/src/modules/inventory/stock-documents.service.ts` | M | +866/−357 | أكبر تغيير منطقي: الدفعات (lots) على المستند، الوحدات، الرصيد لكل مخزن، والإعدام. |
| 24 | `backend/src/modules/inventory/stock-documents.units.spec.ts` | M | +1/−2 | مواءمة. |
| 25 | `backend/src/modules/inventory/stock-documents.warehouse-guard.spec.ts` | M | +12/−1 | إثبات أن مستندًا لمخزن خارج نطاق المستخدم يُرفَض. |
| 26 | `backend/src/modules/inventory/stock-voucher-edit.spec.ts` | M | +1/−1 | مواءمة توقيع. |
| 27 | `backend/src/modules/inventory/stock-voucher-search.spec.ts` | M | +1/−1 | مواءمة توقيع. |
| 28 | `backend/src/modules/inventory/warehouses.controller.ts` | M | +91/−10 | المخازن: إنشاء/تعديل/تعطيل + المواقع (locations) المرتبطة بها. |

---

## 3. الملفات «المحمية الثلاثة» — تصحيح مهم

**السؤال:** هل تغيّر أي من الملفات المحمية الثلاثة؟

بحثتُ في المشروع عن تعريف هذه الملفات. النتيجة:

* **لا يوجد في المستودع أي تعريف لـ«ملفات محمية ثلاثة»** — لا في `README`، ولا في `docs/`،
  ولا في أي ملف تعليمات (لا `.cursorrules` ولا `AGENTS.md` ولا ما شابه).
* العبارة الوحيدة القريبة في `PROJECT_KNOWLEDGE.md` تقول: «الـ**ثلاثة ملفات** تحت
  `lib/l10n/generated/` تُنتجها مولّد Flutter و**يجب ألّا تُصان يدويًا**». أي أن «الثلاثة»
  في هذا المستودع تشير إلى **ملفات l10n المولّدة**، لا إلى ملفات محمية بالمعنى الأمني.

**إجابتي على الحالتين:**

| التفسير | الحالة |
|---|---|
| ملفات l10n المولّدة الثلاثة (`app_localizations.dart`, `_en`, `_ar`) | **لم تتغيّر.** `git diff HEAD -- lib/l10n/` فارغ — لأن تعديلاتها (15 مفتاحًا) اختفت مع باقي العمل الأمامي (القسم 0). |
| أي مجموعة أخرى تقصدها | **لا أستطيع تأكيدها**، ولن أخمّن. إن كانت لديك القائمة، أعطني الأسماء وأتحقق منها سطرًا بسطر. |

لم أعدّل أي ملف من الـ73 بيدي في هذه الجلسة، ولم أحذف شيئًا، فكل ملف — محميًّا كان أو لا —
بحالته التي وجدته عليها.

---

## 4. التغييرات المتعلقة بعروض الأسعار (Quotations)

**النتيجة: صفر. لا يوجد أي ملف يخص عروض الأسعار في التغيير.**

* `git status` مصفّى على `quot` → **لا نتائج**.
* كل الـ73 ملفًا تحت `backend/`، ولا واحد منها في مسار عروض الأسعار.
* لا تغيير في `quotation*` ولا في خدمة/controller عروض الأسعار ولا في تصميمها.
* ولا حتى بشكل غير مباشر: `posting.service.ts` تغيّر بـ+6 أسطر تخص تمرير الوحدة إلى قيد
  المخزون، لا علاقة لها بعروض الأسعار.

الملفات الوحيدة المتعلقة بالعروض في المستودع هي ملفات هجرة قديمة (2026-10) **غير ملموسة**.

---

## 5. الملفات الجديدة (45)

### 5.1 هجرات قاعدة البيانات (4 موجودة، والخامسة ضاعت)

| الملف | الأسطر | المحتوى |
|---|---|---|
| `.../20261101103000_print_price_settings/` | 20 | جدول سياسة إظهار الأسعار في الطباعة |
| `.../20261101150000_warehouse_batches_notifications/` | 395 | الدفعات + التنبيهات + إعداداتها |
| `.../20261101190000_warehouse_average_stock_take_writeoffs/` | 329 | `warehouse_stock_balances`, `user_warehouse_access`, `stock_take_sessions` + الـbackfill |
| `.../20261101200000_grant_warehouse_permissions/` | 147 | منح صلاحيات المخازن للأدوار القائمة |
| `.../20261106120000_writeoff_approval_check/` | — | **غير موجودة.** ذُكرت في قائمتي السابقة، وتحقيقي الآن يقول إنها **ليست على القرص أصلًا** (لا في قائمة `??` ولا في `ls` للمجلد). ضاعت هي أيضًا. |

### 5.2 طبقة `common/` (9)

`print-settings.{ts,controller,service,module,spec}` (655 سطرًا) · `warehouse/batch-policy.{ts,spec}` (634) · `warehouse/stock-ledger.service.{ts,spec}` (756) · `warehouse/warehouse-access.ts` (103) · `warehouse/warehouse-scope.spec.ts` (269)

### 5.3 وحدات المخزون (28)

الدفعات `batches.{controller,service}` (1,645) · تحليل التقارير `inventory-analysis.{controller,service,spec}` (1,105) · الطباعة `inventory-print.{controller,spec,ts}` (1,028) · إعدادات الصنف/المخزن `item-warehouse-settings.{controller,service,spec}` (520) · الوحدات `items-units.spec` (458) · المواقع `locations.controller` (85) · مستندات المخزون، 3 ملفات اختبار (766) · فروق الجرد `stock-take-variance.spec` (130) · الجرد `stock-takes.{controller,service,spec}` (1,232) · المواقع المخزنية `storage-locations.service.{ts,spec}` (1,169) · إدخال الوحدات `unit-input.{ts,spec}` (499) · صلاحيات المخازن `warehouse-access.{controller,service,spec,routes.spec}` (635) · `warehouses.http.spec` (230)

### 5.4 الاختبارات المساعدة (1)

`backend/src/testing/stock-ledger.fake.ts` (142) — بديل قابل للتحكم لدفتر المخزون في الاختبارات.

---

## 6. نتائج الاختبارات الفعلية

### 6.1 ما شُغِّل فعلًا ونجح (Backend)

| الأمر | النتيجة | متى |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **نظيف**، exit 0 | هذه الجلسة، بعد آخر تعديل |
| `npx jest --silent` | **1446 نجح**، 8 متخطّى — 156 suite نجحت، 1 متخطّاة | هذه الجلسة |
| `npm run build` (`nest build`) | **نجح** | هذه الجلسة |
| `npm run test:integration:pg` | **35/35 فحصًا نجح على PostgreSQL حقيقي (PGlite)** | هذه الجلسة |
| `npx prisma validate` | المخطط صالح | سابقًا في الجلسة |
| إعادة تشغيل هجرتَي مستندات المخزون مرتين | idempotent، بلا خطأ | سابقًا في الجلسة |

> هذه النتائج تخص **الـ73 ملفًا الخلفية الموجودة الآن**، وهي سارية.

### 6.2 ما لم يُختبَر إطلاقًا

| البند | السبب |
|---|---|
| **`flutter analyze`** | **لم يُشغَّل ولو مرة في هذه الجلسة كلها** |
| **`flutter test`** | لم يُشغَّل — **والآن لا يوجد ما يُختبر**: الاختبارات الأمامية الخمسة المنقولة مفقودة مع باقي العمل |
| **`flutter build windows` / `web`** | لم يُشغَّل |
| أي اختبار واجهة (widget test) | لا شيء |
| `flutter gen-l10n` | غير متاح (يحتاج SDK) |

**سبب عدم تشغيل أي أمر Flutter:** الـ SDK غير مثبَّت في هذه البيئة، وتنزيله فشل بـ
`SSL_ERROR_SYSCALL` على `storage.googleapis.com:443`. هذا قيد بيئة، وليس اختيارًا.

### 6.3 الاختبارات التي كانت مكتوبة ولم تُشغَّل قط — **ومفقودة الآن**

خمسة اختبارات نقلتها من PR67 إلى `test/widget/`: `stock_documents_screen_test`,
`inventory_reports_screen_test`, `print_visibility_prompt_test`, `item_units_dialog_test`,
`invoice_unit_display_test`. **لم تُشغَّل ولو مرة، وهي الآن غير موجودة** (القسم 0).
كانت مبرَّرة بفحص يدوي للـ keys والنصوص، وهو دليل ضعيف بطبيعته.

### 6.4 ما أُثبت بالفحص الثابت (وقت وجود الملفات)

167 نقطة نداء أمامية ↔ 244 شكل مسار خلفي: 0 تعارض · 0 استيراد غير محلول · 0 رمز `show`
معلّق · 0 مفتاح l10n مجهول · 0 كود صلاحية مجهول · 0 token تصميم مفقود · 0 وسيط widget غير
معلَن. **هذه القياسات كانت على ملفات لم تعد موجودة، فلا تنطبق على الشجرة الحالية.** أذكرها
للسجل فقط، وليست شهادة على شيء قائم.

---

## 7. الملفات المفقودة — سجل تاريخي (37 ملفًا)

هذه قائمة العمل الأمامي الذي وثّقته في الرسالة السابقة ولم يبقَ له أثر. **لا أستطيع تقديم diff
لها** لأن نسخها غير موجودة؛ ما دونته سابقًا هو الوصف، لا المحتوى. أضعها هنا كي تعرف بالضبط ما
يجب إعادة تنفيذه إن أردت المتابعة.

**جديدة (20):**
`lib/core/units/item_units.dart` · `lib/features/data/presentation/widgets/print_visibility_prompt.dart` ·
`lib/features/inventory/presentation/widgets/item_units_editor.dart` ·
`lib/features/inventory/presentation/screens/{batches, inventory_reports, item_thresholds,
stock_documents, stock_takes, storage_locations, warehouse_access, warehouses, write_offs}_screen.dart` (9) ·
`lib/features/settings/data/print_settings_data_source.dart` ·
`lib/features/settings/presentation/providers/print_settings_providers.dart` ·
`test/widget/{stock_documents_screen, inventory_reports_screen, print_visibility_prompt,
item_units_dialog, invoice_unit_display}_test.dart` (5)

**معدَّلة (17):**
`lib/app/router/app_router.dart` · `lib/app/shell/erp_shell.dart` ·
`lib/features/data/presentation/providers/data_providers.dart` ·
`lib/features/data/presentation/widgets/{document_export_actions, export_actions,
list_export_actions, price_visibility_dialog}.dart` ·
`lib/features/inventory/presentation/providers/stock_providers.dart` ·
`lib/features/inventory/presentation/screens/{items_screen, stock_screen}.dart` ·
`lib/features/invoicing/presentation/screens/invoice_editor_screen.dart` ·
`lib/shared/widgets/{form_sheet, records_table}.dart` ·
`lib/l10n/{app_en.arb, app_ar.arb}` · `lib/l10n/generated/app_localizations{,_en,_ar}.dart` (3)

**محذوف (1):** `lib/shared/widgets/user_avatar.dart` — كان حذفًا مقصودًا لأنه يحتاج
`ApiClient.getBytes`/`uploadFile` غير الموجودين. **الملف الآن موجود** لأن الحذف ضاع أيضًا مع
باقي العمل.

---

## 8. المخاطر

1. **الخطر الأول هو فقدان العمل نفسه**، لا أي عيب تقني. كل ما يخصّ الواجهة يجب إعادة تنفيذه.
2. **Git نظيف من ناحية الواجهة**: الشجرة الأمامية مطابقة لكوميت `d3f62e9` حرفيًا، فليس هناك
   نصف عمل ولا حالة هجينة — لكن هذا يعني أيضًا أن **PR67 غير منقول في هذه الشجرة بأي شكل**.
3. **العمل الخلفي سليم ومُختبَر** (القسم 6.1)، وهو الجزء الأكبر والأخطر منطقيًا
   (`stock-documents.service.ts` +866/−357).
4. **92 سطرًا/دقيقة شهادة**: النتائج في 6.1 صحيحة للشجرة الحالية. أي تغيير لاحق في `backend/`
   يبطلها.
5. **هجرة `20261106120000_writeoff_approval_check` مفقودة** هي أيضًا (تحقّقت: ليست على
   القرص ولا في Git). معنى ذلك أن القيد الضيّق الذي كان يمنع اعتماد الإعدام دون صلاحية
   **غير موجود في هذه الشجرة** — وهذا فرق سلوكي حقيقي في قاعدة البيانات، لا مجرد ملف ناقص.
   ذُكرت في 5.1.

---

## 9. ملفات هذا التقرير

* `FINAL_REVIEW_DIFF.md` — هذا الملف، أُضيف إلى جذر المشروع.
* **لم يُنشأ أي ملف آخر، ولم يُعدَّل أي ملف قائم.**

---

## 10. ما أحتاجه منك للمتابعة

1. **هل تريد إعادة تنفيذ نقل PR67 للواجهة؟** إن نعم، سأعيده على مراحل مع فحوص ثابتة بعد كل
   مرحلة، لأن الفحص الثابت هو أقصى ما تسمح به البيئة.
2. **ما هي «الملفات المحمية الثلاثة»؟** أعطني أسماءها لأتحقق منها بدقة بدل التخمين.
3. **هل أُثبّت العمل الخلفي (73 ملفًا) في commit؟** لم أفعل ولن أفعل دون موافقتك — وقد يكون
   التثبيت الآن ضروريًا تحديدًا لأن درس هذه الجلسة أن العمل غير المثبَّت يضيع.
