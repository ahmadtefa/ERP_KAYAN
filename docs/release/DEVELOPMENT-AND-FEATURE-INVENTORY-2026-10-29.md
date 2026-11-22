# سجل التطويرات وخريطة الإصدار — غير نهائي

تاريخ الرصد: 2026-10-29. أساس الفحص: `arena/2d794f08-erp-kayan` عند `54caf5913090dcab620cc6e8ce2550b234759f7b`. هذه وثيقة عمل، **وليست شهادة اكتمال أو قبول إصدار**. تغييرات المصدر اللاحقة تحتاج إعادة التحقق وربطها بالمثبت نفسه.

## الدليل الآلي وحدود الجرد

الملف المصاحب `DEVELOPMENT-INVENTORY-2026-10-29.json` يسجل، كما رُصدت، 78 مرجعًا بعيدًا، و62 PR، وقائمة الـ52 migration، و175 ملف اختبار، وحالة شجرة العمل، ونتائج خطوات CI المختارة. لكل فرع يسجل نقطة الالتقاء، وعدد commits غير الموجودة في المرشح، والتغييرات منذ نقطة الالتقاء إن وجدت؛ وللفروع الـ65 بلا سلف مشترك يسجل اختلاف شجرتي الملفات مباشرةً، لا على أنه دليل فقد وظيفي. اختلاف التاريخ أو عدم كونه سلفًا **لا يثبت فقد سلوك**: قد تكون التغييرات نُقلت أو سُوِّيت؛ كما أن وجود ملف لا يثبت أن الميزة تعمل. المراجعة الدلالية لكل فرق لم تكتمل، فلا يجوز وصف هذا السجل بأنه استنفد كل السلوكيات الصحيحة.

الفرع الحالي يتضمن `main` (`1d390015b14f78311847dc6e0522da97bc2de9a6`) في تاريخه، وكذلك `2ccbb5c9580e15fccd6dff260d70b50c1796afdf` و`3f1e8a72c3fdc21f382d54fec06be9e8583615b9`. لكنه ليس دليلًا كافيًا وحده على الاحتفاظ بكل محتوى كل فرع؛ خصوصًا عند وجود دمج وتعديلات لاحقة. PR #63 مفتوح على `arena/5208506e-erp-kayan`: رأسه `7e0ee38ad4a71f19e1a1e8a1c5f1a9cca863710b`، ويتضمن تعديلين بعد نقطة التقاطع في استعادة الترخيص. لم يُدمج هذان التعديلان في المرشح، ويجب فحصهما مقابل التصميم الجديد واختبارات الأمان؛ لا يُقبل عزل الحالة التالفة وإعادة إنشائها دون التحقق من سلامة معلومات المنع من إعادة الاستخدام وعدادات الزمن والمقاعد.

PR #52 و#53 وفرع `release/acceptance-candidate-2026-10` لديهم تاريخ متباعد عن المرشح. هناك تداخل واسع مع العمل المحلي المدمج سابقًا، لكن لا توجد هنا مراجعة دلالية شاملة لكافة الفروق. لا يُدمج أيٌّ منها كاملًا بصورة عمياء؛ تُقارن العقود والاختبارات والـmigrations وتُنقل الإصلاحات الناقصة فقط بعد إثباتها. تفاصيل المسارات والـcommits في JSON. ملفات العمل المحلية الأصلية و`preservation/worktree-20261029/` باقية؛ هذا الجرد لا ينسخ الأسرار أو محتويات ملفات fixture.

## مصفوفة الميزات الحالية والمرشح النهائي

كل سطر أدناه: **المصدر موجود في المرشح، الاحتفاظ ومراجعة الفروع** ما لم يذكر خلاف ذلك. عمود الدليل يحدد الخدمات أو الواجهات والاختبارات الموجودة، لا يزعم أن أي شاشة أو اختبار منفرد أثبت الميزة من طرف إلى طرف. نتائج الاختبارات الشاملة موثقة بعد الجدول. لم ينجح اختبار المثبت النهائي؛ لذلك **وجود أي ميزة داخل مثبت مُسلَّم وعملها عليه غير مثبت في كل الصفوف**.

| الميزة / التطوير | المصدر والاعتماديات | دليل كود واختبارات؛ القرار |
|---|---|---|
| المبيعات والفواتير | `backend/src/modules/sales/`, `lib/features/invoicing/`, Prisma | `sales-invoices.service.spec.ts`, `sales-invoices.units.spec.ts`؛ الاحتفاظ واختبار دورة الإنشاء والترحيل والعكس والصلاحيات. |
| عروض الأسعار والتصميم | `backend/src/modules/sales/quotations.service.ts`, `lib/features/quotations/` | `quotation-document.spec.ts`, `quotation-pdf.spec.ts`, `quotation_editor_test.dart`؛ مراجعة PR #53 وفروق PDF والقوالب. |
| أعمدة كل جدول وقوالب الأسعار | `quotation-columns.ts`, `quotation-column-templates.service.ts`, migrations القوالب | `quotations.columns.spec.ts`, `zz_quotation_editor_columns_test.dart`؛ مراجعة تداخل PR #52 و#53 مع العمل المحلي. |
| المشتريات والتكاليف الإضافية | `backend/src/modules/purchases/`, محرر الفواتير | `purchase-invoices.service.spec.ts`, `landed-cost-allocation.spec.ts`, `invoice_editor_landed_cost_test.dart`؛ الاحتفاظ. |
| العملاء والموردون والأرصدة | `backend/src/modules/parties/`, `lib/features/parties/` | `parties.service.statement.spec.ts`, `parties.service.summary.spec.ts`؛ مراجعة بيانات وكشوف فعلية. |
| المخازن والحركة | `backend/src/modules/inventory/`, `lib/features/inventory/` | `items.service.spec.ts`, `stock-documents.warehouse-guard.spec.ts`؛ مراجعة سلامة الرصيد والتزامن. |
| الباركود والوحدات المتعددة وإخفاء التكلفة | `backend/src/modules/inventory/`, migrations 20261027120000 و20261027130000 | `barcode.spec.ts`, `items.barcode.spec.ts`, `cost-redaction.spec.ts`, `invoice_unit_selection_test.dart`؛ PR #60/#61 في التاريخ، ويتطلب اختبار أجهزة وسيناريوهات المستخدم. |
| المرتجعات | `backend/src/modules/returns/`, `lib/features/invoicing/presentation/screens/returns_screen.dart` | `returns.service.spec.ts`, `returns.units.spec.ts`؛ الاحتفاظ والتحقق من المخزون والقيد. |
| الحسابات ودليل الحسابات والقيود | `backend/src/modules/accounting/`, `lib/features/accounting/` | `posting.service.spec.ts`, `chart-of-accounts.service.spec.ts`, `journal_entry_test.dart`؛ مراجعة فروع عكس القيود المتزامن. |
| الأستاذ العام وميزان المراجعة والقوائم | `backend/src/modules/reports/`, `lib/features/reports/` | `reports.service.spec.ts`, `trial-balance-groups.spec.ts`, `reports_accounting_tabs_test.dart`؛ إثبات الأرقام فعليًا ما زال مطلوبًا. |
| مراكز التكلفة والموازنات | `cost-centers.service.ts`, `budgets.service.ts`, واجهات المحاسبة | `budgets.service.spec.ts`, `invoice_cost_center_test.dart`, `cost_centers_screen_test.dart`؛ الاحتفاظ واختبار القيد والتقرير. |
| المدفوعات والتحصيل والمطابقة | `backend/src/modules/cash/`, `lib/features/cash/` | `cash-vouchers.service.spec.ts`, `bank-reconciliation.service.spec.ts`, `voucher_allocation_test.dart`؛ الاحتفاظ ومراجعة منع المطابقة المكررة. |
| الشركات والفروع والإعداد الأول | `backend/src/modules/company/`, `lib/features/settings/` | `company.service.spec.ts`, `setup.service.spec.ts`, `company_setup_form_test.dart`؛ الاحتفاظ وعدم نقل بيانات حقيقية إلى الاختبارات. |
| المستخدمون والأدوار والصلاحيات | `backend/src/modules/admin/`, `backend/src/common/guards/permissions.guard.ts` | `permission-escalation.spec.ts`, `permissions.catalogue.spec.ts`, `permissions.guard.spec.ts`؛ الاحتفاظ بالمنح المباشرة وعدم الاكتفاء بإخفاء عناصر الواجهة. |
| النسخ الاحتياطي والاستعادة | `backend/src/modules/backup/`, `docs/BACKUP_RESTORE.md` | `backup.service.spec.ts`, `full-backup.service.spec.ts`, `restore-access.spec.ts`, `full_backup_section_test.dart`؛ استعادة المنتج المثبت لم تثبت. |
| بدء بيئة جديدة وإعادة الضبط | `backend/src/modules/admin/`, `lib/features/settings/`, `distribution/windows/reset-kayan.ps1` | مراجعة النسخة الاحتياطية الإلزامية والتأكيد وعدم حذف قاعدة المستخدم. لا تشغيل على بيانات فعلية. |
| الترخيص الحالي وحالة التلف | `backend/src/modules/licensing/`, `lib/features/licensing/`, migration 20261025120000 | `license-store.spec.ts`, `installed-corrupt-state-safety.spec.ts`, `verify-licensing-postgres.mjs`؛ إعادة التصميم والترحيل مطلوبان ولم ينفذا بعد. |
| مولّد التراخيص | `tools/license-generator/kayan-license.mjs`, `license-gui.mjs`, `windows/` | `memory-flow.test.mjs`; إصدار Windows تاريخي، وليس اختبارًا لنظام جديد. فحص وظائف التسجيل والتجديد والمقاعد والنقل والتدقيق قبل تغيير السلوك. |
| السمات والألوان وهوية الواجهة | `lib/app/theme/`, `lib/features/`, `lib/shared/` | `design_tokens.dart`, واختبارات Widget والشاشات؛ لا يكفي وجود Theme لإثبات كل لون قسم. |
| PDF والطباعة والخط العربي | `backend/src/modules/export/`, `backend/src/modules/sales/quotation-pdf.spec.ts`, `docs/fonts/` | `pdf.service.spec.ts`, `quotation-pdf.spec.ts`, `quotation_document_test.dart`؛ التحقق على Windows وOffline مطلوب. |
| لوحة المعلومات والبحث | `backend/src/modules/dashboard/`, `backend/src/modules/search/`, الميزتان في `lib/features/` | `search.service.spec.ts`؛ مراجعة لوحة الشركة وتحديث البيانات الفعلية. |
| الأصول الثابتة والإهلاك | `backend/src/modules/fixed-assets/`, `lib/features/fixed_assets/` | `depreciation.spec.ts`؛ الاحتفاظ واختبار القيد الفعلي. |
| المصادقة والجلسات والاستعادة | `backend/src/modules/auth/`, `lib/features/auth/`, `lib/core/backend/` | اختبارات auth و`test/core/backend/local_backend_io_test.dart`؛ مراجعة PR #52 وصلاحيات المستخدم. |
| PostgreSQL وPrisma والترقيات | `backend/prisma/schema.prisma`, جميع migrations في JSON | `backend/scripts/verify-prisma-native-upgrade.mjs`: نجح clean وpopulated في تشغيل المرشح؛ ليست دليلًا على ترقية كل الإصدارات المنشورة. |
| مثبت Windows والمكونات | `distribution/windows/build-installer.ps1`, `installer.iss`, `.github/workflows/windows-integrated-candidate.yml` | فُك المثبت المرشح وفُحص محتواه في CI، ولكن اختبار التحديث فشل؛ لا تسليم. |
| الإصلاح وتشغيل Backend محليًا | `distribution/windows/repair-runtime.ps1`, `RepairTool.cs`, `lib/core/backend/local_backend_io.dart` | توجد اختبارات وسكربت smoke؛ اختبار الإصلاح على مثبت نهائي لم يصل إلى النجاح. |
| Offline وتوزيع الاعتماديات | `docs/release/WINDOWS-OFFLINE-DEPENDENCY-AUDIT-2026-10-29.md`, سكربت smoke | وجود حظر الشبكة في الاختبار لا يثبت اكتمال السيناريو إذا فشل التشغيل قبل نهايته. |

## نتائج فعلية حديثة على الأساس المرصود

- [Integrated candidate 40933332071](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40933332071): فحص تطابق المفتاحين داخل الذاكرة، ومولد المصدر الاصطناعي، وPrisma clean/populated وPostgreSQL licensing، وبناء المثبت وفك الحمولة والتحقق منها: **نجحت**. اختبار Windows المثبت فشل عند التحديث/إعادة التثبيت؛ الخدمة كانت متوقفة وظهر خطأ أثناء خطوة runtime. التحقق من المرفوع **skipped**.
- [Windows Installer 40933331986](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40933331986): فشل فحص الحمولة بأداة 7z التي لا تفك تنسيق Inno المنتج؛ اختبار التطبيق المثبت والنشر لم ينفذا. لا يعد نجاح البناء نجاحًا للمثبت.
- [Windows preflight 40933332023](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40933332023): `flutter analyze` و`flutter test` نجحا؛ فشل فحص Inno التشخيصي.
- [Installer safety 40933332053](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40933332053): اختبارات migration safety وbackup UI نجحت؛ ليست اختبار تثبيت أو استعادة شركة مثبتة.
- فحص محلي لاحق: 22 اختبار Node لسياسة المفتاح وفحص payload الاصطناعي والمولد في الذاكرة نجحت، وأربعة اختبارات لوظيفة بصمة V2 المعزولة نجحت. الأخيرة ليست موصولة بالمنتج ولا تختبر قراءات عتاد Windows.
- اختبار `backend/src/modules/licensing/license-generator.spec.ts` المستبعد لأنه يكتب مفتاحًا اصطناعيًا على القرص ليس ناجحًا بالاستبعاد. اختبار المولد في الذاكرة لا يثبت EXE Windows المعبأ.

## قرارات غير محسومة تمنع إعلان الجاهزية

1. مراجعة الفروع غير السلفية والميزات التي نُقلت بمحتوى مختلف، وإضافة أدلة قبول حقيقية لكل صف؛ JSON جرد قابل للتدقيق لا بديل عن المراجعة.
2. اختيار صيغة ترخيص قابلة للاستعادة وخطة ترحيل تحفظ التراخيص وقيود الساعة والمقاعد ومنع إعادة الاستخدام. التحقق العام المضمّن يحافظ على تجربة بسيطة للعميل دون سر توقيع لديه؛ أي سر مشترك داخل العميل قابل للاستخراج. استعادة حالة زمن/مقاعد موثوقة من شهادة توقيع أولية وحدها لا يمكن إثباتها إذا كانت المعلومات غير موجودة فيها.
3. إثبات ترقية من النسخ السابقة بالمفتاح السابق: فحص المفتاح في المثبت يرفض حاليًا الترقية عند اختلاف المفتاح. عدم تجاوز الحاجز إلى أن تتوفر خطة ترحيل موثوقة.
4. إصلاح فشل خدمة PostgreSQL أثناء إعادة التثبيت وإعادة اختبار نفس `Setup.exe`، ثم اختبار التفعيل وإعادة التشغيل والتلف والنسخ الاحتياطي والإصلاح Offline على Windows معزول.
5. اكتمال اختبارات المنتج ورفع الملف المختبر، ثم تنزيله والتحقق من بصمته. لا رابط تنزيل نهائي ولا SHA لتسليم متاحان حاليًا.
