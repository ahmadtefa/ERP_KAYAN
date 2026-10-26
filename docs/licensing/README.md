# الترخيص المستقل — Offline Licensing

برنامج كيان يعمل بترخيص يُثبَّت **مرة واحدة لكل جهاز**، ويُجدَّد ويُوسَّع بمفاتيح
تصدرها الجهة المورّدة دون اتصال بالإنترنت. لا يوجد خادم ترخيص، ولا اتصال دوري،
ولا شيء يقرأ بيانات الشركة ليحدد صلاحيتها.

KAYAN is licensed per machine. Licences are issued offline as signed keys by the
supplier; there is no licence server, no periodic call home, and nothing about
the licence is derived from the company's name, tax number or books.

## الوثائق / The documents

| | |
| --- | --- |
| [`GENERATOR.md`](GENERATOR.md) | أداة المورّد بنسختيها — `KAYAN-Key-Generator.exe` على ويندوز و`KAYAN-Key-Generator-Android.apk` على أندرويد: التشغيل، مفتاح التوقيع، العمليات الأربع، البناء والتغليف، الحدود |
| [`OPERATOR-GUIDE.md`](OPERATOR-GUIDE.md) | إجراءات الإصدار اليومية خطوة بخطوة |
| [`KEY-PROTECTION.md`](KEY-PROTECTION.md) | حماية المفتاح الخاص والنسخ الاحتياطي والتدوير |
| [`MACHINE-ID.md`](MACHINE-ID.md) | كيف يُحسب معرّف الجهاز ومتى يتغير |
| [`CLOCK-POLICY.md`](CLOCK-POLICY.md) | سياسة تاريخ الجهاز وحدودها |
| [`LICENSEE-GUIDE.md`](LICENSEE-GUIDE.md) | ما يقوله العميل ويفعله |
| [`VERIFICATION.md`](VERIFICATION.md) | ما شُغّل فعلًا وما لم يُشغَّل |

## ما لا يعتمد عليه الترخيص / What the licence is not bound to

- اسم الشركة أو الاسم التجاري / company or trade name
- الرقم الضريبي أو السجل التجاري / tax or commercial-registration number
- محتوى قاعدة البيانات أو أي صنف أو حساب / any data in the database

الترخيص مربوط بـ **جهاز** (معرّف جهاز مستقر) و**حد عدد المستخدمين** وبالمدة.
A licence is bound to a machine, a user-account limit, and a term.

## أنواع المفاتيح / The four key types

| النوع | ما يفعله | ما لا يفعله |
| --- | --- | --- |
| `ACTIVATION` تفعيل | يثبّت ترخيصًا جديدًا على جهاز محدد بمدة وحد مستخدمين | لا يُطبَّق على جهاز له ترخيص |
| `RENEWAL` تجديد | يضيف مدة إلى نهاية الترخيص | لا يغيّر حد المستخدمين |
| `SEATS` زيادة مستخدمين | يرفع حد المستخدمين فقط | لا يغيّر المدة ولا يبدأ عدّادًا جديدًا |
| `TRANSFER` نقل | ينقل الترخيص إلى جهاز آخر بمدته وحدّه وعدّاده | لا يفعّل جهازًا ثالثًا، ولا يستخدم للزيادة أو التجديد |

كل مفتاح يحمل **نوعه** داخل البيانات الموقّعة، فيتحقق البرنامج أن المفتاح من النوع
المطلوب للعملية قبل أن يغيّر أي شيء. مفتاح زيادة المستخدمين لا يفعّل جهازًا،
ومفتاح التفعيل لا يتجاوز عدّاد المقاعد.

## التوقيع / Signing

- Ed25519. المفتاح الخاص موجود **فقط** في أداة المورّد (`tools/license-generator`).
- البرنامج والتركيب وقاعدة بيانات العميل تحمل **المفتاح العام فقط**.
- لا يوجد مفتاح متماثل ولا سرّ مضمّن في البرنامج: قيمة مضمّنة في برنامج تكون
  معروفة لكل من يقرأ البرنامج، وحينها يصنع أي شخص ترخيصًا لنفسه.
- لا مفاتيح حقيقية في مستودع Git.

## الملفات / Where things live

| المسار | الدور |
| --- | --- |
| `backend/src/modules/licensing/license-key.ts` | صيغة المفتاح، التحقق من التوقيع، قراءة الكود |
| `backend/src/modules/licensing/license-duration.ts` | حساب المدد بالأشهر الميلادية |
| `backend/src/modules/licensing/license-store.ts` | ملف الحالة المحمي بالخارج عن قاعدة البيانات (علامات مائية، مفاتيح مستهلكة، حالة الساعة) |
| `backend/src/modules/licensing/licensing.service.ts` | تطبيق المفاتيح، عدّاد المقاعد، سياسة الساعة |
| `backend/src/modules/licensing/license.guard.ts` | ما يتوقف عند الانتهاء، وما لا يتوقف أبدًا |
| `backend/prisma/migrations/20261025120000_offline_licensing` | جداول الترخيص + ترحيل المستخدمين الحاليين |
| `tools/license-generator/kayan-license.mjs` | أداة المورّد (لا تُشحن مع البرنامج) |

## الأدلة / Guides

- [`OPERATOR-GUIDE.md`](OPERATOR-GUIDE.md) — إجراءات المورّد خطوة بخطوة.
- [`KEY-PROTECTION.md`](KEY-PROTECTION.md) — حماية المفتاح الخاص ونسخه الاحتياطي.
- [`MACHINE-ID.md`](MACHINE-ID.md) — معرّف الجهاز، تغيير العتاد، إعادة تثبيت ويندوز.
- [`CLOCK-POLICY.md`](CLOCK-POLICY.md) — سياسة تعديل تاريخ الجهاز وحدودها بصراحة.
- [`LICENSEE-GUIDE.md`](LICENSEE-GUIDE.md) — ما يفعل العميل عند التفعيل أو الانتهاء.

## لمحة عن التدفق / The flow at a glance

1. العميل يثبّت البرنامج، تظهر شاشة الترخيص ومعها **كود طلب** يحمل معرّف الجهاز.
2. يرسل الكود للمورّد (واتساب أو بريد).
3. المورّد يقرأه بالأداة ويصدر مفتاح `ACTIVATION` لذلك الجهاز.
4. العميل يلصق المفتاح في شاشة الترخيص؛ البرنامج يتحقق من التوقيع والجهاز والنوع
   والمدة والحد ثم يحفظ الترخيص ويعيد التحقق عند كل تشغيل.
