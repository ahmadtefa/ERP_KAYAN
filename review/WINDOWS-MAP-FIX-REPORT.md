# إصلاح فشل Windows Installer — Source Maps في الحمولة

**Commit النهائي:** `3c1143dd`
**التشغيل:** [42901077717](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/42901077717)
**فرضية الطلب:** صحيحة — والتشغيل أثبتها.

---

## ١. السبب الجذري

**الإصلاح السابق كان ناقصًا.** استبعدت `.map` أثناء نسخ `dist` و`prisma`، لكن ترتيب البناء مختلف:

| # | الخطوة | ينتج `.map`؟ |
| --- | --- | --- |
| 1 | `npm ci` في `backend` (المصدر) | نعم |
| 2 | نسخ `dist` + `prisma` إلى `$app` | **استُبعد هنا** ✓ |
| 3 | **`npm ci --omit=dev` داخل `$app/backend`** | **نعم ← 3,830 ملفًا** |
| 4 | `prisma generate` | نعم |

الحلقة التي تستبعد `.map` تعمل عند الخطوة 2. لكن `npm ci` في الخطوة 3 **يكتب `node_modules` داخل الحزمة المجهّزة بعدها**، فيُدخل 3,830 ملفًا لم يرها أي استبعاد.

**الدليل من التشغيل `42895714241`:**

```
The payload contains 3830 source map file(s), which production must not ship:
app/backend/node_modules/@fast-csv/format/build/src/formatter/rowformatter.js.map, …
```

الحارس الذي أضفته **عمل كما صُمم**: رفض الحزمة بدل شحنها. لم أخفّفه.

---

## ٢. الإصلاح

ثلاث طبقات، ولا واحدة تعطّل Source Maps في التطوير:

| الطبقة | الموضع | ماذا تفعل |
| --- | --- | --- |
| ١ | نسخ `dist`/`prisma` | تتخطى `.map` أثناء النسخ (باقٍ من الإصلاح السابق) |
| ٢ | **جديد** — `[2b/8]` بعد `npm ci` + `prisma generate` | `Get-ChildItem -Filter '*.map' -Recurse` على الحزمة المجهّزة كاملة |
| ٣ | **جديد** — `[6/8]` قبل Inno | `throw` إن بقيت أي `.map` |

**الطبقة ٢ تحذف من النسخة المجهّزة فقط:**
- `$stagedRoots = @($app/backend, $app/build)` — لا `$backend`.
- `node_modules` الأصلي و`dist` الأصلي لم يُمَسّا.
- `tsconfig.json` ما زال `"sourceMap": true`.
- المصادر في المستودع سليمة.

**حماية ملفات runtime:** لا مدخل واحد في قائمة الإلزام الـ36 ينتهي بـ`.map` (تحققت: `0`). ومع ذلك، التنقية ترفض الحذف إن طابق ملفًا مطلوبًا:

```powershell
if ($relativeMap -eq $required) { throw "Refusing to remove a required runtime file: $relativeMap" }
```

`Prisma` (`.js`), `PostgreSQL` (`.exe`, `.dll`), الترحيلات (`.sql`) — لا امتدادات `.map`.

---

## ٣. عدد ملفات `.map` قبل وبعد

| ٍالمرحلة | العدد | الحجم |
| --- | --- | --- |
| في `backend/dist` (المصدر) | 411 | 3.3 MB |
| في `node_modules` بعد `npm ci` (داخل الحزمة) | **3,830** | — |
| **الإجمالي قبل التنقية** | **4,241** | — |
| **بعد التنقية** | **0** | — |

**الدليل المادي — حجم الأثر:**

| | البايت | الفرق |
| --- | --- | --- |
| `70c90e95` (برفض) | 151,314,967 | — |
| `3c1143dd` (نظيف) | 145,359,349 | **−5,955,618 بايت ≈ 5.96 MB** |

الفرق يتسق مع حجم 4,241 ملفًا. **لو لم تُزل، لبقي الحجم كما هو.**

---

## ٤. اختبارات الحماية

| المجموعة | النتيجة |
| --- | --- |
| `verify-extracted-windows-installer` | **19/0** |
| payload + Inno + remove-everything + build-only + preflight | **69/0** |
| `ci-workflow-safety` | PASS |
| `inno-code-constants` | PASS |
| `verify-windows-scripts` | PASS (9 سكربتات) |

### الاختبارات المضافة (٤)

1. رفض `.map` في `backend/dist` (من الجولة السابقة)
2. رفض `.map` في **أي مسار** — بما فيه `build/web/`
3. **إعادة إدخال `.map` تُفشل الفحص** — بالمسارات الحقيقية التي فشل بها `42895714241`
4. عدّاد يعترف بالعدد (`contains 7 source map`)
5. قاعدة التنقية: بعد `npm ci`، تبحث في كل العمق، ولا تلمس `$backend`

### التحقق العكسي (٣، كلها كُشفت)

| العبث | النتيجة |
| --- | --- |
| **حذف تنقية node_modules** (إعادة إنتاج العيب الحقيقي) | ✗ 18/1 |
| نقل التنقية **قبل** `npm ci` | ✗ 18/1 |
| توجيه التنقية إلى `node_modules` الأصلي | ✗ 18/1 |

---

## ٥. نتيجة استخراج وفحص Setup

| الوظيفة | النتيجة |
| --- | --- |
| Build KAYAN ERP for Windows x64 | ✅ **success** |
| **Extract and verify the actual payload** | ✅ **success** |
| Publish independently verified Windows installer | `skipped` (ليس push إلى main) |
| Install and exercise the inspected Setup offline | `cancelled` ← **بوابة بيئة** |

**ملف Setup:**

| | |
| --- | --- |
| الاسم | `KAYAN-ERP-Setup.exe` |
| **SHA256** | `FDB0291EEC3D021793C85D67F3D866751AAE6B7E52D2572FAD04090A915214F9` |
| الحجم (النسخة المستخرجة) | 145,359,953 بايت |
| Commit | `3c1143dd` |
| Licence | enforcement ON, product |

الفحص يعيد `payload-inspection-passed-not-install-tested` — **أي أنه لا يدّعي اختبار تثبيت.**

---

## ٦. Windows Offline Smoke Test — **لم يُنفَّذ**

**هذا هو البند الوحيد الذي لم أنجزه، والسبب خارج قدرتي.**

```
Install and exercise the inspected Setup offline: waiting → cancelled
```

البيئة `windows-installer-test` تتطلب موافقة `ahmadtefa`:

```
required_reviewers: [ahmadtefa]
current_user_can_approve: false
```

**حتى بحساب `admin: true`، لا أستطيع الموافقة.** هذه حماية GitHub تعمل كما صُممت، ولم أحاول تجاوزها.

**ولذلك — وفق شرطك التاسع — لا أعتبر البناء نجاحًا نهائيًا.**

| مُثبت | غير مُثبت |
| --- | --- |
| Setup بُني | التثبيت على Windows |
| الحمولة نظيفة (0 `.map`) | التشغيل دون إنترنت |
| الفحص نجح | PostgreSQL كخدمة |
| 4,241 ملفًا أُزيلت | الترحيلات على جهاز حقيقي |
| SHA256 مؤكد | Repair / Uninstall |

---

## ٧. الإصلاحات المحفوظة

| الإصلاح | الحالة |
| --- | --- |
| الضريبة الفارغة = 0 | ✅ `import.service.ts:1507` |
| Accordion مجموعة واحدة | ✅ `erp_shell.dart` |
| FEFO | ✅ `batch-policy.ts` |
| الترخيص | ✅ 245/245، مفتاح عام فقط |
| Complete Uninstall | ✅ 13/0 |
| `mbConfirmation` | ✅ 2 |
| الصور / النسخ الاحتياطي | ✅ لم تُمَس |

---

## ٨. المطلوب منك

**خطوة واحدة تحوّل «Setup مبني» إلى «Setup مثبَّت»:**

> **وافق على بيئة `windows-installer-test`** في التشغيل القادم. عندها تُنفَّذ وظيفة `Install and exercise...` على Windows runner معزول — **دون أن تلمس جهازك** — وتُختبر: التثبيت، التشغيل دون إنترنت، PostgreSQL، الترحيلات، الإصلاح.

بعدها فقط يمكنني القول إن Setup يعمل.

---

**الفرع `3c1143dd`.** لم أدمج، ولم ألمس `main`، ولم أنشر Release، ولم أخفّف أي فحص.
