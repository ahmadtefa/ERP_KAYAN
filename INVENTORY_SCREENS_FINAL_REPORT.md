# تقرير الاستعادة النهائي — شاشات المخزون التسع

**التاريخ:** 2026-11-07
**الفرع:** `arena/56e71924-erp-kayan`
**نقطة الأساس:** `d3f62e9` (من `recovery/inventory-integration-20261106`)
**آخر التزام:** `ab2dc918`
**الحالة:** عمل محلي فقط — **لم يُدفع، ولم يُدمج، ولم يُفتح له PR**

---

## ١. الخلاصة في سطر واحد

الشاشات التسع المفقودة بُنيت، وطُعّمت في الموجّه والقائمة، وربطت بصلاحيات موجودة فعلاً في كتالوج الخلفية، وكُتب لها تسع اختبارات — **لكن لم يُشغَّل منها اختبار واحد، لأن Flutter SDK غير قابل للتنصيب في هذه البيئة**. ما جرى فعلاً هو تحقّق ساكن بمدقّق بُني لهذا الغرض وتمّت معايرته على المستودع كله.

---

## ٢. ما أُنجز

### الشاشات التسع

| # | الشاشة | الملف | المسار | السطور |
|---|---|---|---|---|
| ١ | المستودعات | `warehouses_screen.dart` | `/inventory/warehouses` | ٢٧٢ |
| ٢ | الدفعات | `batches_screen.dart` | `/inventory/batches` | ١٩١ |
| ٣ | مواقع التخزين | `storage_locations_screen.dart` | `/inventory/locations` | ٣٣٣ |
| ٤ | حدود الأصناف | `item_thresholds_screen.dart` | `/inventory/thresholds` | ٢٤١ |
| ٥ | الجرد | `stock_takes_screen.dart` | `/inventory/stock-takes` | ٢٢٦ |
| ٦ | الإعدام | `write_offs_screen.dart` | `/inventory/write-offs` | ٢٤٢ |
| ٧ | مستندات المخزون | `stock_documents_screen.dart` | `/inventory/documents` | ٢٠٤ |
| ٨ | تقارير المخزون | `inventory_reports_screen.dart` | `/inventory/reports` | ٢٥٤ |
| ٩ | صلاحيات المستودعات | `warehouse_access_screen.dart` | `/inventory/warehouse-access` | ٤٤٣ |
| | **الإجمالي** | | | **٢٤٠٦** |

كل شاشة طُعّمت في **أربعة مواضع** بالـ router: الاستيراد، مُوزّع البناء، `_guardedShellPaths`، جدول `_shellRoutes`. وكل واحدة لها **مدخل واحد فقط** في القائمة.

### القائمة

| المجموعة | قبل | بعد |
|---|---|---|
| accounting | ٨ | ٨ |
| administration | ٥ | ٥ |
| insights | ١ | ١ |
| **inventory** | **٢** | **١١** |
| overview | ١ | ١ |
| parties | ٢ | ٢ |
| purchases | ٣ | ٣ |
| sales | ٤ | ٤ |
| **الإجمالي** | **٢٦** | **٣٥** |

سبع مجموعات من أصل ثمانية **متطابقة بايت ببايت**. الهيكل الهرمي لم يُلمس — أُضيفت عناصر فقط.

---

## ٣. اكتشافات مهمة أثناء العمل

هذه لم تكن مفترضة؛ كل واحدة قُرئت من الكود قبل الكتابة:

**١. `inventory.thresholds.read` غير موجود في الكتالوج** (صفر مُطابقات في `permissions.ts`). المتحكم يفرض `inventory.warehouses.read` فعلياً. الشاشة تستخدم الموجود، ولم تُخترع صلاحية.

**٢. تقارير المخزون ليست في `EXPORTABLE_REPORTS`.** لو صدّرتها الشاشة عبر `/exports/:report` لكان الخادم ردّ ٤٠٠ على العشرين تقريراً. لها مسارها الخاص `/inventory/reports/:slug/export` محمي بـ`inventory.export` مع BOM عربي. الشاشة تستخدم المسار الصحيح.

**٣. الإعدام ليس جدولاً مستقلاً.** هو `stock-document` بنوع `WRITE_OFF` يمر بمحرّك المستندات نفسه: إنشاء ← اعتماد (من غير مُنشئه) ← ترحيل. الشاشة تُظهر ما ينهيه فقط، ولا تكرّر المحرّك.

**٤. `PUT /inventory/warehouse-access/:userId` يستبدل مجموعة الصلاحيات كاملة.** المسودة الأولى كانت ترسل مستودعاً واحداً عند كل ضغطة — أي أن منح مستودع ثانٍ كان سيسحب الأول صامتاً. أُعيد البناء: مسودة محلية، وحفظ واحد، واختبار يُثبت أن المستودعين يسافران في نفس الطلب.

**٥. قاعدتان في الاعتماد تُعرضان قبل الضغط لا بعده:** من فتح الجرد لا يعتمده، ومن رفع المستند لا يعتمده. الزرّ يظهر معطّلاً مع السبب.

**٦. `stock_vouchers_screen.dart` (محمي) يغطي `voucherOnly=true` فقط.** شاشة المستندات تغطي `voucherOnly=false` — صرّحتُ بـ`false` بدل حذف المفتاح، لأن حذفه كان سيجعل القائمتين تتراكبان.

---

## ٤. الصلاحيات المستخدمة — كلها من الكتالوج

| الصلاحية | موجودة؟ |
|---|---|
| `inventory.warehouses.read` / `.manage` | ✓ |
| `inventory.batches.read` | ✓ |
| `inventory.stock.read` | ✓ |
| `inventory.stocktake.read` / `.count` / `.create` / `.approve` / `.post` | ✓ (الخمسة) |
| `inventory.writeoff.approve` / `.post` | ✓ |
| `inventory.export` | ✓ |
| `inventory.warehouse.access.read` / `.manage` | ✓ |
| `admin.users.manage` | ✓ |

**لم تُخترع صلاحية واحدة.** أربع صلاحيات من PR67 كانت ستخفي أقساماً للأبد لو نُسخت حرفياً (`inventory.documents.read`، `inventory.locations.read`، `inventory.thresholds.read`، `inventory.reports.read`) — كلها غير موجودة عندنا، واستُبدلت بالموجود الفعلي.

---

## ٥. نتائج الاختبارات — بالحقيقة الكاملة

### خلفية المشروع (مُشغّلة فعلاً، في جلسة سابقة)

| | النتيجة |
|---|---|
| `npx tsc` | **٠ خطأ** |
| `jest` | **١٤٤٦ ناجح / ٨ متجاوز** |
| `npm run test:integration:pg` | **١٣ / ١٣** |

### Flutter / Dart (هذه الجلسة)

> **٠ اختبار Dart نُفِّذ. ٠ تحليل `flutter analyze` جرى. ٠ بناء حصل.**

`flutter test` و`flutter analyze` **لم يعملَا ولا مرة**. لا يوجد SDK في هذه البيئة، ولم أستطع تنصيبه. ما يلي هو كل ما جرى فعلاً، ولا يدّعي أكثر منه.

### محاولات توفير SDK — كلها فشلت

| المصدر | النتيجة |
|---|---|
| `storage.googleapis.com` | لا اتصال |
| `pub.dev` | لا اتصال |
| `github.com` / `api.github.com` / `codeload` | `000` — أُعيدت ٥ مرات |
| `pypi.org` | متاح — لا حزمة تحمل Dart |
| `registry.npmjs.org` | متاح — لا حزمة تحمل SDK |
| `sass-embedded` (يحمل `dartaotruntime` 3.13.7) | **AOT فقط** — لا يشغّل snapshots ولا يحلّل حزمة |
| `@codacy/tools-dartanalyzer-3` | مُهايئ فقط، يطلب `dartanalyzer` على PATH |

استُنفد هذا المسار. لم أُطفئ حماية ولم أتجاوز خطأ لأجل ذلك.

### البديل الذي بُني: `tool/static_dart_check.py`

مدقّق ساكن صريح يفحص: توازن الأقواس، حَلّ كل استيراد، استيرادات غير مستخدمة، مفاتيح l10n، أسماء مكرّرة، علامات اقتباس أحادية مكسورة.

**المعايرة — وهذه هي النقطة المهمة:**

| أثر | النتيجة |
|---|---|
| ٢٨٣ ملف Dart في `lib/` و`test/` | **PASS — ٠ خطأ** |
| ٤ ملفات معروفة بالتصريف | PASS |
| عيب مزروع: استيراد مكسور | ✓ اكتُشف |
| عيب مزروع: مفتاح l10n وهمي | ✓ اكتُشف |
| عيب مزروع: قوس غير متوازن | ✓ اكتُشف |
| عيب مزروع: اقتباس أحادي مكسور | ✓ اكتُشف |

صُحّحت ثلاثة عيوب حقيقية في الشاشات بسببه (استيرادان غير مستخدمين، `AppToneOf` غير موجود، وبادئة `r_` على دالة عامة). وصُحّحت **أربعة عيوب في المدقّق نفسه** بعد أن أخذ على كود سليم: `r'...'`، و`${...}`، وامتدادات `AppLocalizations`، وقوائم `show`.

هذا **ليس** بديلاً عن `flutter analyze`. هو ادّعاء أصغر، مقول بصدق.

---

## ٦. ما لم يكتمل

| البند | الحالة |
|---|---|
| تشغيل الاختبارات التسعة | **لم يحدث** — لا SDK |
| `flutter analyze` | **لم يحدث** — لا SDK |
| `flutter build` | **لم يحدث** — لا SDK |
| ملفات مشتركة (٦) | لم تُبنَ منفردة؛ الوظائف اللازمة منها وُجدت فعلاً في `ModuleScaffold`/`RecordsTable`/`showFormSheet` |
| اختبارات (١٤) | كُتب منها ٩ (واحد لكل شاشة)، وكلها بلا تشغيل |

**ملاحظة على الستة والأربعة عشر:** العدد المذكور في `MAIN_MENU_RECOVERY_REPORT.md` كان تقديرياً. عند القراءة الفعلية للكود، ستة ملفات مشتركة لم تكن لازمة — البنية الحديثة كانت تحتويها، وبناؤها كان سيكرّر ما هو موجود. هذا مخالف للتقدير، ومطابق لقاعدة «لا تستبدل بنية PR70».

---

## ٧. الحماية

| الملف المحمي | مقابل `d3f62e9` |
|---|---|
| `import_screen.dart` | **متطابق** ✓ |
| `stock_vouchers_screen.dart` | **متطابق** ✓ |
| `stock_voucher_flow_test.dart` | **متطابق** ✓ |

- عروض الأسعار: **٠ تغيير**
- `orders` / `sales` / `purchases` / `accounting`: **٠ تغيير**
- الخلفية (`backend/`): **٠ تغيير** في التزامات هذه الجلسة
- `main` / PR67 / PR70: **لم تُلمس**

---

## ٨. حالة Git

```
ab2dc918  test(tool): make the static checker survive the whole repository
e04c8900  feat(inventory): add the warehouse access screen, edited as one draft
71fca17c  feat(inventory): add the inventory reports screen
fe426551  feat(inventory): add the stock documents screen beside the vouchers screen
71c85d5a  feat(inventory): add the write-offs screen on the document engine
4edf6fe7  feat(inventory): add the stock takes screen, approval kept intact
acc9b78e  feat(inventory): add the item thresholds screen
627cdbef  feat(inventory): add the storage locations screen, one warehouse at a time
80bc53d2  feat(inventory): add the batches screen with an expiry band
796b35b3  feat(inventory): add the warehouses screen behind its own grant
55519ce7  (قبل هذه الجلسة)
```

**١٠ التزامات محلية. ٢١ ملفاً:** ٩ شاشات + ٩ اختبارات + الموجّه + القائمة + المدقّق.

**الفرع لم يُدفع أبداً** — `git ls-remote` يُظهر ٠ مراجع له.

---

## ٩. الخطوة التالية الوحيدة

على جهاز فيه Flutter:

```bash
cd ERP_KAYAN
flutter pub get
flutter analyze          # يتوقّع نظافة تامة
flutter test test/widget/warehouses_screen_test.dart
flutter test test/widget             # التسعة
```

الاختبارات مكتوبة لتكون قابلة للتشغيل مباشرة. لو فشل شيء فهو عيب حقيقي في الشاشة، لا في الاختبار — وهذا هو الغرض منها.
