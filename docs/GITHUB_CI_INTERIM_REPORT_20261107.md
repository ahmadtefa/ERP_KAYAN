# تقرير مرحلي — نقل الاختبارات إلى GitHub Actions

**التاريخ:** 2026-11-07
**الفرع:** `arena/github-ci-final-20261107`
**آخر commit:** `2770c59f6d2391f3c1b06ac403f9c699094100f7`
**الأساس:** `d2cbf1d9d1c231d869b6cae2a99992919c35e432` (من `recovery/inventory-integration-20261106`)

> **حالة هذا التقرير:** تقرير **مرحلي**، لأن العمل أُوقف بطلب من صاحب المشروع قبل
> اكتمال المهمة. لا هو تقرير التسليم النهائي المطلوب في البند (8)، ولا يُقرأ
> كإعلان نجاح. الاختبارات لم تُنجَح كلها، والتثبيت على Windows لم يُنفَّذ.

---

## 1. الخلاصة في سطور

| البند | الحالة | الرقم |
|---|---|---|
| الفرع دُفع إلى GitHub | ✅ تم | 18 commit على `arena/github-ci-final-20261107` |
| `flutter pub get` على عدّاء Linux | ✅ نجح | `flutter_riverpod 3.4.3`، `riverpod 3.4.3` |
| `flutter analyze` — أخطاء الترجمة | ✅ **صفر** (كانت 6) | `No compile errors` |
| `flutter test` **يعمل فعليًا** | ✅ لأول مرة في تاريخ المشروع | — |
| اختبارات Flutter | ⚠️ **6 فاشلة** | كانت 18 |
| Jest (backend) | ❌ سقط بسبب تشخيصي المؤقت ثم تعافى | **1,420 ناجح / 1 فاشل** |
| الترحيلات على PostgreSQL 16 حقيقية | ✅ نجح عبر السكربت | `pg-apply-migrations.mjs` |
| الـAPI + تسجيل الدخول | ✅ نجح | 107 صلاحية لـ `ci-admin` |
| سيناريو المستودعات والطلبات | ❌ **فاشل** | 8 فحوص فاشلة من 21 |
| تثبيت Windows / `KAYAN-ERP-Setup.exe` | ❌ **لم يُنفَّذ** | لم يبدأ |
| بوابة التوقيع | ⛔ لم تُلمَس | البيئة `windows-production` غير موجودة |
| تقرير التسليم النهائي (البند 8) | ❌ **لم يُكتب** | هذا تقرير مرحلي بديلًا |

---

## 2. ما تحقّق فعليًا (بأدلة من التشغيل)

### 2.1 Flutter: من "لا يُترجم" إلى "يُترجم ويُختبر"

المشروع لم يكن قد شغّل `flutter test` على أي عدّاء من قبل، لأن خطوة `Analyze`
كانت `flutter analyze` عارية، وهذه تفشل عند `info` لا عند الخطأ فقط. ونتيجة
ذلك أن **ستة أخطاء ترجمة حقيقية** ظلت مخفية خلف ضجيج lint.

**أخطاء الترجمة الستة (موجودة قبل هذا العمل، وليست في الملفين اللذين عدّلتهما):**

| الملف | السطر | الخطأ |
|---|---|---|
| `storage_locations_screen.dart` | 28 | `StateProvider` غير معرّف (أُزيل من تصدير Riverpod 3) |
| `inventory_reports_screen.dart` | 44، 46 | `StateProvider` غير معرّف |
| `warehouse_access_screen.dart` | 24 | `StateProvider` غير معرّف |
| `storage_locations_screen.dart` | 52، 250 | `valueOrNull` غير موجودة على `AsyncValue` |
| `batches_screen.dart` | 143 | `.split()` على `String?` |

**الإصلاح:** استُخدم النمط الموجود أصلًا في المشروع (ستة providers تستخدمه):
`Notifier<T>` + `NotifierProvider`، و`.value` بدل `valueOrNull`.
لم تُغيَّر أي نسخة حزمة — `flutter_riverpod` بقيت `^3.4.3` كما تشترط التعليمات.

### 2.2 بوابة التحليل: تغيير في طريقة القياس

أُنشئ `scripts/flutter-analyze-gate.sh` واستُخدم في موضعَي `Analyze` داخل
`ci.yml`. يفصل بين أمرين كانا مختلطين:

- **خطأ ترجمة** → يُفشل المهمة، ويُطبع في تعليق للقراءة بدون السجل.
- **ملاحظة أسلوب** → تُحصى وتُنشر في ملخص المهمة، ولا توقف تشغيل الاختبارات.

القياس الحالي: **0 أخطاء، 2 تحذيرات، 35 ملاحظة أسلوب**. كلها منشورة في ملخص
المهمة، ولم يُحذف منها شيء. الملف الخام يُرفع مع التشغيل.

### 2.3 اختبارات Flutter: النتيجة الحقيقية

| المرحلة | ناجح | فاشل |
|---|---|---|
| أول تشغيل | 688 | 18 |
| بعد إصلاحات البحث والرأس | — | 2 |
| بعد `?` على `_movement` | — | 1 (خطأ ترجمة أدخلته أنا) |
| **آخر تشغيل** | — | **6** |

**ملاحظة أمانة:** الرقم ارتفع من 2 إلى 6 بين تشغيلين. السبب المؤكد لاثنين منهما
هو `RenderFlex overflowed` بعد تعديلي على `PageHeader`؛ والسبب في الأربعة
الباقية **لم يُحدَّد** لأن المُبلِّغ لا يطبع تفاصيلها بعد. **لا أدّعي أنها ليست
انحدارًا من تعديلاتي — بل الاحتمال قائم ولم أتحقق منه.**

**الاختبارات الستة الفاشلة في آخر تشغيل:**

1. `stock ledger retry reloads after a transient error` — `stock_ledger_retry_test.dart:44`
2. `ISSUE voucher draft protects the routed stock screen exit` — `RenderFlex overflowed`
3. `RECEIPT voucher draft protects the routed stock screen exit` — `RenderFlex overflowed`
4. `a missing cost is not silently summed as zero`
5. `without cost permission neither stock values nor cost columns are shown`
6. `stock refresh reads the source again and retains the search`

الثلاثة الأخيرة بلا سبب مسجَّل في التعليق.

### 2.4 Backend على PostgreSQL 16 حقيقي

**ما نجح:**

- `prisma validate` — المخطط صالح.
- `npx tsc --noEmit` — صفر أخطاء.
- `npm run build` — نجح.
- **الترحيلات** — نجحت على قاعدة جديدة تمامًا.
- `verify-licensing-postgres` — نجح.
- `check-chart-upgrade` — نجح.
- `verify-cost-center-upgrade` — نجح.
- **تشغيل الـAPI** — نجح: `status: ok`, `database: up`, `needsSetup: false`.
- **تسجيل الدخول** — نجح: `ci-admin` بـ 107 صلاحية.

**إصلاح جوهري:** كان `ci.yml` يستخدم `npx prisma migrate deploy`، وهو **لا يعمل
في هذا المشروع** لسبب موثّق في السكربت `pg-apply-migrations.mjs` نفسه: محرك
المخطط WASM المثبّت (`prisma 6.19.3`) لا يستطيع قراءة كتالوجات PostgreSQL 16.

**أثبتُّ أن الخلل ليس من ترحيلي:** حذفت ترحيلي مؤقتًا وأعدت الأمر، ففشل بنفس
الرسالة `Column type 'name' could not be deserialized`. ثم أعدت الترحيل.

**وأثبتُّ أن الحل الأصلي غير متاح:** بديل المحرك الأصلي (native) يحتاج تنزيلًا
من `binaries.prisma.sh`، وهو محجوب هنا:
`request to https://binaries.prisma.sh/.../schema-engine.gz.sha256 failed`.

**ما فشل:** سيناريو المستودعات والطلبات — 8 فحوص من 21.

```
PASS  the goods are in the warehouse that received them — B has 10.0000, A has 0
FAIL  the transfer is posted — 400 "Not enough stock in the selected warehouse:
      0.0000 available, 4.0000 requested"
FAIL  the transfer left 6 in the source and put 4 in the destination
      — source 10.0000, destination 0
FAIL  the sale is posted — 400 "الرصيد غير كافٍ في هذا المخزن"
FAIL  the sale took the goods out of the warehouse it named and no other
FAIL  an order moves no stock: it is a promise, not a receipt
FAIL  part of the order becomes a draft invoice — idempotencyKey is required
```

### 2.5 عطل السيناريو: ما أُثبت وما بقي مجهولًا

هذا أهم ما يجب أن يعرفه من يقرأ التقرير، لأنه **عطل حقيقي في المنتج وليس في
الاختبار**: مخزن فيه 10 وحدات، والتحويل يخرج 4، فيُرفض بحجة أن المتاح صفر.

**ما أُثبت بالتشخيص على الخادم الفعلي:**

```
السيناريو ينشئ: A-212881 (isDefault=true) ثم B-212881
الشراء يسجّل 10 وحدات في B ✓
تقرير مخزن B يعيد: [["WH-212881","10.0000"]] ✓

عند الترحيل:
document.fromBranchId = c0b4f846… (= branchId ✓)
fromWarehouseId(raw)  = 98733c9e…  → resolve → 98733c9e… ✓
toWarehouseId(raw)    = 0291bb7f…  → resolve → 0291bb7f… ✓
```

**أي أن حل المخزن سليم تمامًا.** ومع ذلك:
`availableQuantity(B, item)` تُرجع `0.0000` بينما `stock(B)` تُرجع `10.0000`
— **دالتان تقرآن من نفس الجدول بنفس الصيغة، وتعطيان رقمين مختلفين.**

**خلاصة المراجعة النظرية (لم تُثبَت تجريبيًا):** لا يوجد فرق ظاهر بين
الاستعلامين يفسّر التناقض:

- كلاهما `SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END)`
- كلاهما يُرشّح بـ `companyId` و `warehouseId` و `itemId`
- `stock()` تضيف `JOIN items` و `movementDate <= asOf` فقط

**الاحتمالات المتبقية، وكلها غير مثبتة:**

1. الرقم 10 الذي يظهر في التقرير مصدره حركة `warehouseId = NULL` تُحسب تحت مخزن
   آخر بطريقة ما.
2. `assertWarehouseAvailable` تُستدعى بمعامل مختلف عما يظهر في السجل (مثلاً من
   مسار ثانٍ لم أتبعه).
3. حالة توقيت: الفحص يقع في معاملة لا ترى حركة الفاتورة قبلها.

**لم أُكمل التشخيص.** آخر تشغيل كان يحمل تشخيصًا يطبع الحركات الخام من داخل
`availableQuantity`، لكنه سقط في خطوة **تثبيت أدوات PostgreSQL** (فشل عابر في
مرآة apt) قبل أن يصل إلى السيناريو، فلم تظهر نتيجته.

---

## 3. ما لم يُنجَز

| البند المطلوب | الحالة |
|---|---|
| (3) اختبارات Flutter تنجح بالكامل | ❌ 6 فاشلة، اثنتان منها بسببي |
| (4) كل اختبارات backend تنجح | ❌ `/1` فاشل (بسبب تشخيصي)، والسيناريو فاشل |
| (5) بناء Flutter Windows | ❌ **لم يبدأ** |
| (5) حزم الـbackend + Node + PostgreSQL + RepairTool | ❌ **لم يبدأ** |
| (5) `KAYAN-ERP-Setup.exe` + الحجم + SHA-256 | ❌ **لم يُنتَج** |
| (5) فحص الحمولة | ❌ لم يُنفَّذ |
| (5) اختبار تثبيت على جهاز نظيف | ❌ **لم يُنفَّذ** |
| (6) حالة بوابة التوقيع مكتوبة كاملة | ⚠️ جزئيًا (انظر §5) |
| (8) `docs/GITHUB_CI_FINAL_REPORT_20261107.md` | ❌ **لم يُكتب** |
| تنظيف تشخيصات `DIAGTMP` من الفرع | ❌ **لا تزال موجودة** |

---

## 4. الأخطاء التي أدخلتُها أنا (ولم تُصلَح كلها)

أوثّقها صراحة لأن إخفاءها يجعل التقرير بلا قيمة:

1. **خطأ ترجمة.** حوّلت `_movement` إلى `String?` ونسيت سطر البحث
   `_movement(row).toLowerCase()`. كسر الاختبارات كلها في تشغيل كامل. أُصلح.
2. **`Flexible` خاطئ.** أول إصلاح لشريط الأدوات استخدم `Flexible` التي تتقاسم
   العرض بالتساوي مع `Expanded`، فلم تحل التجاوز. ثم أزلتها لأن `Row` تمنح
   الأبناء غير المرنين عرضهم الطبيعي أولًا. **النتيجة في آخر تشغيل: تجاوز
   `RenderFlex` ما زال يظهر في اختبارين.** الإصلاح غير مؤكد.
3. **تشخيص في `warehouse.service.ts`** أضاف نداء `$queryRaw` ثالثًا فأسقط
   `warehouse-guard.spec.ts` (يتوقع نداءين). أُزيل لاحقًا.
4. **تشخيصات `DIAGTMP` ما زالت على الفرع** في:
   - `backend/src/common/warehouse/warehouse.service.ts:631-637`
   - `backend/src/modules/inventory/stock-documents.service.ts:979-986`

   **يجب حذفها قبل أي دمج.** لا يجوز أن يبقى `console.log` تشخيصي في الإنتاج.

---

## 5. Permissions وبوابة التوقيع (كما هي الآن)

**الصلاحيات:**

- `permissions.admin = true`, `push = true`, `maintain = true`
- `x-oauth-scopes:` **فارغة** — الرمز رمز تركيب GitHub App
- `GET /actions/secrets` → **403** `Resource not accessible by integration`
- `GET /actions/permissions` → **403**

هذا حد في نوع الرمز لا في إعدادات الأفعال. **ما يحتاجه المالك:** رمز بـ
`secrets:read` أو فتح صفحة Settings → Secrets بنفسه. لم أحاول تجاوز القيد ولم
أطلب صلاحيات أوسع.

**بوابة التوقيع:**

- `GET /environments` → **`total_count: 0`**
- البيئة `windows-production` (المطلوبة في `windows-installer.yml:559`) **لم
  تُنشأ قط**.
- `windows-packaging-probe.yml` سقط عند الخطوة 5 (`inspect-windows-pe.test.mjs`)،
  أي **قبل** أي بناء، فلم يُنتج أي حزمة.

**ما يلزم لإتمام التوقيع (لا أفعله أنا):** إنشاء بيئة `windows-production` بقواعد
حماية، وإيداع الشهادة والمفتاح الخاص كـ secrets فيها. لم ألمس البوابة ولم
أعدّل سياسة الحماية ولم أستخدم شهادة غير معتمدة.

---

## 6. حالة الفروع والـPRs

| العنصر | الحالة |
|---|---|
| `main` | `1d390015` — **لم يُمس** |
| PR67 | `211f34e2` — **مفتوح، لم يُمس** |
| PR70 | `d3f62e97` — **مفتوح، لم يُمس** |
| `arena/56e71924-erp-kayan` | `d3f62e97` + 116 تغييرًا — **لم يُمس** |
| `arena/github-ci-final-20261107` | `2770c59f` — مدفوع، بلا دمج |
| `/home/user/ERP_KAYAN` | سليم |

**تحذير تشغيلي:** صندوق الرمل أُعيد ضبطه في منتصف العمل، فاختفت النسخة المحلية
`/home/user/ERP_KAYAN_AT_d2cbf1d` وحزمة الحفظ `/home/user/PRESERVED_final_20261107/`.
**لم يُفقد أي التزام** لأنه كان مدفوعًا على GitHub، وأُعيد استنساخ الفرع.
لكن **ملف `SHA256SUMS.txt` (20 مدخلًا) وحزمة الحفظ لم يُعاد إنشاؤهما** — إن
كانا مطلوبين للتسليم فيجب إعادة توليدهما.

---

## 7. ما يجب فعله بعد ذلك (مرتّبًا)

**قبل أي شيء:**

1. **حذف تشخيصات `DIAGTMP` الثلاثة** من الفرع.

**لإغلاق اختبارات Flutter:**

2. تحديد سبب الأربعة بلا سبب مسجَّل: إضافة تلك الاختبارات إلى قائمة
   `report-flutter-test-failures.mjs`.
3. التحقق من أن تجاوز `RenderFlex` في اختبارَي الـvoucher انحدار من تعديلي على
   `PageHeader` أم عطل سابق — بمقارنة سلوك الفرع قبل `b6a149f2`.
4. **إعادة النظر في تعديل `PageHeader` بالكامل:** إن ثبت أنه يزيد التجاوزات،
   الأفضل الرجوع عنه وترك الملف كما كان، وتوثيق العطل بدل إصلاح غير مؤكد.
   المخاطرة هنا حقيقية: شاشات كثيرة تستخدم هذا المكوّن.

**لإغلاق عطل السيناريو:**

5. إعادة التشغيل الأخير الذي يحمل تشخيص `availableQuantity` (سقط لسبب عابر في
   apt). التشغيل من جديد يكفي: `gh workflow run ci.yml`.
6. إن تأكد التناقض بين `stock()` و`availableQuantity`، فالمكان المرجَّح للعطل
   هو مسار ثانٍ يمرر مخزنًا مختلفًا إلى `assertWarehouseAvailable`، وليس الحساب.

**لإكمال بنود 5 و8:**

7. بناء Windows: `code-integrity.yml` لا يقبل `workflow_dispatch`، ويعمل فقط
   على PR إلى `main` أو `arena/**`. للحصول على `flutter build windows` يلزم
   **فتح PR مسودة** إلى `arena/56e71924-erp-kayan` — وهذا يحتاج قرارك أولًا لأن
   التعليمات تمنع إنشاء PR إلا بضرورة معلنة.
8. بعد نجاح كل ما سبق: كتابة `docs/GITHUB_CI_FINAL_REPORT_20261107.md`.

---

## 8. الحكم النهائي

**غير جاهز للتسليم.** وبصراحة:

- ما تحقّق حقيقي وموثّق: الترجمة نظيفة، والاختبارات تُشغَّل فعلًا لأول مرة،
  والـbackend يعمل على PostgreSQL حقيقي مع 107 صلاحية، والترحيلات تُطبَّق على
  قاعدة جديدة.
- ما بقي مانعًا: **6 اختبارات Flutter فاشلة**، **سيناريو المستودعات فاشل بعطل
  حقيقي في المنتج** (مخزن فيه 10 يُرفض منه 4)، و**لم يُنتَج أي مثبّت ولم يُجرَّب
  أي تثبيت**.
- بوابة التوقيع لم تُلمس، والبيئة المطلوبة غير موجودة.
- تعديلاتي على `PageHeader` و`storage_locations` غير مؤكدة النتيجة، وواحدة منها
  على الأقل قد تكون أدخلت انحدارًا.

لا أصحّح صورة ناقصة: المنتج اليوم **يُبنى ويُترجم**، لكنه **لا يُطلب منه بيع أو
تحويل مخزون بين مستودعين بثقة**، ولم يُجرَّب تثبيته على Windows إطلاقًا.
