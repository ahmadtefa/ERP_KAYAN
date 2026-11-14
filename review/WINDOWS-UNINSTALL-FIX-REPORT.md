# إصلاح تعليق الإزالة — Windows Installer

**Commit النهائي:** `f174c50f`
**التشغيل:** [42935919129](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/42935919129) — **success**
**Commit السابق الفاشل:** `3c1143dd` — [42901077717](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/42901077717)

---

## ١. السبب الجذري

**لم تكن المشكلة في الاختبار ولا في `remove-runtime.ps1`.** كانت في `installer.iss` نفسه.

`/SUPPRESSMSGBOXES` **لا يكتم إلا `SuppressibleMsgBox`**. أما `MsgBox` العادية فتُعرض في التشغيل الصامت وتنتظر نقرة لا تأتي أبدًا.

كان في `installer.iss` **عشرة `MsgBox` عادية وصفر `SuppressibleMsgBox`**. وأهمها السطر 407:

```pascal
Choice := MsgBox(
  'Remove KAYAN ERP from this computer?' + ...
```

هذا الحوار يُعرض **قبل أي شيء آخر** في الإلغاء. فحين استدعى الـsmoke:

```powershell
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

توقف الإلغاء على صندوق رسائل غير مرئي، وانتظر. و`Start-Process -Wait` **لا مهلة له**، فسحب الـsmoke ميزانية الوظيفة كاملة (30 دقيقة) ثم مات بـ`timed out` فقط — بلا ExitCode ولا حالة ولا سبب.

**الدليل:** الخطوة استمرت `00:20:33 → 00:50:33` = **30:00 بالضبط** — لا شيء يستهلك مهلة بدقة تامة إلا انتظار لا ينتهي.

---

## ٢. الإصلاح — ٤ مستويات

### أ) الحوارات على المسار الصامت ← `SuppressibleMsgBox`

| الموضع | الحوار | الإجابة عند الكتم |
| --- | --- | --- |
| `InitializeUninstall` | تأكيد الإلغاء العادي | **IDYES** = مسار «إبقاء البيانات» |
| `RemoveProgramKeepData` | فشل إزالة خدمة PostgreSQL | IDOK |
| `RefuseUpgrade` | رفض الترقية | IDOK |
| `InitializeSetup` | بناء TEST/EVALUATION | IDOK |

**الإجابة المكتومة هي نفس الزر الافتراضي**، ومسار «إبقاء البيانات» — فالإلغاء الصامت **لا يحذف بيانات شركة أبدًا**.

### ب) الحذف الكامل يبقى غير قابل للكتم — **عن قصد**

`RemoveEverything` تحتفظ بـ**5 `MsgBox` عادية**. تُنفَّذ فقط عبر `/REMOVEEVERYTHING` من مدخل Start menu. **تشغيل صامت لا يستطيع تأكيد محو بيانات.** هذا مطلب، لا سهو.

### ج) انتظار محدود في الـsmoke

```powershell
$uninstall = Start-Process ... -PassThru      # لا -Wait
$uninstallExited = $uninstall.WaitForExit($uninstallTimeoutSeconds * 1000)  # 300s
```

**الأدلة تُقرأ قبل أي قتل:**

| يُسجَّل | |
| --- | --- |
| ExitCode | + `<still running>` إن لم ينته |
| حالة العملية | HasExited |
| ملف البرنامج | موجود؟ |
| مجلد التثبيت | موجود؟ |
| **الخدمة** | حالتها أو `<absent>` |
| **تسجيل الخدمة** | عبر Win32_Service |
| **مفتاح Uninstall** | عبر `InstallLocation` |
| **حوار معلّق** | إن وُجدت نافذة تنتظر نقرة |

**لا `Stop-Process` قبل المهلة.** عند التعليق: `::error title=Uninstaller did not finish::` + `Fail(...)`.

### د) اختبارات انحدار — 8

| الاختبار | يحرس |
| --- | --- |
| لا `MsgBox` عادية في `InitializeUninstall`/`RemoveProgramKeepData`/`InitializeSetup`/`RefuseUpgrade` | التعليق |
| الإلغاء العادي قابل للكتم، والإجابة IDYES | سلامة البيانات |
| الحذف الكامل غير قابل للكتم + تأكيدان | منع المحو الصامت |
| الحذف غير قابل للوصول من الفرع الافتراضي | الملكية |
| الـsmoke لا يستخدم `-Wait` مفتوحًا | التعليق |
| التعليق يُبلَّغ كفشل لا كمهلة | التشخيص |
| الأدلة تُقرأ قبل القتل | إخفاء الفشل |
| لا قتل قبل المهلة | إخفاء الفشل |

**تحقق عكسي — ٤، كلها كُشفت:**

| العبث | النتيجة |
| --- | --- |
| إعادة `MsgBox` العادية في `InitializeUninstall` (**العيب الأصلي**) | ✗ |
| جعل الحذف الكامل قابلاً للكتم | ✗ |
| كتم التأكيد بـ`IDNO` (إلغاء صامت دائم) | ✗ |
| إعادة `-Wait` المفتوح في الـsmoke | ✗ |

---

## ٣. نتيجة التشغيل الفعلي

| الوظيفة | النتيجة |
| --- | --- |
| Build KAYAN ERP for Windows x64 | ✅ **success** |
| Extract and verify the actual payload | ✅ **success** |
| Publish independently verified Windows installer | `skipped` (ليس push إلى main) |
| **Install and exercise the inspected Setup offline** | ✅ **success** |

### بصمة الملف ومصدره

| | |
| --- | --- |
| **SHA256** | `84c4cffdffdb8bc42ac26969b747ab0c34820a4a621424ff036cd6c0a6a39697` |
| **الحجم** | 145,816,521 بايت |
| **Commit** | `f174c50feef2fa515179b3ad04243da7ee946bb8` |

**تأكيد المصدر** — الخطوة ٧ تتحقق أن الملف لم يتغيّر أثناء الاختبار:

```powershell
if ($hash -ne $build.sha256) { throw 'Setup changed during smoke' }
::notice title=Install-tested candidate (not a release)::SHA256=$hash bytes=… source=$env:GITHUB_SHA
```

أي أن `source=f174c50f…` **هو نفس المصدر المثبَّت فعلًا**، لا ملفًا من بناء سابق.

### المدة — الدليل القاطع على نجاح الإزالة

| | الخطوة ٦ |
| --- | --- |
| السابق `3c1143dd` | 00:20:33 → 00:50:33 = **30:00** (مهلة) |
| الحالي `f174c50f` | 01:31:42 → 01:38:54 = **07:12** |

سبع دقائق لكل شيء — تثبيت، PostgreSQL، الترحيلات، الترقية، Repair، إعادة التشغيل، **والإزالة**. العملية لم تعلّق.

### إثبات الإزالة

`Fail()` يُستدعى عند كل فحص إزالة. الوظيفة **success** = `exit 0` = كل هذه مرّت:

| السطر | الفحص | لازم للنجاح |
| --- | --- | --- |
| 1118 | الإلغاء انتهى بنفسه، ExitCode 0، داخل المهلة | ✅ |
| 1095 | `erp_kayan.exe` أُزيل | ✅ |
| 1101 | خدمة PostgreSQL أُلغيت | ✅ |
| 1116 | قواعد Firewall أُزيلت | ✅ |
| 1123 | **بيانات الشركة محفوظة** | ✅ |

**تحققت بنيويًا:** لا `exit` بين 1075 و1180، والكتلة في المستوى الأعلى غير محاطة بـ`RuntimeOnly`. فلا مخرج مبكر يتخطى الفحوص.

**قيد شفافية:** إشعار `Uninstall exercise passed` (سطر 1157) لا يظهر في الـannotations — GitHub يعرض 13 فقط لكل خطوة، وآخرها «public-key-restored». **لا أستطيع قراءة السجل الكامل** (تنزيلها محجوب: 302→0 بايت). الأدلة أعلاه بنيوية من الكود + النجاح، لا مقتبسة من سجل.

---

## ٤. اختبارات الحماية

| المجموعة | النتيجة |
| --- | --- |
| payload + Inno + uninstall + build-only + preflight | **69/0** |
| `inno-code-constants` + `smoke-uninstall-timeout` | **8/0** |
| `ci-workflow-safety` | PASS |
| PowerShell semantic (9 سكربتات) | PASS |

### إصلاحات محفوظة

الضريبة ✅ · Accordion ✅ · FEFO ✅ · map sweep ✅ · البحث عن `.map` ✅ · Complete Uninstall ✅

---

## ٥. ما لم يُختبر — بصراحة

| البند | الحالة |
| --- | --- |
| **Complete Uninstall على Windows** | **لم يُختبر** — الـsmoke يمارس الإلغاء العادي فقط |
| Backup/Restore كامل | الـsmoke يقول: «guarded refusal verified, no complete backup performed» |
| الترخيص الموقّع بإنتاج | بوابة VM — لم أتجاوزها |
| قراءة سجل التشغيل الكامل | محجوب من بيئتي |

**الحذف الكامل (`/REMOVEEVERYTHING`) لم يُنفَّذ على Windows ولو مرة.** يبقى مفحوصًا ثابتًا فقط (13/0 + 8/0).

---

## ٦. الخلاصة

**السبب الجذري:** `MsgBox` عادية حيث يجب `SuppressibleMsgBox`، مع انتظار بلا مهلة في الاختبار.

**النتيجة:** الإلغاء العادي **نُفِّذ بنجاح على Windows**، بملفات برنامج وخدمة PostgreSQL وقواعد Firewall مُزالة، وبيانات شركة محفوظة. الملف المثبَّت مصدره `f174c50f` بـSHA256 `84c4cffd…`.

**ما زال مطلوبًا:** اختبار الحذف الكامل على Windows — لم يحدث بعد.
