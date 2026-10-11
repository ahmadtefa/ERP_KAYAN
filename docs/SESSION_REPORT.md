# التقرير النهائي — جلسة أكتوبر 2026 / Final Report

نطاق العمل: ميزات الشركة/الفروع، «تذكرني»، دليل الحسابات متعدد المستويات،
تعريب القيود والحسابات، تحسينات التصدير، النسخ الاحتياطي والاستعادة الكاملين،
سلامة قاعدة البيانات، الاختبارات، والتوثيق — جميعها داخل المستودع الحالي.

---

## 1. ما تم تنفيذه وتشغيله فعلياً (passed)

### Backend (NestJS + Prisma + PostgreSQL 16.2 حقيقية)

| الاختبار | النتيجة |
|---|---|
| `npx tsc --noEmit` | نظيف، بلا أخطاء |
| `npm run build` | ناجح |
| `npx jest` (6 مجموعات، 45 اختباراً) | **45/45 ناجحة** — قواعد دليل الحسابات، قواعد الشعار، حمايات النسخ الاحتياطي، كتّاب التصدير (xlsx بخلايا مُعرّفة الأنواع، CSV بـ BOM، HTML RTL)، تسميات الحسابات |
| تسجيل الدخول عبر API | ناجح |
| `GET /setup/status` | ناجح (`needsSetup:false` بعد التهيئة) |
| `PATCH /company/profile` (عربي) | ناجح — حفظ العنوان العربي |
| رفع شعار PNG حقيقي | ناجح — تم التحقق من المحتوى |
| رفع ملف PNG مزيّف | **مرفوض** (400) برسالة صحيحة |
| إنشاء فرع مرتبط بالمقر الرئيسي | ناجح — `parentBranchId` مرتبط تلقائياً |
| إنشاء مقر رئيسي ثانٍ | **مرفوض** (409) — مقر واحد لكل شركة |
| إعادة قراءة الفروع | محفوظة ومستمرة |
| اقتراح كود الحساب | ناجح (1→12 و11→1101 وفق ترقيم الدليل) |
| إنشاء حساب فرعي | ناجح + تحويل الأب إلى تجميعي تلقائياً |
| كود مكرر | **مرفوض** (409) |
| أب من نوع مختلف | **مرفوض** (400) |
| حذف حساب له أبناء | **مرفوض** (400) مع اقتراح التعطيل |
| حذف حساب ورقي | ناجح |
| قيد عربي بحسابين | ناجح — أسماء الحسابات بالعربية والإنجليزية في السطور |
| ترحيل إلى حساب تجميعي | **مرفوض** (400) |
| إنشاء نسخة كاملة pg_dump | ناجح (74KB، صيغة Custom) |
| استعادة بدون تأكيد | **مرفوض** |
| استعادة مع تأكيد | ناجح — تجربة على قاعدة مؤقتة + نسخة أمان + تحقق |
| التحقق من الاستعادة (مؤشر الهاتف) | **البيانات عادت للقيمة القديمة فعلياً** |
| ملف مزيّف للاستعادة | **مرفوض** دون لمس البيانات |
| تحميل النسخة من الخادم | ناجح (سحر `PGDMP` متحقق منه) |
| تصدير دليل الحسابات xlsx | ناجح — عربي، عمود المستوى والأب، شجرة |
| تصدير القيود xlsx | ناجح — أكواد الحسابات وأسماؤها العربية، بيان السطر، الإجماليات |
| ترويسة الشركة + الشعار في xlsx | ناجح (الشعار مضمّن في xl/media) |
| Print HTML عربي RTL | ناجح |
| قدرات التصدير (PDF) | تقرير صادق: `pdfOnTheServer:false` بلا Chrome — الزر مخفي لا ميت |

### Flutter (الكود مكتوب ومكتمل)

- شاشة «بيانات الشركة» (`/settings/company`): الملف + الشعار (رفع/إزالة) + الوحدات (إنشاء/تعديل/حذف).
- «تذكرني» في تسجيل الدخول: خيار اختياري متوقف افتراضياً، اسم مستخدم في SharedPreferences، كلمة المرور **فقط** في keystore النظام، مسح بزر واحد، الويب يحفظ الاسم فقط.
- شجرة دليل الحسابات: طي/توسيع، بحث بالكود والاسمين، فلتر النوع، إنشاء/تعديل/حذف مع منتقي الأب واقتراح الكود.
- قاعدة أسماء الحسابات الموحدة `accountName/accountLabel` في الشاشات (القيود، التقارير، الشجرة).
- قسم «النسخ الاحتياطي والاستعادة» في شاشة النسخ: القدرات، إنشاء/تحميل/حذف، استعادة بتأكيد مكتوب `RESTORE` وتحذير مزدوج.
- 67 نصاً جديداً عربي/إنجليزي في ARB + الملفات المولّدة.

## 2. اختبارات غير مشغّلة — والسبب الدقيق

| الاختبار | السبب |
|---|---|
| `flutter test` (13 اختباراً قديماً + 8 جدد) | لا يوجد Flutter/Dart SDK في بيئة التنفيذ، ومصادر التنزيل (storage.googleapis.com) محجوبة. الاختبارات مكتوبة ومضمنة: `test/core/credentials_store_test.dart`, `test/shared/account_name_test.dart` — شغّلها محلياً بـ `flutter test`. |
| `flutter build web` / `flutter build windows` | نفس السبب. تحقّق محلياً بأمرَي `flutter build web` و`flutter build windows` (آلية التشغيل الخلفية لم تتغير — `docs/DESKTOP_WINDOWS.md`). |
| `flutter analyze` / `flutter gen-l10n` | نفس السبب. ملفات l10n المولّدة موسّعة يدوياً؛ شغّل `flutter gen-l10n` مرة واحدة لإعادة توليدها من ARB. |
| اختبارات PDF البصرية | لا يوجد Chrome/Chromium في بيئة التنفيذ؛ السلوك (`pdfOnTheServer:false` + إخفاء الزر) تم التحقق منه فعلياً. |
| اختبار الاستعادة على قاعدة منفصلة تماماً | تم التحقق من دورة كاملة (إنشاء → تعديل → استعادة → تحقق) على قاعدة التطوير الحية؛ `kayan_test` مهيأة لاستقبال اختبارات tsc/jest التكاملية لاحقاً. |

## 3. الملفات الجديدة (رئيسية)

- `PROJECT_KNOWLEDGE.md` (كان مفقوداً) — مرجع النظام الكامل.
- `docs/BACKUP_RESTORE.md` — تصميم النسخ والاستعادة وخطة التعافي.
- `backend/src/modules/company/**` — الملف والشعار والوحدات والإعداد الأولي.
- `backend/src/modules/backup/full-backup.service.ts` + `.controller.ts` + اختباراتهما.
- `backend/src/common/maintenance/**` — قفل الكتابة أثناء الاستعادة.
- `backend/src/common/localization/account-name.ts` + `lib/shared/utils/account_name.dart`.
- `backend/prisma/migrations/20261011120000_company_profile_and_branch_hierarchy/` (تجميعية فقط).
- `lib/core/storage/credentials_store.dart`, `lib/features/settings/**`, `lib/features/data/presentation/widgets/full_backup_section.dart`.
- اختبارات: `chart-of-accounts.service.spec.ts`, `company.service.spec.ts`, `full-backup.service.spec.ts`, `writers.spec.ts`, `account-name.spec.ts`, `test/core/credentials_store_test.dart`, `test/shared/account_name_test.dart`.

## 4. الملفات المعدّلة (رئيسية)

`backend/prisma/schema.prisma` (تجميعي: Company + BranchKind + Branch.parentBranchId)،
`backend/prisma/seed.ts` (صلاحيات جديدة + متغيرات KAYAN_COMPANY_*)،
`backend/scripts/prepare-database.mjs` (محرك PrismaPg)،
`chart-of-accounts.service.ts` + `.controller.ts`، `journal-entries.service.ts`،
`export/*` (writers/pdf/list-tables/report-tables/controller)، `app.module.ts`،
`lib/features/accounting/**` (الكيان/DTO/المصدر/المستودع/المزودات/الشجرة)،
`lib/features/auth/presentation/screens/login_screen.dart`،
`lib/features/data/**` (مزودات + شاشة النسخ)،
`lib/features/reports/presentation/reports_screen.dart`،
`lib/app/router/app_router.dart` + `lib/app/shell/erp_shell.dart`،
`lib/l10n/app_ar.arb` + `app_en.arb` + الملفات الثلاثة المولّدة،
`README.md`, `.gitignore` (استثناء backend/backups).

## 5. مراجعة أكتوبر 2026 — الجولة الثانية (ما أُصلح فعلاً)

1. **الصلاحيات**: migration تجميعية جديدة
   `20261011160000_grant_new_permissions` تمنح الصلاحيات الجديدة للأدوار
   المناسبة على أي قاعدة قديمة (الـseed لا يُعاد تشغيله أبداً على قاعدة
   موجودة). السياسة: `accounts.read` لمن يقرأ الدفاتر/الفترات/التقارير،
   `accounts.create/update/delete` لمن ينشئ القيود، `admin.company.manage`
   لمن يدير المستخدمين فقط. مُختبرة فعلياً: محاكاة قاعدة قديمة على `kayan_test`
   (حذف الصلاحيات ثم إعادة الـmigration → النتائج مطابقة للسياسة)، idempotent
   (إعادة التشغيل تُدرج صفراً)، و4 اختبارات enforcement حية عبر API (200/403
   مع مستخدم غير مدير). تُحذف أي صفوف الاختبار المؤقتة بعدها.
2. **الترجمات**: مصدر الحقيقة هو `lib/l10n/app_ar.arb` + `app_en.arb`. أُصلح
   خلل `{0}` (placeholder غير صالح) في المصدر، والملفات المولّدة مطابقة لما
   سيُنتجه المولّع. **الأمر المطلوب محلياً** (من جذر المستودع حيث
   `l10n.yaml`): `flutter gen-l10n` ثم `flutter analyze` ثم `flutter test` —
   وبعدها لا تُعدَّل الملفات المولّدة يدوياً إطلاقاً.
3. **أدوات النسخ في حزمة Windows**: خطوة 5 في `build-desktop-windows.ps1`
   تنسخ `pg_dump.exe` + `pg_restore.exe` + مكتباتهما داخل `backend\pg\` من
   الأداة المحمولة (`install-postgres-portable.bat`) أو من PostgreSQL المثبّت
   (الأحدث أولًا)، وتتوقف إن لم تعمل النسخ من مكانها. `verify-package.ps1`
   يفحص الشيء نفسه. وقت التشغيل: ترتيب اكتشاف جديد (المجلد المرفق ← الأداة
   المحمولة ← PATH ← التثبيت) + تحذير في `capabilities` لو pg_dump أقدم من
   السيرفر (مُختبر باختبارين jest يشغّلان المسار فعلياً). لا تثبيت ولا
   استبدال ولا تغيير مصادقة.
4. رسائل التحقق من الخادم بالإنجليزية (Problem Details)؛ رسائل الواجهة
   معربة. تعريب رسائل الخادم بالكامل عمل مستقبلي.

## 6. ما يجب تنفيذه على جهاز Windows المحلي

1. `flutter gen-l10n && flutter analyze && flutter test` — إعادة توليد
   الملفات المولّدة من ARB وتشغيل اختبارات Dart (13 اختباراً قديماً + 8 جدد).
2. `flutter build web` (يجب أن ينجح) ثم
   `powershell -ExecutionPolicy Bypass -File scripts\build-desktop-windows.ps1`
   (يحتاج `scripts\install-postgres-portable.bat` قد شُغّل مرة واحدة على
   الأقل ليتوفر مصدر أدوات pg، وإلا يتوقف البناء برسالة واضحة).
3. `powershell -ExecutionPolicy Bypass -File scripts\verify-package.ps1`
   للتحقق من النسخة، ثم تجربة زر «إنشاء نسخة كاملة» من داخل البرنامج.
4. على أي قاعدة بيانات حقيقية قديمة: شغّل `prisma migrate deploy` (يُطبّق
   migration الصلاحيات تلقائياً) — ولا يُحذف أي شيء.

## 7. بيانات

لم تُحذف أو تُستبدل أي بيانات. جميع تغييرات المخطط **تجميعية** (5 تطبيقات migrate فقط). عمليات الاستعادة خلال الاختبارات أُعيدت بعدها البيانات بحالة مطابقة (تم التحقق بمؤشر الهاتف)، وحُفظت نسخة أمان على الخادم.
