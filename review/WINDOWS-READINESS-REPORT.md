# تقرير تجهيز KAYAN ERP للاختبار على Windows

**الفرع:** `arena/56e71924-erp-kayan` @ `13727378`
**PR #77:** مفتوح، لم يُدمج. `main` لم يُمَس.

---

## ١. الملفات التي تغيّرت في هذه الجولة

| الملف | التغيير |
| --- | --- |
| `.github/workflows/licence-store-gate.yml` | **جديد** — بوابة الترخيص مستقلة |
| `.github/workflows/safe-checks.yml` | حُذفت منه وظيفة الترخيص، وأُضيف اختبار ثوابت Inno |
| `distribution/windows/installer.iss` | `mbWarning` ← `mbConfirmation` (سطر 356) |
| `scripts/inno-code-constants.test.cjs` | **جديد** — ٤ حمايات |
| `scripts/remove-everything-safety.test.mjs` | لم يعد يقبل `mbWarning` |
| `scripts/ci-workflow-safety.test.cjs` | يحرس البنية الجديدة |
| `docs/release/LICENCE-VM-BLOCKED.md` | يوثّق الفصل |

---

## ٢. المرحلة الأولى — فصل بوابة الترخيص

**المشكلة:** `safe-checks` يعمل على `push` إلى `main`، وبوابة الترخيص تفشل بالتصميم. فكل تشغيل على `main` أحمر، ولا يُعرف هل الاختبارات العادية سليمة.

**ما فعلته ولماذا هو ليس تضعيفًا:**

| | قبل | بعد |
| --- | --- | --- |
| مكان البوابة | داخل `safe-checks` | `licence-store-gate.yml` |
| هل تنجح أبدًا؟ | لا — `exit 1` | **لا — `exit 1`** |
| هل غياب VM = نجاح؟ | لا | **لا** |
| `continue-on-error` | ممنوع | **ممنوع ومُختبَر** |

**الدليل أن الفصل لم يخفف:** `gh api …/commits/13727378/check-runs` →

```
success  Backend focused non-signing tests
success  Flutter analyze and tests
success  Build Windows application from exact head (no installer)
failure  Licence store integration blocked (approved VM required)
```

`failure` — لا `success` ولا `skipped`. العائق مرئي ومعطّل، لكنه لم يعد يلوّن الاختبارات العادية.

**اختبارات الحماية:** ٣ تحققات عكسية، كلها كُشفت:

| العبث | النتيجة |
| --- | --- |
| إعادة الوظيفة إلى `safe-checks` | ✗ فشل |
| `continue-on-error: true` على خطوة الحجب | ✗ فشل |
| حذف `exit 1` | ✗ فشل |

---

## ٣. المرحلة الثانية — البناء الفعلي

**هذا هو الإنجاز الأكبر: Setup بُني فعلًا.**

| | |
| --- | --- |
| **الملف** | `KAYAN-ERP-Setup.exe` |
| **SHA256** | `E3EFE4EFEF489A366618DA81E9113FB11B52B27C8D6A7FDE6EDD313B5A6B3C11` |
| **الحجم (أثر)** | 151,552,462 بايت |
| **Commit** | `13727378` |
| **التشغيل** | [42888662307](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/42888662307) |

**الوظائف:**

| الوظيفة | النتيجة |
| --- | --- |
| Build KAYAN ERP for Windows x64 | ✅ **success** |
| Extract and verify the actual payload | ✅ **success** |
| Publish independently verified Windows installer | `skipped` (ليس `push` إلى `main`) |
| Install and exercise the inspected Setup offline | `waiting` ← بوابة بيئة |

**تدفق البناء كما ظهر في الأدلة:**

```
[1/8] Build backend and Prisma client
[2/8] Stage production backend files (development .env is excluded)
[3/8] Build Flutter Windows x64 and production Web
[4/8] Bundle official Node.js x64 and PostgreSQL 17 x64
[5/8] Add database lifecycle and first-run setup scripts
       Licensing: enforcement ON (product); staged public key SHA256 5541B359…
       Compiling RepairTool.exe → built
[6/8] Verify staged runtime essentials and absence of development .env
[7/8] Write artifact manifest with exact pinned versions
[8/8] Compile standalone Inno Setup installer
```

**لا شيء نُزِّل من الإنترنت على جهاز المستخدم:** Node 24.21.0 وPostgreSQL 17.7-1 وVC++ redist نُزِّلت **وقت البناء** على GitHub runner، ثم دُمجت. التثبيت والتشغيل والإصلاح لا تحتاج شبكة.

**الملفات المطلوبة:** كل الـ36 في قائمة الإلزام موجودة، منها:

- `backend/node/node.exe`, `backend/node_modules/.prisma/client/index.js`
- `backend/postgres/bin/{initdb,pg_ctl,pg_dump,pg_isready,pg_restore,postgres,psql}.exe`
- `backend/scripts/{apply-migrations,migrate-deploy,prepare-database,database-state}.mjs`
- `backend/prisma/migrations/migration_lock.toml` + **69 `migration.sql`** (اشتراط إلزامي في الفحص)
- `RepairTool.exe`
- `remove-runtime.ps1`, `remove-everything.ps1`

**منع المفاتيح:** الفحص يسجّل `privateKeyMarkersFound: false`. البناء يستخدم المفتاح العام فقط.

---

## ٤. العيب الذي أوقف البناء — وأُصلح

البناء الأول `42882976350` **فشل بعد 14 دقيقة** في الخطوة 8 من 8:

```
Error on line 356 in installer.iss: Column 5
```

**السبب:** كتبت `mbWarning` في `RemoveEverything`، وInno Setup لا يعرّف إلا `mbInformation`, `mbConfirmation`, `mbError`, `mbCriticalError`. خطأ صياغة واحد أضاع الـSetup كاملًا.

**لماذا لم يكتشفه شيء محليًا؟** هذا هو العيب الحقيقي:

- `verify-windows-scripts.mjs` يقرأ `.ps1` فقط، لا `[Code]`.
- `remove-everything-safety.test.mjs` كان يطابق `mbError|mbWarning` — أي **كان يقبل الثابت غير الموجود** كتأكيد صحيح.

**الإصلاح:** `mbConfirmation` — نفس قوة التحذير التي يطلبها النص.

**الحمايات المضافة، كل واحدة تحققت عكسيًا:**

| الحماية | العبث | كُشف |
| --- | --- | --- |
| رفض أي `mb*` غير معرّف | إعادة `mbWarning` | ✓ |
| تأكيدان يُختبر جوابهما مقابل `IDYES` | `<>` ← `=` | ✓ |
| حذف التأكيد الثاني | حذف الكتلة | ✓ |
| عدم قبول `mbWarning` في الاختبار القديم | إعادته | ✓ 12/1 |

---

## ٥. المرحلة الثالثة — إعداد السيرفر

| البند | الحالة | الدليل |
| --- | --- | --- |
| تعارض المنفذ 3000 | ✅ | `_firstFreePort()` + رسالة تسمّي كل منفذ مشغول |
| انتظار PostgreSQL | ✅ | `pg_isready.exe` في الحمولة |
| تعارض 5432 | ✅ | يرفض التثبيت برسالة واضحة قبل تغيير أي شيء |
| إعداد القاعدة | ✅ | `kayan.env` بكلمة مرور عشوائية، `ProgramData` محمي |
| نظامان للإعداد | ✅ | آلية `KAYAN_SETTINGS_GENERATION` تحلّ التعارض |
| health check | ✅ | `/api/v1/health` في `repair-runtime.ps1` |
| سجل الأخطاء | ✅ | `%APPDATA%\KAYAN-ERP\logs\backend.log` |
| Firewall | ⚠️ **غير موجود في سكربتات التثبيت** | يوجد في `smoke-test-installed-windows.ps1` فقط |

**ملاحظة على السجل:** طلبك `%AppData%\Roaming\KAYAN-ERP\logs\backend.log` — وهذا **مطابق** لما يفعله الكود (`_dataDirectory()` = `%APPDATA%\KAYAN-ERP`، والسجل `logs\backend.log`). سكربت smoke يفحص `ProgramData` أيضًا كاحتياط، وليس تعارضًا.

---

## ٦. المرحلة الرابعة — الإزالة

**لم تُختبر على Windows.** الاختبارات الثابتة 13/0، لكن هذا ليس اختبارًا.

| المسار | التنفيذ | مُثبت |
| --- | --- | --- |
| Normal | `remove-runtime.ps1` — يوقف ويلغي الخدمة، يحفظ البيانات | ثابتًا فقط |
| Complete | `/REMOVEEVERYTHING` → تأكيدان → `remove-everything.ps1 -ConfirmRemoval` | ثابتًا فقط |

**إثبات الملكية قبل الحذف:** علامات داخل المجلد + `PG_VERSION` + مسار من Registry.
**لا ادّعاء نجاح مع بقاء شيء:** `Assert-NothingLeft` + تقرير JSON.
**لا وصول للـComplete من الإلغاء العادي:** مُختبَر عكسيًا.

---

## ٧. المرحلة الخامسة — الأنظمة الوظيفية

| البند | الحالة | الدليل |
| --- | --- | --- |
| إصلاحات PR70 | ✅ | `6e55df06`, مراكز التكلفة، الوحدات، الباركود، الصور |
| الضريبة الفارغة = 0 | ✅ | `import.service.ts:1507` → `?? new Prisma.Decimal(0)` |
| Accordion مجموعة واحدة | ✅ | `state = open == group ? null : group` + `erp_shell_groups_test` |
| المجموعات الثمانية | ✅ | مطابقة حرفيًا لـ`main` |
| ألوان المجموعات | ✅ | `SectionAccents` + اختبارات |
| FEFO ومنع المنتهي | ✅ | `batch-policy.ts` + `batch-policy.spec.ts` |
| أزرار Refresh | ✅ | في 3 شاشات مخازن على الأقل |
| 11 شاشة جديدة | ✅ | انتماء صحيح، صفر محذوف |

**لا أستطيع تأكيد البنود ٣، ٥، ٨، ٩، ١٠، ١١–١٧ بالكامل** — تحتاج تشغيلًا فعليًا.

---

## ٨. المرحلة السادسة — الاختبارات

| الاختبار | النتيجة |
| --- | --- |
| Flutter (على Windows runner) | ✅ **733/0** |
| Backend — المجموعة الآمنة | ✅ **628/0** في **72** حزمة |
| الترخيص | ✅ **245/245** في **16** حزمة |
| Prisma على PostgreSQL 16 حقيقي | ✅ **69** ترحيلًا، **81** جدولًا، 0 معلّق |
| التكرار (idempotent) | ✅ 0 مطبَّق ثانية |
| Backup → تعديل → Restore | ✅ القيمة الأصلية عادت، 69 ترحيلًا |
| ملف تالف | ✅ رُفض، القاعدة سليمة |
| بوابات الحماية | ✅ **64/0**، **13/0**، **12/0** |
| `ci-workflow-safety` | ✅ PASS |

**الـ10 حزم الفاشلة** في التشغيل الشامل: كلها `modules/licensing`، بسبب `ci-no-signing.cjs` الذي يمنع التوقيع عمدًا. **مقصود، وليس عيبًا.**

---

## ٩. ما لم يُختبر — والسبب

| البند | السبب |
| --- | --- |
| تثبيت فعلي Win 10/11 | يحتاج VM معزولة + موافقتك على بيئة `windows-installer-test` |
| تشغيل دون إنترنت | يحتاج تثبيتًا فعليًا |
| إعادة تشغيل الجهاز | يحتاج جهازًا؛ **لن أستخدم جهازك** |
| Upgrade / Repair | يحتاج تثبيتًا سابقًا |
| Normal / Complete Uninstall | يحتاج تثبيتًا فعليًا |
| الترخيص الموقّع | بوابة VM معتمدة — **لم أتجاوزها** |
| تنزيل الـArtifact | محجوب من بيئتي (302 → 0 بايت) |

---

## ١٠. التصنيف النهائي

### ١. مكتمل ومثبت بالدليل

- يعادل: فصل بوابة الترخيص (٤ تحققات عكسية)
- إصلاح `mbWarning` — **كان يمنع أي Setup من الوجود**
- **Setup بُني فعلًا**: `KAYAN-ERP-Setup.exe`, SHA256 `E3EFE4EF…`, 151 MB
- فحص الحمولة نجح: 36 ملفًا إلزاميًا، 69 ترحيلًا، صفر مفتاح خاص
- Flutter 733/0، Backend 628/0، ترخيص 245/245
- 69 ترحيلًا على PostgreSQL حقيقي + idempotent + Backup/Restore
- `safe-checks` أخضر، البوابة `failure` مستقلة

### ٢. مكتمل برمجيًا ولم يُختبر على Windows

- Normal Uninstall وComplete Uninstall
- `test-windows-restart.ps1`
- التثبيت والتشغيل دون إنترنت والترقية والإصلاح
- الترخيص على جهاز

### ٣. غير مكتمل

- **قواعد Firewall غائبة من سكربتات التثبيت** — موجودة في smoke فقط
- Artifact لم يُحمَّل (محجوب)، فقائمة الملفات مأخوذة من الكود لا من التقرير
- `semantic check` ما زال لا يقرأ `[Code]`

### ٤. يحتاج تدخلك

**الخطوة الوحيدة الحاجزة:**

> وظيفة `Install and exercise the inspected Setup offline` في حالة `waiting` على بيئة `windows-installer-test` المحمية (تحتاج `required_reviewers`).

هذا هو ما يفصلك عن اختبار تثبيت حقيقي. الخيارات:

1. **أضف نفسك مراجعًا** للبيئة، ثم أعِد التشغيل — فيثبّت Setup تلقائيًا على Windows runner ويجري الفحوص.
2. **أعطني موافقة صريحة** لطلب المراجعة نيابةً عنك.

---

## ١١. هل يمكن الانتقال لاختبار المستخدم؟

**نعم، جزئيًا — وهذه أول مرة يكون الجواب كذلك.**

**جاهز:** Setup موجود بـSHA256، وحمولته فُحصت، والترحيلات تعمل، و733+628+245 اختبارًا خضراء.

**غير جاهز:** لا أحد ثبّته على Windows. ولا يمكنني أن أقول «ثبّته فيعمل» بلا تجربة.

**توصيتي:** شغّل وظيفة التثبيت المحمية أولًا (`window-installer-test`) — فهي تثبّت Setup على Windows وتفحصه دون أن تلمس جهازك. فإن نجحت، يصبح الاختبار اليدوي على جهاز منفصل خطوة معقولة.
