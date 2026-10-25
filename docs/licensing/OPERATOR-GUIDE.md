# دليل المورّد — Operator guide

كل الأوامر تُشغَّل على جهاز المورّد، بلا إنترنت:

```
node tools/license-generator/kayan-license.mjs <command>
```

`--home` يحدد مجلد المفاتيح (افتراضيًا `~/.kayan-license-generator`).

## أول مرة / First run

```
node kayan-license.mjs init
node kayan-license.mjs backup --out D:\kayan-licence-backup
```

اطبع المفتاح العام وثبّته مع كل عملية تثبيت للبرنامج:

```
node kayan-license.mjs public-key
```

القيمة المعروضة كـ `LICENSE_PUBLIC_KEY` تُكتب في `kayan.env` بواسطة المُثبِّت، أو
تُوضع في ملف `public-key.pem` داخل مجلد حالة الترخيص
(`%ProgramData%\KAYAN-ERP\license`). راجع `KEY-PROTECTION.md` قبل أي خطوة.

## تسجيل ترخيص / Register a licence

```
node kayan-license.mjs licence create --ref "شركة النور - المنيا" --seats 5 --term 1y
```

- `--ref` ملاحظة حرة للتعرف على العميل، **ليست** اسمًا يُقرأ من البرنامج ولا
  يُربط به الترخيص. لا تضع فيها رقمًا ضريبيًا أو بيانات سرية.
- `--seats` حد المستخدمين (حسابات الدخول الحقيقية، لا العملاء ولا الموردين).
- `--term` المدة: `1m`, `6m`, `1y`, `2y`, `3y`, أو `P` للدائم.

المخرجات تعطي `lic_…` — احتفظ به، كل الأوامر التالية تحتاجه.

## التفعيل / Activation

العميل يرسل كود طلب من شاشة الترخيص يبدأ بـ `KYNREQ1.`. اقرأه:

```
node kayan-license.mjs show-request "KYNREQ1...."
```

ثم أصدر مفتاحًا **بنفس معرّف الجهاز**:

```
node kayan-license.mjs issue activation --licence lic_xxx --machine KM-AAAA-BBBB-CCCC --seats 5 --term 1y
```

أرسل السطر الأخير كاملًا للعميل. لا تقسمه ولا تعدّل فيه حرفًا.

## التجديد / Renewal

```
node kayan-license.mjs issue renewal --licence lic_xxx --term 1y
```

- التجديد المبكر **يضيف** المدة إلى تاريخ الانتهاء الحالي، فلا تضيع أيام.
- الترخيص المنتهي يبدأ من لحظة تطبيق مفتاح التجديد، ولا تُحتسب الفترة المنقضية.
- التجديد لا يغيّر حد المستخدمين ولا يُنقص العدّاد.

## زيادة المستخدمين / Seat increase

```
node kayan-license.mjs issue seats --licence lic_xxx --increase 3
# أو تحديد سقف جديد صريحًا:
node kayan-license.mjs issue seats --licence lic_xxx --cap 8
```

- `INCREASE` **زيادة** على الحد الحالي؛ `CAP` **سقف جديد** يُرفض إن كان أقل من
  عدد الحسابات المستخدمة.
- الوضع (زيادة/سقف) مكتوب **داخل المفتاح الموقّع**، فلا يمكن للبرنامج أن يقرأه
  على غير معناه.
- المفتاح لا يغيّر تاريخ البداية أو الانتهاء، ولا يصفّر العدّاد، ولا يحذف سجلًا.
- إعادة إدخال المفتاح نفسه مرفوضة (مفتاح واحد = منحة واحدة).

## النقل / Transfer

يتطلب موافقة المورّد بعد مراجعة العميل.

1. الجهاز الجديد يعطي كود طلب `KYNREQ1.` من شاشة الترخيص.
2. تأكد من عدد الحسابات المستخدمة على الجهاز الجديد إن كان قد استُخدم سابقًا.
3. أصدر المفتاح:

```
node kayan-license.mjs issue transfer --licence lic_xxx --machine KM-NEW-... --request "KYNREQ1...." --used 3
```

- `--used` عدد الحسابات المستخدمة وقت النقل (الافتراضي: ما في السجل). صحّحه من
  شاشة ترخيص العميل إن اختلف؛ **العدّاد لا يبدأ من الصفر**.
- المفتاح يحمل المدة المتبقية وحد المستخدمين والعدّاد. البرنامج يطبّقها كما هي،
  ولا يستطيع العميل نقل الترخيص بنفسه.
- مفتاح النقل لا يصلح للزيادة ولا للتجديد، والبرنامج يرفض تقديمه في هذين الموضعين.

## السجل والحالة / Register and status

```
node kayan-license.mjs list
node kayan-license.mjs list --licence lic_xxx
```

الحالات:

| الحالة | المعنى |
| --- | --- |
| `issued` | صدر ولم يُطبّق بعد |
| `used` | سجّلته كتطبيق فعلي (`mark-used`) |
| `revoked` | سحبته (`revoke`) |
| `superseded` | استُبدل بمفتاح أحدث من نفس النوع (تفعيل أو نقل) |

```
node kayan-license.mjs mark-used --key key_xxx
node kayan-license.mjs revoke --key key_xxx --reason "أُصدر بالخطأ"
node kayan-license.mjs verify "KYN1...."
```

## تصحيح بيانات الترخيص / Correcting the record

في حالة اختلاف السجل عن شاشة العميل:

```
node kayan-license.mjs licence set --licence lic_xxx --expires 2027-08-01 --used 4 --seats 6
```

هذا يعدّل سجل الأداة فقط؛ البرنامج لا يُعدَّل إلا بمفتاح.

## قواعد لا تُخترق / Hard rules

- لا تُرسل المفتاح الخاص ولا مجلد المفاتيح لأي عميل.
- لا تُصدر مفتاحًا لجهاز لم ترَ معرّفه.
- لا تُصدر "مفتاحًا شاملًا" أو استثناءً: البرنامج لا يعرف هذا النوع أصلًا.
- كل مفتاح يُسجَّل في السجل؛ لا إصدار خارجه.
