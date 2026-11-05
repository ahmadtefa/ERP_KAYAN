# جرد البنود الأحد عشر — 2026-11-05

نقطة البداية `3cbbd37fd5ad5e4dcbe671335562dec32dbeccaa`، فرع الجلسة `arena/2d794f08-erp-kayan`، PR #70 Draft. جدول أولي قبل التعديل؛ «جزئي» يعني وجود تنفيذ وأدلة محددة لا استيفاء جميع المعايير. لا يعني نجاح CI اختبار تطبيق مثبت أو بيانات عملاء. لا تُحذف التقارير السابقة.

| # | البند | الحالة عند البداية | الملفات والخدمات والواجهات والأدلة | النقص المحدد |
|---|---|---|---|---|
| 1 | الضريبة | جزئي | `items.service.ts`, `item-tax-blank.spec.ts`, `item-tax-http.spec.ts`, واجهة `items_screen.dart`, `item_blank_tax_test.dart`; `verify-order-http-real-pg.cjs` للفواتير/الأوامر | ليس كل الدورات وواجهة متصلة فعلية، ولا دليل لكل صيغ الإدخال بكل المسارات |
| 2 | التحديث بعد الترحيل | جزئي | مزودات الفواتير والجرد والحسابات؛ `invoice_action_refresh_error_test.dart`, `opening_balance_post_refresh_test.dart`, `stock_voucher_flow_test.dart` | ليس كل الشاشات والتبعيات/فقد الرد مثبتة بالمصدر الحقيقي |
| 3 | Refresh | جزئي | `resource_refresh_race_test.dart`, `chart_refresh_race_test.dart`, `stock_ledger_retry_test.dart`, واجهات الوحدات | لم يُثبت كل شاشة أو سلامة المدخلات عند كل تحديث |
| 4 | الرجوع والمسودات | جزئي | `form_sheet.dart`, `form_sheet_unsaved_test.dart`, `invoice_unsaved_guard_test.dart`, `return_unsaved_guard_test.dart`, `module_scaffold_navigation_test.dart` | لم يُثبت جميع المسارات والتنقل الخارجي وإغلاق Windows وفقد الاتصال لكل نموذج |
| 5 | القائمة وRTL/LTR | جزئي | `erp_shell.dart`, `erp_shell_groups_test.dart`, `erp_shell_test.dart`, السمات و`app_ar/en.arb` | وصول جميع الروابط والصلاحيات والتباين وحفظ الحالة بكلا الاتجاهين لم يثبت بالكامل |
| 6 | الصورة | جزئي | `auth/profile-photo.service.ts`, controller واختباراتهما، `user_photo_test.dart` وfixture HTTP/PG | دورة دخول/خروج وإعادة تشغيل المنتج المثبت وعزل cache بين المستخدمين لم تثبت بالكامل |
| 7 | Home | جزئي | `erp_shell.dart`, `module_scaffold.dart`, `module_scaffold_navigation_test.dart`, `return_unsaved_guard_test.dart` | ليس جميع النوافذ/المسودات والتنقل الخارجي |
| 8 | دليل الحسابات | جزئي | `chart-of-accounts.service.ts`, `account-update-contract.spec.ts`, `chart_of_accounts_screen.dart`, `chart_of_accounts_interaction_test.dart`, fixtures PG | بعض السبل/السباقات والقيود والحركة التاريخية وSQL المباشر لم تثبت جميعها |
| 9 | الأخطاء | جزئي | `app_error_dialog.dart`, `app_error_text.dart`, `app_error_dialog_lifecycle_test.dart`, `problem-details.filter.spec.ts` | ليس كل catch والمسارات والرموز والواجهات مراجعًا |
| 10 | أذون المخزون | جزئي | `stock-documents.service.ts`, `stock_vouchers_screen.dart`, `stock_voucher_flow_test.dart`, `verify-voucher-http-real-pg.cjs`, `stock-voucher-export.spec.ts` | الطباعة والتكامل والأدوار وفقد الاتصال ليسوا شاملين؛ سباق تعطيل مركز التكلفة والترحيل |
| 11 | المخزون ومراكز التكلفة | جزئي | `stock-documents.service.ts`, `stock.service.ts`, `posting.service.ts`, `verify-stock-documents-real-pg.cjs`, `verify-voucher-http-real-pg.cjs` | تنافسات والتسويات والتحويلات والتقارير والسياسة التاريخية ليست شاملة |

دليل البداية: [Safe 41990413260](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41990413260) Backend/typecheck وPG اصطناعي وFlutter 564/0/0/0؛ [Windows 41990413105](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41990413105) بناء دون Setup؛ [Gate 41990413181](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41990413181) إشعار فقط. اختبارات Flutter وPostgreSQL لا تعني أن كل بند أو المنتج المثبت قد اختُبر من النهاية للنهاية.

Full Backup/Restore محجوبان؛ DB-only غير كامل. لا يوجد manifest مرتبط بالترخيص مثبت أو شاهد freshness مستقل أو استعادة ذرية متعددة الموارد/عبر crash. أدلة توقيع وصلاحية وإلغاء وترخيص فعلي وWindows 10/11 غير متاحة. لا إصدار أو Setup.

## عمل المجموعة 1: تزامن مركز التكلفة والصرف

أضيف قفل صف `FOR SHARE` لمركز تكلفة إذن الصرف داخل معاملة الترحيل قبل إعادة التحقق، في `stock-documents.service.ts`. تحديث أو حذف المركز لا يمكنه تجاوز القفل: التغيير الملتزم أولًا يظهر للتحقق، أو ينتظر إلى ما بعد الترحيل. لا تُفرض هذه القاعدة الجديدة على التحويلات أو التسويات أو السجلات القديمة غير المصنفة ISSUE. أضيف سباقان محكومان في `verify-voucher-http-real-pg.cjs`؛ يراقب الاختبار انتظار الأقفال في PostgreSQL، ويتحقق من رفض الصرف عند التعطيل أولًا ومن نجاحه قبل التعطيل عند الترحيل أولًا. يظل JWT بديلًا اصطناعيًا، ولا يشمل جميع العمليات أو SQL المباشر أو إثبات التطبيق المثبت. اختبارات محلية غير موقعة مع Prisma shim: 3 مجموعات، 12 ناجحًا؛ لا تمثل PostgreSQL أو typecheck. نتيجة PG وFlutter وWindows على commit المجموعة مطلوبة في CI.
