# تقرير التسليم النهائي — ERP_KAYAN

**التاريخ:** 2026-11-07
**الفرع:** `work/11-points-audit` (استنساخ مستقل، لا مساس بـGitHub)
**الحكم النهائي:** 🔴 **غير جاهز للتسليم** — 4 اختبارات إلزامية لم تُنفَّذ، والسبب بيئي موثّق.

---

## 1. الـ SHA الذي جرى العمل عليه

| | |
|---|---|
| **SHA الأساس** | `d2cbf1d9d1c231d869b6cae2a99992919c35e432` |
| **الأب** | `d3f62e97e4828b165bd87b9eb3f841c46334bc80` |
| **الحالة** | 13 تغييرًا غير ملتزم فوقه |
| **main** | `1d390015b14f78311847dc6e0522da97bc2de9a6` — **لم يُمسّ** |
| **PR67 / PR70** | `OPEN` — **لم يُمسّا** |

**لا Commit · لا Push · لا Merge · لا `reset --hard` · لا `git clean` · لا Force Push.**

---

## 2. الأعمال المحفوظة

**حزمة الحفظ:** `/home/user/PRESERVED_final_20261107/` — **18 بصمة SHA-256، جميعها سليمة عند التحقق.**

| النوع | العدد |
|---|---|
| ملفات معدّلة | 8 |
| ملفات جديدة | 5 |
| **الإجمالي** | **13** |

```
 M  backend/package.json
 M  backend/scripts/pg-concurrency-guard.mjs
 M  backend/src/modules/inventory/batches.controller.ts
 M  backend/src/modules/inventory/batches.service.ts
 M  backend/src/modules/sales/sales-batches.integration.spec.ts
 M  backend/src/modules/sales/sales-invoices.service.ts
 M  lib/features/inventory/presentation/screens/stock_documents_screen.dart
 M  test/widget/stock_documents_screen_test.dart
??  backend/prisma/migrations/20261107140000_stock_movement_unit_snapshot/
??  backend/src/modules/inventory/expired-issue-policy.integration.spec.ts
??  backend/src/modules/inventory/migration-schema-parity.integration.spec.ts
??  docs/ELEVEN_POINTS_FINAL_REPORT_20261107.md
??  docs/RESTORE_AND_CONCURRENCY_REPORT_20261107.md
```

لم يُحذف أي ملف. لم يُستبدل أي إصلاح. التقارير السابقة محفوظة كما هي.

---

## 3. نتائج اختبارات Flutter — ⛔ **لم تُنفَّذ**

### الحقيقة دون تجميل

| الأمر | النتيجة |
|---|---|
| `flutter pub get` | ⛔ **لم يُنفَّذ** |
| `flutter analyze` | ⛔ **لم يُنفَّذ** |
| `flutter test` | ⛔ **0 من 605 حالة** |

### السبب — عائق بيئي حقيقي، مُثبت بالقياس

| النطاق المطلوب | الحالة |
|---|---|
| `storage.googleapis.com` (تحميل Flutter SDK) | ❌ محجوب (SSL_ERROR_SYSCALL) |
| `dl.google.com` | ❌ محجوب |
| `pub.dev` / `pub.dartlang.org` | ❌ محجوب |
| `pub.flutter-io.cn` (مرآة) | ❌ محجوب |

`pubspec.yaml` يعلن **27 حزمة** خارجية. بدون `pub.dev` لا يمكن حلّها، وبدون ذلك لا يمكن
التحليل ولا الاختبار. **لم أجد بديلًا: لا SDK مثبّت، لا `~/.pub-cache`، ولا حزمة npm تحمل
Dart SDK.**

### ما فعلته بدلًا من الادّعاء — تدقيق بُنيوي للتعديلين

وُجّه فحص دقيق للتعديلين Dart المطلوبين في هذا البرومبت:

| الفحص | النتيجة |
|---|---|
| `StockVoucherDetailScreen` عام وبالتوقيع `{super.key, required id, exitRelay}` | ✅ والاستدعاء `(id: id)` مطابق |
| الـimport `show StockVoucherDetailScreen` | ✅ الملف موجود، والصنف مُعرَّف مرة واحدة (لا تضارب) |
| **دورة استيراد** | ✅ `stock_vouchers_screen` **لا يستورد** `stock_documents_screen` |
| `RecordsTable.onTap` نوعه `void Function(Json)?` | ✅ والمُمرَّر `(row) => _open(...)` يعيد `Future` — **نمط مطابق لسطر قائم في `stock_vouchers_screen:264` منذ قبل** |
| توازن الأقواس | ✅ `{}` 18/18 · `()` 117/117 (والاختبار: 26/26 · 167/167) |
| استيراد `text()` | ✅ `json_utils.dart` مُستورد أصلًا |
| `ref` / `mounted` | ✅ داخل `ConsumerState` |

> ⚠️ **هذا تدقيق يدوي، وليس تشغيلًا.** لا أعتبرهما ناجحين. أول أمر في أي بيئة Flutter
> يجب أن يكون `flutter analyze`، وهذان الملفان هما المشتبه الأول إن فشل.

---

## 4. نتائج اختبارات Backend — ✅ مكتملة

| البوابة | النتيجة |
|---|---|
| `prisma validate` | ✅ صالح |
| `tsc --noEmit` | ✅ exit 0 |
| `npm run build` | ✅ exit 0 |
| **Jest الكامل** | ✅ **1,480 ناجح / 8 متخطّى / 0 فاشل** |
| `test:lots` (بوابة الدفعات) | ✅ **34/34** |
| `test:integration:pg` | ✅ 13/13 + 67/67 |
| اختبارات الترخيص | ✅ **245/245** |
| اختبارات النسخ الاحتياطي | ✅ **108/108** |
| FEFO والدفعات | ✅ 510/510 |

الـ8 المتخطّاة: حزمة `quotation-pdf` الواحدة (تحتاج متصفحًا) — متخطّاة قبل هذا العمل.

---

## 5. PostgreSQL والتزامن — ✅ مكتمل

### قاعدة جديدة تمامًا (لا تعديلات يدوية)
```
DROP DATABASE kayan_final → CREATE → 68 ترحيلًا بالترتيب
→ 79 جدولًا · 0 انحراف
```

**الأعمدة الثلاثة أُكِّدت:** `enteredUnit` · `enteredQuantity` · `unitFactor` ✅

**Schema Drift:** فُحصت **75 نموذجًا** مقابل قاعدة البيانات — **0 جدول مفقود، 0 عمود ناقص.**

### التزامن باتصالين مستقلين على PostgreSQL 16.2
```
PASS  1. two independent connections    — pids=21033,21034
PASS  2. real temporal overlap          — 17 عيّنة متقاطعة
PASS  3. lock wait captured             — 16 عيّنة انتظار حقيقية
PASS  4. exactly one posting succeeded  — 1 ok / 1 rejected
PASS  5. BadRequestException(400)       — "3.0000 available, 7.0000 requested"
PASS  6a. source never negative         — 3.0000
PASS  6b. destination receives 7        — 7.0000
PASS  7. exactly one OUT/IN pair        — OUT=1 IN=1
PASS  8. no orphan movements            — 0
PASS  9. no journal by design           — 0
PASS 10. winner POSTED, loser DRAFT
ALL CONCURRENCY ITERATIONS PASSED (3 iterations)
```

**الأرصدة السالبة:** ممنوعة على 3 مستويات — حارس الخدمة، قيد `CHECK` في قاعدة البيانات
(SQLSTATE 23514)، والقفل الصفّي.
**الترحيل والعكس:** مغطّى (استعادة الدفعات الأصلية + منع الإلغاء المزدوج).
**الوحدات غير الأساسية:** مغطّاة باختبار جديد يثبت كتابة اللقطة على الحركة.

---

## 6. مراجعة الوظائف الإحدى عشرة

| # | البند | الحالة | الدليل |
|---|---|---|---|
| 1 | الضريبة والاستيراد والتصفير | 🟡 | 4 اختبارات ضريبية · لم يُختبر «استيراد→تصفير→إعادة فتح» في الواجهة |
| 2 | التحديث الفوري | ✅ | 187 نقطة إبطال |
| 3 | زر Refresh | ✅ | حالات تحميل/خطأ/إعادة محاولة |
| 4 | توحيد الرجوع | ✅ | `draftExitGuardProvider` + `PopScope` |
| 5 | القائمة الرئيسية | ✅ | **36 عنصرًا / 8 أقسام** · 0 شاشة يتيمة · مُرشَّحة بالصلاحيات |
| 6 | صورة المستخدم | ✅ | صورة افتراضية + `errorBuilder` عند فشل التحميل |
| 7 | زر Home | ✅ | `erp-home-shortcut` + حارس المسودات |
| 8 | دليل الحسابات | ✅ | منع الحذف عند حركات **أو أبناء** + قفل صفوف |
| 9 | رسائل الأخطاء العربية | ✅ | 996 سطرًا + تصنيف الأسباب + RTL |
| 10 | أذون المخزون | 🟡 **أُصلح اليوم** | الشاشة كانت للقراءة فقط — رُبطت بالتفاصيل |
| 11 | مراكز التكلفة والتقارير | ✅ | 29+12 إشارة · 3 اختبارات · شاشة تقرير |

**فحص القائمة:** 40 مسارًا، 35 في القائمة، والفرق 5 مشروعة (تسجيل الدخول، 3 مسارات
`new`، الترخيص من الإعدادات). **لا شاشة محجوبة، ولا صلاحية تتجاوز**.

**البنود 1 و10:** لم أُعلنهما مكتملين — الناقص فيهما يحتاج Flutter للتحقق.

---

## 7. الباركود في المبيعات

### الحالة: 🔴 **غير موصول — ولم أُوصله. وهذا قرار متعمّد.**

**التحقق:**
- `backend/src/modules/sales/` → **0 إشارة** إلى barcode
- `lib/features/invoicing/` → **0 إشارة** إلى barcode

**قرار النطاق — موثّق من المستودع نفسه:**
`docs/ERP_KAYAN_11_POINT_CHECKLIST.md` سطر 13:
> «هذه القائمة مستقلة تماماً عن قائمة وظائف المخازن التفصيلية (الأصناف، الدفعات،
> المواقع المخزنية، الجرد، الإهلاك، التحويلات، **الباركود**، تقارير الصلاحية)»

وسطر 88 يُدرج الباركود تحت **قائمة عمل المخازن التفصيلية**، لا تحت البنود الـ11.

**لماذا لم أُنفّذه رغم أن البرومبت أجازه:**
1. البند خارج نطاق الـ11 المتفق عليه صراحةً.
2. البرومبت نفسه يمنع «تحسينات إضافية» في مرحلة التسليم.
3. **الأهم:** كتابة كود Dart في بيئة **لا يمكن فيها تشغيل `flutter analyze` ولا اختبار
   واحد** — في نطاق اختياري — هو بالضبط ما حذّرت منه: «لا تنفذ حلًّا شكليًا».

### ما هو موجود فعلًا (قابل لإعادة الاستخدام)
- `GET /inventory/items/by-barcode/:code` — نقطة نهاية عاملة
- `_scanBarcode()` في `stock_vouchers_screen.dart` — **نمط مكتمل**: يقرأ، يجلب الصنف،
  يضبط السطر، يمسح الحقل، يعالج الباركود غير المعروف عبر `showAppError`، ولا يُكرّر الصنف
- طباعة ملصقات Code128

### الأثر على التسليم
**ليس حاجزًا أمام التسليم.** خارج نطاق الـ11. الأعمال المطلوبة له موثّقة ومحدّدة
(نقل `_scanBarcode` إلى محرر فاتورة البيع + اختبارات)، وتُنفَّذ في بيئة Flutter.

---

## 8. نتيجة بناء Windows — ⛔ **لم يُبنَ، والسبب سياسة في المستودع**

### اكتشاف حاسم: البناء محجوب صراحةً على أي runner عام

`.github/workflows/windows-installer.yml` سطر 40-44 **في نسختنا `d2cbf1d`**:
```yaml
- name: Block installer until signing-test environment is approved
  shell: pwsh
  run: |
    Write-Error 'BLOCKED: installer signing tests require an approved isolated VM.
       No installer was built or tested.'
    exit 1
```

هذه أول خطوة في وظيفة `build`. **أي بناء على `d2cbf1d` سيفشل بالتصميم** — لا لخطأ في
الكود. والتعليق نفسه يقول: «No flag may bypass this on a general-purpose GitHub runner».

### هذا يفسّر سجلّ CI
آخر 5 تشغيلات لـ`windows-installer.yml` **كلها `failure`**. وحين فحصت أقدمها (PR70،
قبل إضافة الحجب) وجدت:
- `Build KAYAN ERP for Windows x64` → **نجح**
- `Extract and verify the actual payload` → **نجح**
- `Install and exercise the inspected Setup offline` → **فشل**
- `Publish independently verified Windows installer` → **متخطّى**

أي أن: **البناء والتغليف نجحا فعلًا، وفشل اختبار التثبيت النظيف فقط.**

### البنية التحتية للتثبيت — موجودة وكاملة
| المكوّن | الحجم |
|---|---|
| `installer.iss` (Inno Setup) | 16 KB |
| `build-installer.ps1` | 26 KB |
| `install-runtime.ps1` (Node+PostgreSQL) | 67 KB |
| `RepairTool.cs` | 40 KB |
| `repair-runtime.ps1` | 16 KB |
| `reset-kayan.ps1` | 24 KB |
| `smoke-test-installed-windows.ps1` | 68 KB |

### لماذا لا أستطيع بناءه هنا
- **لا توجد بيئة Windows** — هذه حاوية Linux.
- **لا `pub.dev`** → لا يمكن بناء تطبيق Flutter حتى على Windows من هنا.
- سكربت الـsmoke **يرفض العمل** خارج `GITHUB_ACTIONS=true` + `runner=github-hosted`.

**`KAYAN-ERP-Setup.exe` لم يُنتَج. `SHA256`: لا يوجد. الحجم: لا يوجد.**

---

## 9. التثبيت النظيف على Windows 11 — ⛔ **لم يُنفَّذ**

الأسباب أعلاه (لا Windows، لا installer، سكربت الفحص يرفض بيئة غير GitHub-hosted).

**الـ17 خطوة في القسم السابع من البرومبت — كلها غير منفّذة**، بما فيها: التشغيل دون
Node يدوي، تشغيل PostgreSQL تلقائيًا، migrations، تسجيل الدخول، عملية بيع فعلية،
إعادة تشغيل Windows، Repair Tool، النسخ الاحتياطي والاستعادة، الترقية، والعمل دون إنترنت.

**لم أختبر أيًّا منها. لم أُعلن نجاح أيًّا منها.**

---

## 10. الترخيص والنسخ الاحتياطي — ✅ مُتحقَّق على مستوى الاختبارات

| الشرط | النتيجة |
|---|---|
| عدم تجاوز التحقق من الترخيص | ✅ 245 اختبارًا |
| ارتباط الترخيص بالجهاز | ✅ مغطّى |
| غياب مفتاح التحقق لا يُغلق الواجهة | ✅ `installed-corrupt-state-safety` + `license-corruption-recovery` |
| العمليات التجارية محظورة عند عدم الصلاحية | ✅ `licence_gate` في الواجهة + الحارس في الخادم |
| النسخ الاحتياطية تتضمن الترخيص | ✅ `licensing.reconcile()` بعد الاستعادة + تسجيل التاريخ |
| الاستعادة لا تتجاوز الانتهاء/التوقيع/الإلغاء | ✅ مغطّى |
| **الاستعادة ذرية ولا تُفسد القاعدة** | ✅ 108 اختبار نسخ احتياطي |

> هذه نتائج **اختبارات آلية**، وليست اختبارًا حيًّا على نسخة Windows مثبّتة.

---

## 11. شروط إعلان الجاهزية

| الشرط | الحالة |
|---|---|
| Flutter analyze ناجح | ⛔ لم يُنفَّذ |
| Flutter tests ناجحة | ⛔ 0/605 |
| Backend tests ناجحة | ✅ 1,480 |
| Migrations على قاعدة جديدة | ✅ 68/68 |
| اختبار التزامن | ✅ 10/10 × 3 |
| Windows build ناجح | ⛔ محجوب بسياسة |
| Installer تم إنشاؤه | ⛔ لم يُنشأ |
| التثبيت النظيف على Win11 | ⛔ لم يُنفَّذ |
| العمل بعد إعادة تشغيل Windows | ⛔ لم يُنفَّذ |
| الوظائف الأساسية تعمل فعليًا | 🟡 9/11 على مستوى الكود والاختبارات |
| لا أخطاء تمنع الاستخدام | 🟡 لا شيء معروف في الخادم · الواجهة غير مُختبرة |

### **الحكم: غير جاهز للتسليم.**

**السبب الجذري واحد:** البيئة لا تستطيع تشغيل Flutter ولا بناء Windows.
Backend مكتمل ومُتحقَّق منه بالكامل؛ الواجهة غير مُختبرة قَطُّ.

---

## 12. ما يحتاجه التسليم — خطة قابلة للتنفيذ

### الخطوة 1 — Flutter (بيئة بها SDK + وصول لـpub.dev)
```
flutter pub get
flutter analyze          ← المشتبه الأول: الملفان المعدّلان
flutter test             ← 605 حالة، 0 نُفِّذت
```
إن فشل `analyze` في `stock_documents_screen.dart` أو اختباره، فالإصلاح دقائق.

### الخطوة 2 — البناء (Windows + Inno Setup)
```
pwsh distribution/windows/build-installer.ps1
```
**على `d2cbf1d` سيفشل** بسبب خطوة الحجب المتعمّدة. لتجاوزها بإذن صريح: تفعيل
`workflow_dispatch` مع `build_mode: test-signed` بعد اعتماد بيئة التوقيع، أو إزالة
خطوة الحجب — **قرار مالك المشروع، ولا أنفّذه دون إذن.**

### الخطوة 3 — التثبيت النظيف
`smoke-test-installed-windows.ps1` على VM نظيفة — وهو مصمَّم لهذا بالضبط، ويرفض العمل
في أي بيئة أخرى.

### الخطوة 4 — الباركود (اختياري، خارج نطاق الـ11)
نقل `_scanBarcode` إلى محرر فاتورة البيع — **بعد** توفر `flutter analyze`.

---

## 13. خلاصة صادقة

| ما نُفِّذ وتحقّق منه | ما لم يُنفَّذ |
|---|---|
| Backend: 1,480 اختبارًا | Flutter: 0 من 605 |
| PostgreSQL: 68 ترحيلًا على قاعدة نظيفة | بناء Windows |
| Schema drift: 0 | Installer (`KAYAN-ERP-Setup.exe`) |
| التزامن: 10/10 × 3 على PG 16.2 | التثبيت النظيف على Windows 11 |
| الترخيص: 245 · النسخ الاحتياطي: 108 | 17 خطوة اختبار تشغيل |
| 13 تغييرًا محفوظًا وموقّعًا | الباركود في المبيعات (خارج النطاق) |

**لم أُعلن نجاح أي اختبار لم أشغّله. ولا أعلن هذه النسخة جاهزة للتسليم.**
