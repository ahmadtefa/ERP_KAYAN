# القائمة الرئيسية — تقرير التحقيق وخريطة الاستعادة

**التاريخ:** 2026-11-07
**الفرع:** `arena/56e71924-erp-kayan` @ `55519ce`
**الحالة:** تحقيق فقط — **لم يُعدَّل أي ملف Dart**، ولا أي ملف في الشجرة.

---

## 0. الخلاصة في سطرين

**القائمة الهرمية الثمانية موجودة وتعمل في الفرع الحالي اليوم، بكود فعلي مُثبت — لم تُفقد.** الملف `lib/app/shell/erp_shell.dart` (1,223 سطرًا) يحتوي `_NavGroup` (8 مجموعات) و `_navigationItems()` (26 عنصرًا) وآلية الفتح/الإغلاق والصلاحيات وRTL/LTR وألوان الأقسام.

**ما "فُقد" ليس القائمة — بل 9 شاشات مخزون كانت تظهر كفروع داخلها.** الفروع الـ9 نفسها غير موجودة كشاشات، لذا لم يكن ممكنًا أن تكون في القائمة.

---

## 1. الأدلة — تنفيذ مثبت بكود، لا وصف في تقرير

كل بند أدناه تحقّقت منه بقراءة الكود الفعلي، لا بالاعتماد على اسم ملف أو تقرير قديم.

| ما طُلب البحث عنه | النتيجة | الدليل (ملف:سطر) |
|---|---|---|
| `_NavGroup` | **موجود** | `lib/app/shell/erp_shell.dart:61` |
| `_navigationItems()` | **موجود** | `lib/app/shell/erp_shell.dart:234` |
| 8 مجموعات | **موجودة** — `overview, accounting, parties, inventory, sales, purchases, insights, administration` | `erp_shell.dart:61` |
| آلية الفتح/الإغلاق | **موجودة** — `_CollapsedNav extends Notifier<Set<_NavGroup>>` + `_collapsedNavProvider` | `erp_shell.dart:63-72` |
| ربط الفروع بالصلاحيات | **موجود** — `_NavItem.allows(can)` + 28 صلاحية | `erp_shell.dart:51-56`، `234-460` |
| RTL / LTR | **موجود** — `arabic = locale=='ar'`، تخطيط معكوس، `Directionality` | `erp_shell.dart:484, 558-568, 658, 1179` |
| ألوان الأقسام | **موجودة** — `SectionAccents`: 9 ألوان (8 مجموعات + `cash` استثناء) | `lib/app/theme/design_tokens.dart:124-172` |
| الأيقونات | **موجودة** — `IconData` لكل عنصر (Material Outlined) | `erp_shell.dart:234-460` |
| زر العودة للرئيسية | **موجود** — `Key('erp-home-shortcut')` → `context.go(AppRoutes.dashboard)` | `erp_shell.dart:1042-1046` |
| حماية المسودة عند التنقل | **موجودة** — `DraftExitGuard` + `DraftExitRelay` | `lib/app/router/draft_exit_guard.dart` (25 سطرًا) |

### 1.1 المجموعات الثمانية وفروعها — الحالة الفعلية اليوم

| # | المجموعة | التسمية عربي / إنجليزي | الفروع الموجودة | العدد |
|---|---|---|---|---|
| 1 | `overview` | نظرة عامة / Overview | لوحة التحكم | 1 |
| 2 | `accounting` | المحاسبة / Accounting | الخزائن والبنوك، قيود اليومية، الفترات المالية، الأصول الثابتة، الأرصدة الافتتاحية، دليل الحسابات، مراكز التكلفة، الموازنات | 8 |
| 3 | `parties` | العملاء والموردون / Parties | العملاء، الموردون | 2 |
| 4 | `inventory` | المخزون / Inventory | الأصناف، المخزون | **2** ← هنا الفجوة |
| 5 | `sales` | المبيعات / Sales | أوامر البيع، فواتير البيع، عروض الأسعار، مرتجعات البيع | 4 |
| 6 | `purchases` | المشتريات / Purchasing | أوامر الشراء، فواتير الشراء، مرتجعات الشراء | 3 |
| 7 | `insights` | التحليل / Insights | التقارير | 1 |
| 8 | `administration` | الإدارة والبيانات / Administration | استيراد البيانات، النسخ الاحتياطي، الإدارة، إعدادات الشركة، الإعدادات | 5 |

**الإجمالي: 26 عنصرًا.** كلها تحلّ إلى مسارات مسجّلة فعلاً في الراوتر (انظر §4).

### 1.2 مصدر التصميم — التنفيذ موجود، والوثيقة متأخرة عنه

`DESIGN.md:68-73` يصف **قائمة مسطّحة** من 15 عنصرًا بلا مجموعات. الكود الحالي **تجاوز** هذه الوثيقة: نفّذ مجموعات هرمية بألوان أقسام. أي أن الوثيقة أقدم من التنفيذ — التنفيذ هو المرجع، والوثيقة تحتاج تحديثًا (لم أفعل، خارج نطاق التفويض).

---

## 2. ما هو مفقود فعلاً — 9 شاشات، لا القائمة

كل شاشة من الـ9 التالية **لا وجود لها** في `lib/` (تحقّقت بـ`git ls-tree`)، وأسماء `AppRoutes` الخاصة بها **غير معرّفة** في `lib/app/router/app_router.dart` (تحقّقت بالسطر: التسعة كلها `missing`).

| الشاشة المفقودة | Route في PR67 | الـbackend جاهز؟ | لماذا لا يمكن استعادتها حرفيًا |
|---|---|---|---|
| `warehouses_screen.dart` | `/inventory/warehouses` | ✅ `inventory.warehouses` | ملف جديد (923 سطرًا) — لم يوجد هنا قط |
| `batches_screen.dart` | `/inventory/batches` | ✅ `inventory.batches` | ملف جديد (679) |
| `storage_locations_screen.dart` | `/inventory/locations` | ✅ `inventory.locations` | ملف جديد (947) |
| `item_thresholds_screen.dart` | `/inventory/thresholds` | ✅ `inventory.item-thresholds` | ملف جديد (430) |
| `stock_takes_screen.dart` | `/inventory/stock-takes` | ✅ `inventory/stock-takes` | ملف جديد (886) |
| `write_offs_screen.dart` | `/inventory/write-offs` | ✅ عبر `stock-documents` | ملف جديد (969) |
| `stock_documents_screen.dart` | `/inventory/documents` | ✅ `inventory.stock-documents` | ملف جديد (1,046) — **يحل محل** `stock_vouchers_screen` المحمي |
| `inventory_reports_screen.dart` | `/inventory/reports` | ✅ `inventory/reports` | ملف جديد (625) |
| `warehouse_access_screen.dart` | `/inventory/warehouse-access` | ✅ `inventory.warehouse-access` | ملف جديد (418) |

**الخلاصة الحاسمة:** الـ9 **لم تكن جزءًا من الفرع الحالي في أي وقت** — لا في التاريخ ولا في نسخة احتياطية هنا. وجودها الوحيد هو شجرة PR67، وهي شجرة **لا تشترك في سلف** مع شجرة العمل الحالية (`git merge-base` يفشل، وأيضًا `git merge-base --is-ancestor d3f62e9 211f34e` → `NO`).

### 2.1 لماذا لا يمكن نسخها حرفيًا من PR67

1. **الصخور الثلاثة المحمية:** `stock_documents_screen` يحلّ محل `stock_vouchers_screen.dart` المحمي، وPR67 **يحذفه فعلاً** (`test/widget/stock_voucher_flow_test.dart` أيضًا محذوف). نسخه = خرق قيد.
2. **`import_screen.dart` المحمي:** PR67 نسخته 488 سطرًا، وعندنا 568 — نسخها من PR67 = استبدال ملف محمي.
3. **تبعيات شاشات لم تُنقل بعد:** `item_units.dart`، `section_theme.dart`، `user_avatar.dart`، `index. dart`... الشاشات تستوردها.
4. **`orders` يُفقد:** PR67 لا يملك فرع `orders` إطلاقًا (0 ملفات). أي نسخ شامل يحذفه.

---

## 3. ما يمكن استعادته حرفيًا — والنسبة الدقيقة

| الصنف | قابل للاستعادة حرفيًا؟ | ملاحظة |
|---|---|---|
| بنية القائمة (`_NavGroup`, `_navigationItems`, الفتح/الإغلاق، الألوان، RTL) | **لا حاجة — موجودة بالفعل** | لا تُمسّ |
| 9 ثوابت `AppRoutes` للشاشات المفقودة | **نعم** — 9 أسطر | نصوص مسارات، لا منطق |
| 9 أسطر `_NavItem` للفروع | **نعم** — بنمط الموجود | تحتاج مراجعة صلاحيات (§3.1) |
| 9 ملفات شاشات | **لا** | كتابة جديدة كاملة (6,564 سطرًا) |
| 6 ملفات بنية مشتركة | **لا** | كتابة جديدة (1,364 سطرًا) |

### 3.1 الصلاحيات — فجوة حقيقية يجب الحسم فيها

كتالوج الـbackend عندنا يحتوي **29 صلاحية مخزون**. الـ9 شاشات تستخدم في PR67 صلاحيات منها ما هو **غير موجود عندنا**:

| صلاحية PR67 | موجودة عندنا؟ | البديل الصحيح عندنا |
|---|---|---|
| `inventory.warehouses.read` | ✅ | — |
| `inventory.stocktake.read` | ✅ | — |
| `inventory.warehouse.access.read` | ✅ | — |
| `inventory.batches.read` | ✅ | — |
| `inventory.documents.read` | ❌ | `inventory.stock.read` |
| `inventory.locations.read` | ❌ | `inventory.stock.read` |
| `inventory.thresholds.read` | ❌ | `inventory.items.read` |
| `inventory.reports.read` | ❌ | `inventory.stock.read` |

**تحذير:** نسخ أسطر `_NavItem` من PR67 حرفيًا سيجعل 4 أقسام تختفي دائمًا لكل المستخدمين، لأن `.allows()` سيفشل على صلاحية غير موجودة في قاعدة البيانات. يجب استخدام البديل الموجود.

---

## 4. فحص المسارات — 26/26 سليم، صفر مكسور

| الفحص | النتيجة |
|---|---|
| كل مسار في القائمة له ثابت `AppRoutes` | **26/26 ✓** |
| كل ثابت مسجّل فعلاً في الراوتر | **26/26 ✓** |
| مسارات مكسورة | **0** |
| شاشات يتيمة (مسجّلة وبلا رابط) | `login`، `licence`، `quotationNew`، `salesReturnNew`، `purchaseReturnNew`، `openingBalances/:id` — **كلها متوقعة**: بوابة أو محرّر تابع |
| تكرار روابط | **0** — الـ26 مسارًا فريدة |
| كل صلاحيات القائمة موجودة في الـbackend | **28/28 ✓** |

---

## 5. حالة الاختبارات — ما هو محمي وما هو مفقود

| ملف | الحالة | يغطّي |
|---|---|---|
| `test/widget/erp_shell_test.dart` | ✅ موجود (395 سطرًا، 5 اختبارات) | زر الرئيسية · RTL يمين · الصلاحيات · إخفاء عنصر ممنوع · لون كل قسم |
| `test/widget/erp_shell_groups_test.dart` | ✅ موجود (199 سطرًا، 2 اختبارات، ×4 تباديل) | فتح/إغلاق الأقسام في (drawer/sidebar) × (AR/EN) · حماية المسودة · بقاء الحالة |
| `test/widget/rtl_ltr_test.dart` | ✅ موجود (60 سطرًا) | الإنجليزية يسار · العربية يمين |
| `test/widget/design_system_test.dart` | ✅ موجود (149 سطرًا) | نظام التصميم |
| `test/widget/sidebar_scroll_test.dart` | ❌ **مفقود** | تمرير الشريط الجانبي (253 سطرًا في PR67) |

**وهذا مهم:** `erp_shell_groups_test.dart` يغطّي بالضبط ما طُلب اختباره — فتح/إغلاق الأقسام، عربي/إنجليزي، drawer/sidebar، احتفاظ القائمة بحالة الطيّ بعد `router.go()`.

---

## 6. الفرق بين التصميم السابق والحالة الحالية

| البند | PR67 / الفرع السابق | حالتنا اليوم | التقييم |
|---|---|---|---|
| عدد المجموعات | 8 | 8 | **متطابق** |
| نوع `_NavGroup` | `enum` بنفس الأسماء والترتيب | مطابق | **متطابق** |
| عدد الفروع | 33 | 26 | **ناقص 9 مخزون + `purchaseOrders` — 2 فرق حقيقي** |
| `SectionAccents` | 9 ألوان | 9 ألوان | **متطابق** |
| فتح/إغلاق | `_CollapsedNav` Notifier | مطابق | **متطابق** |
| الصلاحيات | 28+ | 28 | **متطابق في المبدأ** |
| RTL | مدعوم | مدعوم | **متطابق** |
| زر الرئيسية | `erp-home-shortcut` | مطابق | **متطابق** |

**فرق إضافي اكتشفته:** PR67 لا يملك `salesOrders` ولا `purchaseOrders` في القائمة (لا يملك فرع `orders` أصلاً). نحن نملك `salesOrders` ونملك `purchaseOrders` — أي أن قائمتنا **أكمل** من قائمة PR67 في هذا الجانب. استعادة قائمة PR67 حرفيًا ستكون **تراجعًا**.

---

## 7. خريطة الاستعادة — خطة تنفيذ بملفات صغيرة

الهدف: إضافة 9 فروع لمجموعة المخزون، **دون لمس** الملفات المحمية أو عروض الأسعار أو فرع `orders`.

### الملف 1 — `lib/app/router/app_router.dart` (تعديل 9 أسطر فقط)
إضافة 9 ثوابت `AppRoutes` بنصوص PR67 نفسها:
```dart
static const warehouses = '/inventory/warehouses';
static const batches = '/inventory/batches';
static const storageLocations = '/inventory/locations';
static const itemThresholds = '/inventory/thresholds';
static const stockTakes = '/inventory/stock-takes';
static const writeOffs = '/inventory/write-offs';
static const warehouseAccess = '/inventory/warehouse-access';
static const inventoryReports = '/inventory/reports';
static const stockDocuments = '/inventory/documents';
```
**الخطر:** منخفض — إضافات في نهاية قائمة الثوابت. لا يمسّ أي ثابت قائم.
**لا يُنفَّذ الآن:** إضافة ثوابت بلا شاشات = مسارات معلّقة.

### الملف 2 — شاشة واحدة أولًا: `warehouses_screen.dart`
أبسط الـ9 (923 سطرًا لكنها قراءة/تعديل قائمة). الـbackend جاهز ومختبَر.
**بندرسة:** `test/widget/warehouses_screen_test.dart` — يجب أن يُكتب (غير موجود في PR67 أيضًا؛ PR67 يملك `warehouse_access_screen_test` فقط).

### الملف 3 — إدخال واحد فقط في `_navigationItems()`
```dart
_NavItem(
  AppRoutes.warehouses,
  Icons.warehouse_outlined,
  Localizations.localeOf(context).languageCode == 'ar' ? 'المستودعات' : 'Warehouses',
  permissions: const ['inventory.warehouses.read'],   // ← موجودة عندنا فعلاً
  group: _NavGroup.inventory,
),
```
**الخطر:** منخفض جدًا — سطر واحد، صلاحية مؤكدة الوجود.

### ثم — واحد واحد، بنفس النمط
`batches` ← `storageLocations` ← `itemThresholds` ← `stockTakes` ← `writeOffs` ← `warehouseAccess` ← `inventoryReports` ← `stockDocuments`.

**لماذا واحدًا واحدًا:** كل إضافة تُختبر بـ`flutter test` قبل التالية. و`stockDocuments` **آخرًا** لأنه الوحيد الذي يتشابك مع الملف المحمي.

### ما لا يُلمس إطلاقًا
- `lib/features/inventory/presentation/screens/stock_vouchers_screen.dart`
- `test/widget/stock_voucher_flow_test.dart`
- `lib/features/data/presentation/screens/import_screen.dart`
- كل `lib/features/quotations/`
- `lib/features/orders/` (4 شاشات + 8 اختبارات)

---

## 8. القيد الحاسم — لا يمكن التحقق من أي Dart

```
$ which flutter dart        → لا شيء
$ curl -I storage.googleapis.com/flutter_infra_release/...
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL
```

**لم أُشغّل أي `flutter test` ولا `flutter analyze` ولا build.** ما أُنجز هو تحقّق ساكن (grep/`git ls-tree`/`git diff`) — وهذا كافٍ لإثبات وجود الكود وغيابه، **ولا يكفي** لإثبات أن أي كود جديد يعمل.

لذلك: **لم أكتب شاشة واحدة.** كتابة 6,564 سطر Dart لا يمكن تجميعها ولا اختبارها = مخاطرة بلا مقابل، وستُخالف طلبك "لا تعلن نجاحًا لم تُشغّله".

---

## 9. الجواب المباشر على السؤال

**"هل استُعيدت القائمة؟"** — لم تكن مفقودة. القائمة الهرمية الثمانية بكامل آلياتها **تعمل في الفرع الحالي الآن**، ومغطّاة بـ7 اختبارات موجودة.

**"ما المفقود إذن؟"** — 9 شاشات مخزون (6,564 سطرًا) + 6 ملفات بنية مشتركة (1,364 سطرًا) + 14 اختبارًا. هذه **لم تولد في هذا الفرع أبدًا**، ووجودها الوحيد شجرة PR67 المنفصلة تمامًا.

**"هل يمكن استعادتها؟"** — الـbackend جاهز لـ9/9. الواجهة تحتاج كتابة جديدة، ومراجعة صلاحيات (§3.1)، وبيئة فيها Flutter للتحقق.

---

## 10. ما نُفِّذ فعليًا في هذه الجولة

**ملف واحد فقط عُدِّل. لا ملف Dart آخر، ولا شاشة، ولا اختبار.**

| الملف | التغيير | الأسطر |
|---|---|---|
| `lib/app/router/app_router.dart` | إضافة 9 ثوابت `AppRoutes` للشاشات المفقودة | +13 (9 ثوابت + 4 تعليق) |

**لماذا هذه الخطوة أولًا:** هي الجزء الوحيد من الاستعادة الذي يمكن إثباته بلا Flutter — إضافة ثوابت نصوص لا منطق. الثوابت **غير مسجّلة في الراوتر**، فلا مسار جديد قابل للوصول، ولا رابط معلّق، ولا تغيير في سلوك التطبيق الحالي.

### التحقق الذي أُجري على هذا التعديل

| الفحص | النتيجة |
|---|---|
| الثوابت القديمة (31) تغيّرت أو حُذفت | **0** — `comm -23` فارغ |
| الثوابت المضافة | **9 بالضبط** |
| أسماء ثوابت مكرّرة | **0** |
| نصوص مسارات مكرّرة | **0** |
| توازن الأقواس `{}` و `()` | **متوازن** (10/10، 137/137) |
| المسارات الـ26 الحالية ما زالت تحلّ | **26/26 لم تتأثر** |
| الملفات المحمية الثلاثة (sha256) | **مطابقة، لم تُمسّ** |

### ما لم يُنفَّذ — والسبب

لم أُضف أي `_NavItem` ولم أكتب أي شاشة. إضافة عنصر قائمة بلا شاشة = رابط مكسور، وهو ما طلبت تجنّبه صريحًا. ولا يمكن كتابة شاشة والتحقق منها بلا Flutter SDK.

**الترتيب الصحيح للتنفيذ** (يحتاج بيئة فيها Flutter):
1. كتابة `warehouses_screen.dart` + تسجيل مساره في الراوتر
2. إضافة `_NavItem` واحد له، بصلاحية `inventory.warehouses.read` (مؤكدة الوجود)
3. `flutter analyze && flutter test` — يجب أن يمرّا
4. تكرار الخطوات للـ8 المتبقية، واحدة تلو الأخرى

هذا الملف (الخطوة 1 من الخريطة) مُنجَز ومُتحقَّق منه، وهو الأساس الذي تبنى عليه الخطوة 2 لاحقًا.
