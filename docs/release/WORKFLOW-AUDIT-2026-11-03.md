# تدقيق GitHub Actions — لقطة 2026-11-03

أساس الفحص قبل التعديلات `6b3d07752ea47491300ee79e9310e83d4e590201` على PR #70. الجدول يعرض أحدث تشغيل مرئي لكل Workflow مسجل عبر GitHub API، وقد يخص فرعًا أو commit آخر؛ لا يُنسب نجاح تاريخي للرأس الحالي. تغييرات فصل البوابة اللاحقة تحتاج نتيجة CI مستقلة. لم تُشغّل workflows موقّعة أو مولدات أثناء هذا التدقيق.

أسماء أحداث التشغيل أدناه تعود إلى الملف عند commit المذكور؛ trigger الحالي على PR يختلف حيث عُطّل التشغيل التلقائي للملفات القديمة. `skipped` ليس نجاحًا. إن لم يوفر API أسبابًا قاطعة للفشل أو التخطي، ذُكر ذلك دون تخمين.

## آخر تشغيل وJobs

### Licence step diagnosis
- الملف: `.github/workflows/_licence-step-diagnose.yml`؛ trigger على رأس الفحص: push ['arena/55b30d04-erp-kayan']; workflow_dispatch.
- آخر تشغيل: [40470960116](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40470960116)، `fad80f4e`، `arena/55b30d04-erp-kayan`، `push`، النتيجة **success**؛ trigger عند ذلك الرأس: push ['arena/55b30d04-erp-kayan']; workflow_dispatch.
  - **diagnose**: success.

### .github/workflows/_temporary-smoke-auth-fix.yml
- الملف: `.github/workflows/_temporary-smoke-auth-fix.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [41004350899](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41004350899)، `d43f0edd`، `fix/inno-inspector-callsites-20261030`، `push`، النتيجة **failure**؛ trigger عند ذلك الرأس: غير موجود على الرأس/غير متاح.
- لم يرجع API أي Job؛ لا يوجد تشخيص كافٍ لسبب الفشل.

### Apply quotation design finalization
- الملف: `.github/workflows/apply-quotation-design-finalization.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [39544088762](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39544088762)، `82d1b463`، `arena/24dd290b-erp-kayan`، `pull_request`، النتيجة **failure**؛ trigger عند ذلك الرأس: pull_request ['main'].
  - **apply**: failure — شرط Job مذكور في المصدر؛ خطوة فاشلة: Apply safe source transformations.

### ERP KAYAN CI
- الملف: `.github/workflows/ci.yml`؛ trigger على رأس الفحص: workflow_dispatch.
- آخر تشغيل: [41685781219](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41685781219)، `90f4dca8`، `codex/full-clean-uninstall`، `pull_request`، النتيجة **failure**؛ trigger عند ذلك الرأس: pull_request ['main', 'arena/**', 'codex/fix-six-ui-requests-from-pr71']; push ['main', 'codex/full-clean-uninstall']; workflow_dispatch.
  - **Flutter Web (analyze, test, build)**: failure — خطوة فاشلة: Analyze, Diagnose the voucher details widget test.
  - **Regression scenario (reported issues 1-9)**: failure — خطوة فاشلة: Serve the web client and run the regression scenario.
  - **Backend (real Prisma and PostgreSQL smoke test)**: failure — خطوة فاشلة: Run unit tests, Report backend smoke-test diagnostics.
  - **Lot, shelf and alert engine (real PostgreSQL)**: success.
  - **Linux Desktop (analyze, test, build)**: failure — خطوة فاشلة: Analyze.

### Finalize quotation design
- الملف: `.github/workflows/finalize-quotation-design.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [39544671934](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39544671934)، `762de092`، `arena/24dd290b-erp-kayan`، `pull_request`، النتيجة **failure**؛ trigger عند ذلك الرأس: push ['arena/24dd290b-erp-kayan']; pull_request ['main'].
  - **finalize**: failure — شرط Job مذكور في المصدر؛ خطوة فاشلة: Commit source changes and remove one-shot files.

### Installer safety focused tests (no installer build)
- الملف: `.github/workflows/installer-focused-tests.yml`؛ trigger على رأس الفحص: push ['arena/2d794f08-erp-kayan'] (paths محددة).
- آخر تشغيل: [41082409028](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41082409028)، `a6871ec6`، `arena/2d794f08-erp-kayan`، `push`، النتيجة **success**؛ trigger عند ذلك الرأس: push ['arena/2d794f08-erp-kayan'] (paths محددة).
  - **backup-ui**: success.
  - **migration-safety**: success — شرط Job مذكور في المصدر.

### Historical installer inventory (read-only)
- الملف: `.github/workflows/installer-historical-inventory.yml`؛ trigger على رأس الفحص: push ['arena/2d794f08-erp-kayan'] (paths محددة).
- آخر تشغيل: [40861732936](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40861732936)، `f20506af`، `arena/2d794f08-erp-kayan`، `push`، النتيجة **failure**؛ trigger عند ذلك الرأس: push ['arena/2d794f08-erp-kayan'] (paths محددة).
  - **inventory**: failure — خطوة فاشلة: Inspect historical artifact without extraction or installation.

### Key Generator (Android APK)
- الملف: `.github/workflows/key-generator-android.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [40926318518](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40926318518)، `7e0ee38a`، `arena/key-generator-register-ui-fix`، `pull_request`، النتيجة **success**؛ trigger عند ذلك الرأس: pull_request ['main', 'arena/**'] (paths محددة); push ['arena/**'] (paths محددة); workflow_dispatch.
  - **Build and test KAYAN-Key-Generator.apk**: success.
  - **Create the Android project from the Flutter template**: skipped — شرط Job مذكور في المصدر؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.
  - **Install and launch the APK on Android**: skipped — شرط Job مذكور في المصدر؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.

### Key Generator (Windows x64)
- الملف: `.github/workflows/key-generator.yml`؛ trigger على رأس الفحص: workflow_dispatch.
- آخر تشغيل: [41575291508](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41575291508)، `fc6cf8b9`، `codex/fix-six-ui-requests-from-pr71`، `pull_request`، النتيجة **success**؛ trigger عند ذلك الرأس: pull_request ['main', 'arena/**']; workflow_dispatch.
  - **Build and test native KAYAN-Key-Generator.exe**: success.

### Licence startup and payload focused checks
- الملف: `.github/workflows/licence-startup-focused.yml`؛ trigger على رأس الفحص: push ['arena/2d794f08-erp-kayan'] (paths محددة).
- آخر تشغيل: [41076735996](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41076735996)، `27537d85`، `arena/2d794f08-erp-kayan`، `push`، النتيجة **success**؛ trigger عند ذلك الرأس: push ['arena/2d794f08-erp-kayan'] (paths محددة).
  - **desktop-startup**: success.
  - **payload-scanner**: success.

### Quotation PDF proof
- الملف: `.github/workflows/pdf-proof.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [39374088586](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/39374088586)، `8173b1d7`، `arena/a5a099ec-erp-kayan`، `push`، النتيجة **success**؛ trigger عند ذلك الرأس: push (paths محددة).
  - **proof**: success.

### Prisma native migrations
- الملف: `.github/workflows/prisma-native-migrations.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [41575291511](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41575291511)، `fc6cf8b9`، `codex/fix-six-ui-requests-from-pr71`، `pull_request`، النتيجة **success**؛ trigger عند ذلك الرأس: pull_request ['main', 'arena/**']; push ['main', 'arena/**']; workflow_dispatch.
  - **Shadow database isolation (two independent servers)**: success.
  - **Native engine (deploy, upgrade, failure and retry)**: success.

### Safe backend and Flutter checks (not release approval)
- الملف: `.github/workflows/safe-checks.yml`؛ trigger على رأس الفحص: pull_request ['main', 'arena/**']; push ['main', 'arena/2d794f08-erp-kayan'].
- آخر تشغيل: [41719391500](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41719391500)، `6b3d0775`، `arena/2d794f08-erp-kayan`، `pull_request`، النتيجة **failure**؛ trigger عند ذلك الرأس: pull_request ['main', 'arena/**']; push ['main', 'arena/2d794f08-erp-kayan'].
  - **Native Prisma and PostgreSQL 16 upgrade**: success.
  - **Synthetic screenshot preview (not golden approval)**: success.
  - **Full-resolution synthetic review (customers_ar.png)**: success.
  - **Backend focused non-signing tests**: success.
  - **Flutter analyze and tests**: success.
  - **Signed licence and installed-product evidence required**: failure — خطوة فاشلة: Explicitly report missing approved-VM security evidence.
  - **Full-resolution synthetic review (sales_invoices_ar.png)**: success.
  - **Full-resolution synthetic review (dashboard_ar.png)**: success.

### Windows candidate preflight (no publication)
- الملف: `.github/workflows/windows-candidate-preflight.yml`؛ trigger على رأس الفحص: workflow_dispatch.
- آخر تشغيل: [41116189086](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41116189086)، `022c0321`، `arena/2d794f08-erp-kayan`، `push`، النتيجة **success**؛ trigger عند ذلك الرأس: push ['arena/2d794f08-erp-kayan']; workflow_dispatch.
  - **Validate the exact Windows candidate**: success — شرط Job مذكور في المصدر.
  - **Probe Inno inspection on Windows**: success — شرط Job مذكور في المصدر.
  - **Inspect synthetic and diagnostic Inno on Linux**: success — needs=['inno-probe', 'preflight'].

### Installed program E2E (licence, warehouse, backup, restore)
- الملف: `.github/workflows/windows-installed-e2e.yml`؛ trigger على رأس الفحص: غير موجود على الرأس/غير متاح.
- آخر تشغيل: [41426622116](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41426622116)، `211f34e2`، `arena/7b5dfd31-erp-kayan`، `push`، النتيجة **failure**؛ trigger عند ذلك الرأس: push ['arena/7b5dfd31-erp-kayan']; workflow_dispatch.
  - **Install the Setup, license it, and work the warehouse**: failure — خطوة فاشلة: Install, license, and work the whole warehouse on the installed copy.

### Windows installer candidate offline runtime smoke (pinned candidate)
- الملف: `.github/workflows/windows-installer-runtime-smoke.yml`؛ trigger على رأس الفحص: push ['fix/windows-installer-inspection-20261029'] (paths محددة); workflow_dispatch.
- آخر تشغيل: [40868393367](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40868393367)، `e9ee79a5`، `fix/windows-installer-inspection-20261029`، `push`، النتيجة **failure**؛ trigger عند ذلك الرأس: push ['fix/windows-installer-inspection-20261029'] (paths محددة); workflow_dispatch.
  - **Re-inspect the exact built candidate with Inno Setup 6.7 support**: failure — خطوة فاشلة: Verify runtime manifest, dependencies, key fingerprint and absence of private-key material.
  - **Install and test with outbound Internet blocked**: skipped — needs=inspect؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.

### Windows Installer
- الملف: `.github/workflows/windows-installer.yml`؛ trigger على رأس الفحص: workflow_dispatch.
- آخر تشغيل: [41685781243](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41685781243)، `90f4dca8`، `codex/full-clean-uninstall`، `pull_request`، النتيجة **failure**؛ trigger عند ذلك الرأس: workflow_dispatch; pull_request ['main', 'arena/2d794f08-erp-kayan', 'codex/fix-six-ui-requests-from-pr71']; push ['main', 'arena/key-generator-register-ui-fix', 'arena/2d794f08-erp-kayan', 'arena/7b5dfd31-erp-kayan', 'fix/inno-inspector-callsites-20261030', 'codex/full-clean-uninstall'].
  - **Build KAYAN ERP for Windows x64**: failure — خطوة فاشلة: Test backend.
  - **Extract and verify the actual payload**: skipped — needs=build؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.
  - **Install and exercise the inspected Setup offline**: skipped — needs=['build', 'inspect-final']؛ شرط Job مذكور في المصدر؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.
  - **Publish independently verified Windows installer**: skipped — needs=['build', 'inspect-final', 'smoke-final']؛ شرط Job مذكور في المصدر؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.
  - **Hand over the tested branch candidate (prerelease, not latest)**: skipped — needs=['build', 'inspect-final', 'smoke-final']؛ شرط Job مذكور في المصدر؛ لم يُنفّذ؛ افحص dependencies والشرط الخاص بالرأس التاريخي.

### Integrated Windows candidate (not a release)
- الملف: `.github/workflows/windows-integrated-candidate.yml`؛ trigger على رأس الفحص: workflow_dispatch.
- آخر تشغيل: [41116189090](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/41116189090)، `022c0321`، `arena/2d794f08-erp-kayan`، `push`، النتيجة **success**؛ trigger عند ذلك الرأس: push ['arena/2d794f08-erp-kayan']; workflow_dispatch.
  - **Test runtime key preflight on Windows PowerShell 5.1**: success.
  - **Verify configured key pair in memory**: success.
  - **Generator source flow with an ephemeral key**: success.
  - **Standard Prisma and isolated PostgreSQL upgrade**: success.
  - **Build product-key Setup from this commit**: success — needs=['configured-key-compatibility', 'windows-key-preflight'].
  - **Extract and verify the actual payload**: success — needs=build.
  - **Install and exercise the inspected Setup offline**: success — needs=inspect.
  - **Verify the uploaded install-tested candidate**: success — needs=smoke.

### Product packaging probe (no upload or installation)
- الملف: `.github/workflows/windows-packaging-probe.yml`؛ trigger على رأس الفحص: push ['fix/windows-installer-inspection-20261029'] (paths محددة); workflow_dispatch.
- آخر تشغيل: [40868376422](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/40868376422)، `eb5cf42e`، `fix/windows-installer-inspection-20261029`، `push`، النتيجة **failure**؛ trigger عند ذلك الرأس: push ['fix/windows-installer-inspection-20261029'] (paths محددة); workflow_dispatch.
  - **probe**: success.
  - **Extract and verify the actual Inno payload**: failure — needs=probe؛ خطوة فاشلة: Verify runtime manifest, required dependencies and secrets.

## تفسير ومخاطر

- على `6b3d077` نجحت مهام الكود والـPostgreSQL وFlutter والصور؛ فشل `Signed licence and installed-product evidence required` مقصود لغياب أدلة البيئة المعتمدة. لم تتوفر سجلات تفصيلية لتحديد عدد اختبارات Flutter بسبب EOF.
- على رأس الفحص كان يتكرر نفس فحص PR لكل push وpull_request لنفس commit. عُدّل لاحقًا إلى PR للفرع المفتوح وpush لـmain فقط؛ يجب التحقق من تشغيل البوابتين على الرأس اللاحق. لا تُفحص دفعة فرع بلا PR تلقائيًا بهذا التكوين ولا يُسمح أن تعتبر ذلك تصريحًا بإصدار.
- workflows ذات trigger `workflow_dispatch` القديمة ليست تصريحًا بتشغيلها؛ يحتوي بعضها اختبارات توقيع أو publication خطرة. لا تُشغّل إلا بعد مراجعة مستقلة وبيئة معتمدة.
- فشل E2E التاريخي لا يثبت سببًا جذريًا دون logs كاملة؛ اختبار runtime-only السابق ليس ترخيصًا إنتاجيًا أو Windows 10/11.
- بعض أسماء workflows المسجلة لدى GitHub لم تعد موجودة في شجرة PR، ونتائجها هنا تاريخية لا دليلًا على عمل الكود الحالي.
- أُبقي فحص `verify-release-evidence.mjs` في ناشر Windows وفحصه المستقل داخل publisher؛ فصل مؤشر CI لا يمنح أي نشر.
