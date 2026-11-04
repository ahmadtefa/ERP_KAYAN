# GitHub Actions audit — PR #70

المرجع الذي بدأ منه الفحص `6c44e5b5879372ffbdd292ab0d40c6294a8bcf34`. سجل النتائج أدناه تاريخي ومربوط بكل SHA؛ لا يعني نجاحًا للرأس الجديد. لا توجد مفاتيح خاصة أو بيانات عملاء في هذا التقرير.

## ملفات workflows في فرع PR بعد التعديلات

- `_licence-step-diagnose.yml`: تشخيص قديم يشغّل مولد مفاتيح ويخفي نتائج جزئية بـcontinue-on-error؛ محجوز يدويًا ولا يُشغّل في CI.
- `ci.yml`: CI قديم شامل Backend وPostgreSQL وFlutter وLinux وregression؛ يدوي فقط، يحوي اختبارات ترخيص مولِّدة/موقعة وغير مراجع كمسار تلقائي آمن.
- `installer-focused-tests.yml`: اختبارات هجرة وسياسة مثبت وواجهة backup؛ يتضمن اختبار سياسة يولّد مفاتيح، فحُجز يدويًا مع إبقاء جميع jobs/tests.
- `installer-historical-inventory.yml`: جرد Inno قديم قراءة فقط؛ push إلى فرع الجلسة مع paths محددة؛ لا يبني أو يثبت.
- `key-generator.yml`: مولد مفاتيح Windows؛ يدوي فقط ولا يُشغّل ضمن CI وفق السياسة الحالية.
- `licence-startup-focused.yml`: اختبارات بدء الواجهة وماسح الحزمة؛ الماسح القديم يولد مفتاحًا خاصًا، فحُجز يدويًا مع إبقاء jobs/tests.
- `release-evidence-gate.yml`: بوابة أدلة الترخيص والمنتج المثبت مستقلة، تفشل عمدًا عند غياب الدليل؛ pull_request إلى main أو arena/** وpush إلى main.
- `safe-checks.yml`: Backend non-signing وPostgreSQL 16 وFlutter والتحليل والصور الاصطناعية؛ pull_request إلى main أو arena/** وpush إلى main، ويختبر رأس المصدر الصريح.
- `windows-candidate-preflight.yml`: preflight قديم يدوي فقط؛ يولّد مفاتيح ويحتوي تشخيصات غير مانعة؛ لا يُشغّل في GitHub CI.
- `windows-installer-runtime-smoke.yml`: فحص وتشغيل مثبت تاريخي ثابت المصدر؛ يدوي فقط ولا يمثل رأس PR الحالي، ويتضمن اختبارًا يولد مفتاحًا.
- `windows-installer.yml`: بناء وفحص وتثبيت ونشر المنتج؛ يدوي فقط، يحتاج مراجعة منفصلة وأدلة وربط رأس وأذونات قبل أي تشغيل.
- `windows-integrated-candidate.yml`: مرشح متكامل قديم ينشئ مفاتيح ويوقّع اختبارًا ويثبت حزمة؛ يدوي فقط ولا يُشغّل في CI.
- `windows-packaging-probe.yml`: بناء وفحص حزمة قديم يحوي اختبارات توليد مفاتيح؛ يدوي فقط ولا يُشغّل في CI.
- `code-integrity.yml`: جديد، pull_request إلى main أو arena/** وpush إلى main؛ اختبارات محاسبة وسياسة حزمة بلا توقيع، وبناء Flutter Windows من SHA الرأس. لا يبني Setup ولا يثبته ولا ينشره.

## أحدث تشغيل تاريخي لكل Workflow مسجل في GitHub عند المراجعة

قائمة API التالية تأتي من registry الفرع الافتراضي وتشمل ملفات قد لا تكون موجودة في فرع PR. لا يُحذف أي سجل أو workflow؛ مراجعة الخطوات المتخطاة مبينة تحت كل job. أسباب الفشل أدناه مقتصرة على annotations المتاحة؛ لم تُقرأ سجلات غير متاحة ولا تُخمن أسبابها.

### `_licence-step-diagnose.yml` — [40470960116](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40470960116)
- المصدر `arena/55b30d04-erp-kayan`، SHA `fad80f4e69ac0ab3972b62d2895f8d05654894c5`، الحدث `push`، الحالة `completed/success`.
- Job `diagnose`: **success**.

### `_temporary-smoke-auth-fix.yml` — [41004350899](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41004350899)
- المصدر `fix/inno-inspector-callsites-20261030`، SHA `d43f0edd2d53583573b314ca718541304f334701`، الحدث `push`، الحالة `completed/failure`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- السبب/الحدود: فشل التشغيل التاريخي ولا توجد jobs معادة من API؛ سبب الفشل غير متاح.
- API لم يُرجع jobs لهذا التشغيل؛ لا يمكن استنتاج تفاصيل الخطوات.

### `apply-quotation-design-finalization.yml` — [39544088762](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39544088762)
- المصدر `arena/24dd290b-erp-kayan`، SHA `82d1b4633e8c0264b3972fc97508985aaea4ce31`، الحدث `pull_request`، الحالة `completed/failure`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- السبب/الحدود: فشل تحويل المصدر؛ تفاصيل السبب غير متاحة في annotations. الوظائف اللاحقة متخطاة بسبب الفشل.
- Job `apply`: **failure**.
  - `Apply safe source transformations`: failure.
  - `Remove one-shot automation`: skipped.
  - `Commit and push`: skipped.
  - `Post Run actions/setup-python@v5`: skipped.

### `ci.yml` — [41685781219](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41685781219)
- المصدر `codex/full-clean-uninstall`، SHA `90f4dca8ca32387b623cf728ff6d0523abcc2f9a`، الحدث `pull_request`، الحالة `completed/failure`.
- السبب/الحدود: على فرع آخر وSHA قديم: analyzer فشل بسبب nullable في stock_screen؛ backend أظهر ثلاث حالات فاشلة منها cost center ووعود غير منتظرة؛ سيناريو regression أخفق 3 من 47. لا دليل أنها تحدث على PR الحالي.
- Job `Flutter Web (analyze, test, build)`: **failure**.
  - `Analyze`: failure.
  - `Render design screenshots`: skipped.
  - `Upload design screenshots`: skipped.
  - `Run tests`: skipped.
  - `Record the design proof suites`: skipped.
  - `Diagnose the voucher details widget test`: failure.
  - `Build web`: skipped.
  - `Upload web build`: skipped.
  - `Post Set up Python for branded icons`: skipped.
- Job `Regression scenario (reported issues 1-9)`: **failure**.
  - `Serve the web client and run the regression scenario`: failure.
  - `Post Set up Node.js`: skipped.
- Job `Backend (real Prisma and PostgreSQL smoke test)`: **failure**.
  - `Run unit tests`: failure.
  - `Build API`: skipped.
  - `Apply migrations to ephemeral PostgreSQL`: skipped.
  - `Prove the user-avatar migration on a populated database`: skipped.
  - `Prove licensing on real PostgreSQL (populated upgrade, seats, concurrency, restore)`: skipped.
  - `Prove the required-accounts chart upgrade (old, complete and renumbered companies; run twice)`: skipped.
  - `Prove the cost-center upgrade on a pre-upgrade database`: skipped.
  - `Prove the release guard refuses a published release`: skipped.
  - `Prove the quotation PDF verifier reads a real sheet`: skipped.
  - `Pin the database-state classifier (empty/incomplete/ready/unknown)`: skipped.
  - `Seed an isolated test company and administrator`: skipped.
  - `Start API and smoke-test database plus login`: skipped.
  - `Prove units, packing and warehouses on real PostgreSQL (the owner's scenario)`: skipped.
  - `Verify the PostgreSQL client tools used by the backup checks`: skipped.
  - `Build and restore the complete demo JSON on clean disposable databases`: skipped.
  - `Report backend smoke-test diagnostics`: failure.
  - `Audit production dependencies`: skipped.
  - `Post Set up Node.js`: skipped.
- Job `Lot, shelf and alert engine (real PostgreSQL)`: **success**.
- Job `Linux Desktop (analyze, test, build)`: **failure**.
  - `Analyze`: failure.
  - `Render design screenshots`: skipped.
  - `Run tests`: skipped.
  - `Build Linux desktop`: skipped.
  - `Post Set up Python for branded icons`: skipped.

### `finalize-quotation-design.yml` — [39544671934](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39544671934)
- المصدر `arena/24dd290b-erp-kayan`، SHA `762de09220278e31ff177bd97f084b4a2286fe5f`، الحدث `pull_request`، الحالة `completed/failure`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- السبب/الحدود: فشلت خطوة commit؛ السبب التفصيلي غير متاح في annotations.
- Job `finalize`: **failure**.
  - `Commit source changes and remove one-shot files`: failure.
  - `Post Run actions/setup-python@v5`: skipped.

### `installer-focused-tests.yml` — [41082409028](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41082409028)
- المصدر `arena/2d794f08-erp-kayan`، SHA `a6871ec6451fa875cc1310c1ae293ed7185fe94b`، الحدث `push`، الحالة `completed/success`.
- Job `backup-ui`: **success**.
- Job `migration-safety`: **success**.

### `installer-historical-inventory.yml` — [40861732936](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40861732936)
- المصدر `arena/2d794f08-erp-kayan`، SHA `f20506afea7e46948029dfac0e48cc4cd7fb46f4`، الحدث `push`، الحالة `completed/failure`.
- السبب/الحدود: تقرير الفحص يقول Historical Inno inventory not verified؛ لا تتوفر تفاصيل إضافية في annotations.
- Job `inventory`: **failure**.
  - `Inspect historical artifact without extraction or installation`: failure.

### `key-generator-android.yml` — [40926318518](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40926318518)
- المصدر `arena/key-generator-register-ui-fix`، SHA `7e0ee38ad4a71f19e1a1e8a1c5f1a9cca863710b`، الحدث `pull_request`، الحالة `completed/success`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- Job `Build and test KAYAN-Key-Generator.apk`: **success**.
- Job `Create the Android project from the Flutter template`: **skipped**.
- Job `Install and launch the APK on Android`: **skipped**.

### `key-generator.yml` — [41575291508](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41575291508)
- المصدر `codex/fix-six-ui-requests-from-pr71`، SHA `fc6cf8b948fd432f884f5f4f1449dd5cdd8530fe`، الحدث `pull_request`، الحالة `completed/success`.
- Job `Build and test native KAYAN-Key-Generator.exe`: **success**.

### `licence-startup-focused.yml` — [41076735996](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41076735996)
- المصدر `arena/2d794f08-erp-kayan`، SHA `27537d85b71a5a944369c9a72bafa890b1dcfe90`، الحدث `push`، الحالة `completed/success`.
- Job `desktop-startup`: **success**.
- Job `payload-scanner`: **success**.

### `pdf-proof.yml` — [39374088586](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39374088586)
- المصدر `arena/a5a099ec-erp-kayan`، SHA `8173b1d733198f7b454beef4544d9e5e1d154d57`، الحدث `push`، الحالة `completed/success`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- Job `proof`: **success**.

### `prisma-native-migrations.yml` — [41575291511](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41575291511)
- المصدر `codex/fix-six-ui-requests-from-pr71`، SHA `fc6cf8b948fd432f884f5f4f1449dd5cdd8530fe`، الحدث `pull_request`، الحالة `completed/success`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- Job `Shadow database isolation (two independent servers)`: **success**.
- Job `Native engine (deploy, upgrade, failure and retry)`: **success**.

### `release-evidence-gate.yml` — [41878398055](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41878398055)
- المصدر `arena/2d794f08-erp-kayan`، SHA `6c44e5b5879372ffbdd292ab0d40c6294a8bcf34`، الحدث `pull_request`، الحالة `completed/failure`.
- السبب/الحدود: فشل مقصود ومستقل لأن دليل الترخيص والمنتج المثبت في VM المعتمدة غير متوفر؛ ليس اختبار كود.
- Job `Signed licence and installed-product evidence required`: **failure**.
  - `Explicitly report missing approved-VM security evidence`: failure.

### `safe-checks.yml` — [41878398091](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41878398091)
- المصدر `arena/2d794f08-erp-kayan`، SHA `6c44e5b5879372ffbdd292ab0d40c6294a8bcf34`، الحدث `pull_request`، الحالة `completed/failure`.
- السبب/الحدود: فشل اختبار Flutter لمركز التكلفة: Bad state: Too many elements عند cost_center_draft_test.dart:49؛ 488 ناجحًا و1 فاشل. جرى تعديل محدد الحقل لاحقًا والنتيجة تنتظر CI.
- Job `Flutter analyze and tests`: **failure**.
  - `Run Flutter tests and report failures`: failure.
  - `Run flutter build web --release --no-pub`: skipped.
- Job `Full-resolution synthetic review (dashboard_ar.png)`: **success**.
- Job `Full-resolution synthetic review (customers_ar.png)`: **success**.
- Job `Backend focused non-signing tests`: **success**.
- Job `Synthetic screenshot preview (not golden approval)`: **success**.
- Job `Full-resolution synthetic review (sales_invoices_ar.png)`: **success**.
- Job `Native Prisma and PostgreSQL 16 upgrade`: **queued**.

### `windows-candidate-preflight.yml` — [41116189086](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41116189086)
- المصدر `arena/2d794f08-erp-kayan`، SHA `022c032179b8f059975e459b073b83105e68e0ff`، الحدث `push`، الحالة `completed/success`.
- Job `Validate the exact Windows candidate`: **success**.
  - `Report a failed screenshot baseline run`: skipped.
- Job `Probe Inno inspection on Windows`: **success**.
- Job `Inspect synthetic and diagnostic Inno on Linux`: **success**.

### `windows-installed-e2e.yml` — [41426622116](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41426622116)
- المصدر `arena/7b5dfd31-erp-kayan`، SHA `211f34e2c9a16761fa82500770458e924473b1fc`، الحدث `push`، الحالة `completed/failure`.
- ملف مسجل في GitHub على الفرع الافتراضي أو فرع آخر، غير موجود في رأس PR محل المراجعة.
- السبب/الحدود: فشل تثبيت/ترخيص/مخزن في تشغيل SHA آخر؛ لم تُظهر annotations سببًا تفصيليًا؛ لا نفترض سببًا.
- Job `Install the Setup, license it, and work the warehouse`: **failure**.
  - `Install, license, and work the whole warehouse on the installed copy`: failure.
  - `Post Set up Node.js`: skipped.

### `windows-installer-runtime-smoke.yml` — [40868393367](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40868393367)
- المصدر `fix/windows-installer-inspection-20261029`، SHA `e9ee79a58faafcf0ac280d950eb1289b16a353ad`، الحدث `push`، الحالة `completed/failure`.
- السبب/الحدود: فحص الحزمة رفض ملفات npm/Corepack في حزمة تاريخية؛ خطوة الرفع والتثبيت متخطاة لتبعية job الفاشل.
- Job `Re-inspect the exact built candidate with Inno Setup 6.7 support`: **failure**.
  - `Verify runtime manifest, dependencies, key fingerprint and absence of private-key material`: failure.
  - `Upload payload-verified candidate (not install-tested yet)`: skipped.
  - `Post Run actions/setup-node@v4`: skipped.
- Job `Install and test with outbound Internet blocked`: **skipped**.

### `windows-installer.yml` — [41685781243](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41685781243)
- المصدر `codex/full-clean-uninstall`، SHA `90f4dca8ca32387b623cf728ff6d0523abcc2f9a`، الحدث `pull_request`، الحالة `completed/failure`.
- السبب/الحدود: بناء فرع آخر فشل في Backend test: 3 suites/3 tests فشلت، منها assertion تتوقع قيمة بدل Promise. بقية البناء والفحص والتثبيت والنشر متخطاة بسبب الفشل.
- Job `Build KAYAN ERP for Windows x64`: **failure**.
  - `Test backend`: failure.
  - `Clean build backend`: skipped.
  - `Verify clean backend build outputs`: skipped.
  - `Get Flutter dependencies`: skipped.
  - `Analyze Flutter`: skipped.
  - `Render design screenshots`: skipped.
  - `Test Flutter`: skipped.
  - `Check the licence step parses`: skipped.
  - `Licence key for this build`: skipped.
  - `Verify configured product key pair in memory`: skipped.
  - `Build Windows installer`: skipped.
  - `Verify installer artifact`: skipped.
  - `Record raw installer identity for independent inspection`: skipped.
  - `Transfer raw installer to inspection only`: skipped.
  - `Smoke-test the actual installed Windows application`: skipped.
  - `Refuse to overwrite a published release`: skipped.
  - `Publish direct Setup.exe download`: skipped.
  - `Publish branch prerelease with direct Setup.exe download`: skipped.
  - `Upload product installer (diagnostic artifact)`: skipped.
  - `Upload TEST ONLY installer (diagnostic artifact)`: skipped.
  - `Post Set up Python for CI diagnostics`: skipped.
  - `Post Set up Node.js`: skipped.
- Job `Extract and verify the actual payload`: **skipped**.
- Job `Install and exercise the inspected Setup offline`: **skipped**.
- Job `Publish independently verified Windows installer`: **skipped**.
- Job `Hand over the tested branch candidate (prerelease, not latest)`: **skipped**.

### `windows-integrated-candidate.yml` — [41116189090](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41116189090)
- المصدر `arena/2d794f08-erp-kayan`، SHA `022c032179b8f059975e459b073b83105e68e0ff`، الحدث `push`، الحالة `completed/success`.
- Job `Test runtime key preflight on Windows PowerShell 5.1`: **success**.
- Job `Verify configured key pair in memory`: **success**.
- Job `Generator source flow with an ephemeral key`: **success**.
- Job `Standard Prisma and isolated PostgreSQL upgrade`: **success**.
- Job `Build product-key Setup from this commit`: **success**.
- Job `Extract and verify the actual payload`: **success**.
- Job `Install and exercise the inspected Setup offline`: **success**.
- Job `Verify the uploaded install-tested candidate`: **success**.

### `windows-packaging-probe.yml` — [40868376422](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40868376422)
- المصدر `fix/windows-installer-inspection-20261029`، SHA `eb5cf42e743591cd857ead5698eb2d5490d30d51`، الحدث `push`، الحالة `completed/failure`.
- السبب/الحدود: الماسح في التشغيل التاريخي رفض علامة مفتاح في ملف توثيق بحزمة مفكوكة؛ لا نستنتج وجود مفتاح حقيقي. رفع الحزمة متخطى بعد الفشل.
- Job `probe`: **success**.
- Job `Extract and verify the actual Inno payload`: **failure**.
  - `Verify runtime manifest, required dependencies and secrets`: failure.
  - `Upload payload-verified candidate (not install-tested)`: skipped.
  - `Post Run actions/setup-node@v4`: skipped.

## حدود السلامة والإصدار

- CI الخاص بالكود مستقل عن بوابة الترخيص. لا تغيير في بوابة الإصدار أو مفاتيح الترخيص أو Secrets. لا تستخدم النجاحات السابقة كدليل للرأس الجديد.
- `continue-on-error` و`if: false` التاريخية لا تُعد نجاحًا لاختبار؛ workflows المعنية محجوزة يدويًا وغير معتمدة للتشغيل، وبوابة النشر المستقلة باقية. لم تُحذف اختبارات أو وظائف.
- بناء Flutter Windows الجديد لا يفحص محتوى Setup ولا يثبت المنتج؛ لا تشغيل Windows 10/11 أو ترخيص موقّع هنا. يلزم إعداد سلسلة build → فحص مستقل → تثبيت معزول من نفس SHA وhash وبوابات الأدلة قبل الاستخدام.
- CI يراجع جزءًا محددًا غير موقّع؛ اختبارات التوقيع والتوليد والبناء/التثبيت التي تحمل مخاطر لم تُشغّل، ولا تُستبدل باختبارات شكلية.

## مسار رفع Setup إلى Drive بعد الاعتماد فقط

1. استكمال شروط الكود والأمان والترخيص واختبارات Windows 10 ثم 11 وoffline/upgrade/repair/uninstall-reinstall/restore على نفس commit، والحصول على موافقة النشر المنفصلة.
2. تسجيل مصدر الملف واسم Setup وحجمه وSHA-256 وربطها بتقرير الفحص المستقل والتثبيت وبالأدلة الموثقة لنفس commit وrun؛ رفض أي اختلاف.
3. بعد الاعتماد والإذن، رفع **نسخة جديدة باسم فريد** إلى الموقع الذي يحدده المستخدم دون حذف أو استبدال ملفات Drive القديمة. لا يُحفظ أي مفتاح خاص أو Secrets في المثبت أو التقرير.
4. التحقق من حجم وبصمة الملف المرفوع بتنزيل نسخة تحقق معزولة أو وسيلة موثوقة مكافئة، ثم مشاركة الرابط واسم الملف والحجم وSHA-256 والـcommit والتشغيلات. لا يُدعى إتمام الرفع أو التحقق قبل إجرائه فعليًا.
