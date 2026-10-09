# إدخال Google Stitch في شغل البرنامج

خطة عملية: انت بتعمل ٥ دقايق على Stitch، وأنا بسلّم التصميم جوه البرنامج.

---

## 1) Stitch ده إيه بالظبط

أداة تصميم من معامل جوجل (Google Labs)، مجانية، بتشتغل من المتصفح على
`https://stitch.withgoogle.com`. انت بتكتب وصف بالكلام لأي شاشة، وهو بيرسمها
لك، وبعدين **بتصدّرها كود** — HTML/CSS أو **Flutter** أو Figma.

| ايه اللي بيعمله | ايه اللي مش بيعمله |
|---|---|
| يرسم شاشة كاملة من وصف بالكلام أو من صورة | مش بيوصل للسيرفر ولا للداتابيز |
| يعمل أكتر من شاشة ويعمل بينهم لينكات للتنقل | مفيش منطق: مفيش حساب ضريبة ولا ترحيل ولا صلاحيات |
| يصدّر كود HTML/CSS أو Flutter أو يتفتح في Figma | بيصمّم إنجليزي/يسار→يمين بس |
| يقرأ ملف قواعد تصميم (DESIGN.md) فيلتزم بنفس الشكل | الكريدت محدود يومياً (وبيتجدد نص الليل UTC) |

يعني Stitch بيحل **الشكل**. الأرقام والصلاحيات والترحيل — دي جوه البرنامج
وجاهزة ومختبرة، ومش بيتلمس.

---

## 2) الشغل بيدخل البرنامج إزاي (تلات طرق)

١. **صفحات الطباعة و PDF** — دي صفحات HTML/CSS البرنامج بيولّدها أصلاً على
   السيرفر. Stitch بيدّي HTML/CSS، فالكود بيدخل زي ما هو بعد شغل خفيف.
   **دي أسرع وأقوى طريقة، وبتبان على الورق فوراً.**

٢. **الشاشات نفسها (Flutter)** — Stitch بقى بصدّر **Flutter**. الكود المصدّر
   نقطة بداية مش كود نهائي: أنا بياخد شكله (الترتيب، الألوان، المسافات) وأركّبه
   جوه بنية البرنامج الحالية، مع الحفاظ على الربط بالسيرفر والصلاحيات والتنزيل.
   النتيجة: محتوى شغال ١٠٠٪ + شكل جديد.

٣. **DESIGN.md** — ملف قواعد التصميم (الألوان، الخطوط، الجداول، الجانب العربي
   من اليمين لليسار) موجود في جذر المستودع. ترفعه لـ Stitch **أول حاجة**،
   فيطلع كل شاشة بنفس هوية البرنامج بدل ما كل شاشة تطلع بشكل مختلف.

---

## 3) خطواتك بالترتيب

1. افتح `https://stitch.withgoogle.com` وسجّل دخول بحساب جوجل.
   (أنا مش بلمس حسابك ولا بكلمة سر — الدخول عندك.)
2. من الإعدادات: **Standard mode**.
3. **مشروع جديد**، وبعدين ارفع ملف `DESIGN.md` اللي في جذر المشروع
   (الزرار بيدور على كلمة *Upload* أو *Import design rules* أو أيقونة الملف).
4. انسخ **المقدمة** اللي تحت دي والصقها أول حاجة في المشروع، واضغط Generate.
5. بعد كده خد **برومبت واحد في المرة** من البرومبتات الجاهزة تحت، والصقه،
   واضغط Generate لكل شاشة. متجمعهمش كلهم في بعض.
6. الشكل اللي يعجبك: اضغط زرار التصدير (أعلى الشاشة، اسمه قريب من
   **Code / Export**):
   - الشاشات → **Flutter** (أو Zip).
   - صفحات الطباعة → **HTML/CSS**.
7. حمّل الملفات وحطها في مجلد `design/incoming/` جوه المشروع، وقولي «نزّلت التصميم».
   وأنا بكمل من هنا.

> المرات اللي بعده: لو عايز تعدّل، عدّل في نفس المشروع
> (اكتب "change the totals panel to…") وصدّر من جديد.

---

## 4) المقدمة (الصقها مرة واحدة أول المشروع)

```
I am designing the screens of KAYAN ERP, an Arabic-first accounting and
inventory program used in a browser. Read the attached DESIGN.md and follow it
as the design system: primary colour #0B6E4F, Material 3, no shadows, hairline
tables, dense data, desktop canvas 1440x900, an always-visible left navigation
rail, and a header row with the page title on the left and the filters on the
right.

Design in English labels for now; I will localise the text later, so leave
room for longer words. Use realistic accounting data: codes like IM-001,
invoice numbers like SI-000004, amounts in EGP with two decimals, dates like
2026-10-08.

Every screen that shows a table also has a "Download the list" button that
opens a menu of four choices: Excel, CSV, PDF, Print. Keep that in mind.

Do not add illustrations, gradients, glows, marketing copy, or more than one
accent colour.
```

---

## 5) البرومبتات الجاهزة (واحد في المرة)

### ٥-١ شاشة الدخول

```
Design the sign-in screen of KAYAN ERP at 1440x900.

Centred card, 400 px wide, on the light neutral background: the product name
"KAYAN ERP" as a heading, a one-line description under it, then an outlined
field for Username, an outlined field for Password with a show/hide eye, and a
filled primary button "Sign in" at the bottom, full width of the card. Under
the button a quiet caption line: "كيان — accounting and inventory". Show an
inline error state on the username field, in red, as a second variant of the
screen. No illustration, no background image.
```

### ٥-٢ لوحة المعلومات (Dashboard)

```
Design the dashboard of KAYAN ERP at 1440x900.

Left navigation rail with 15 items, "Dashboard" marked as current with a soft
filled pill. Page title "Dashboard" on the left of the header row.

Content, top to bottom:
1. A greeting line: "Welcome back, Mohamed Kamel".
2. A row of four small statistic panels, each with a caption, a large number
   and a tiny caption under it: Accounts 30, Customers 9, Items 7, Sales this
   month 48,600.00 EGP.
3. A section "Quick access" with a grid of shortcut cards, each a bordered
   rectangle with an icon and a label: New sales invoice, New purchase invoice,
   New customer, New item, Journal entry, Reports, Import from a file,
   Backup.
4. A bottom panel "Latest activity": a compact table of the last 6 actions with
   columns Time, User, Action, Details.

No charts on this screen. Everything is a real number or a shortcut.
```

### ٥-٣ شاشة قائمة (العملاء) — النموذج اللي يتكرر

```
Design the Customers list screen of KAYAN ERP at 1440x900.

Left navigation rail with "Customers" marked as current. Header row: title
"Customers" on the left; on the right, a search field with a magnifier and the
hint "Search by code or name", a "Download the list" outlined button showing a
download icon and a small chevron, and a filled primary button "+ New
customer".

Below, a full-width table with these columns: Code, Name (English), Name
(Arabic), Phone, Tax number, Credit limit (right-aligned numbers), Status
(Active/Inactive chip), Actions (an edit pencil and a deactivate icon, quiet
until the row is hovered). Ten rows of realistic Egyptian customer names and
codes like C-1001, C-1002. Hairline row separators, no zebra striping, no
shadows.

Also show a small open menu under the "Download the list" button with four
items: Excel, CSV, PDF, Print — small monochrome icons, one line each, and the
Print item has a second line of caption text.
```

### ٥-٤ شاشة إدخال فاتورة بيع (أهم شاشة)

```
Design the sales invoice editor of KAYAN ERP at 1440x900. This is the screen an
accountant lives in, so it must be clear and dense.

Header row: back arrow, title "Sales invoice SI-000004", a grey "Draft" status
chip, and on the right two buttons: outlined "Save draft" and filled "Post".

Body in two columns. Left (wider):
1. A bordered panel "Invoice details": Customer (a searchable dropdown),
   Date, Due date, Payment terms, Branch, Reference, Notes — compact fields in
   a two-column grid.
2. A bordered panel "Lines": a table with columns Item, Description, Quantity,
   Unit, Unit price, Discount %, Tax %, Line total. Five filled rows with
   realistic items (Steel chair, Laptop, Consulting hour), right-aligned
   numbers, a small trash icon at the end of each row, and a quiet "+ Add line"
   text button under the table.

Right (narrower, sticky):
3. A "Summary" panel: Subtotal, Discount, Tax (14%), Total — with the grand
   total in a larger, heavier line, the whole panel tinted very lightly.
4. A "Before you post" panel: a checklist in small text (stock will be issued,
   a journal entry will be created, the period is open) with small green ticks.
5. A quiet link "Print / Save as PDF".
```

### ٥-٥ شاشة التقارير

```
Design the Reports screen of KAYAN ERP at 1440x900, showing the Trial balance
tab.

Header row: title "Reports", and on the right a date range control showing
"From 2026-01-01  To 2026-10-08" as a bordered control with a calendar icon,
then a refresh icon button.

Under the header, a tab row: Trial balance (current, underlined), Profit and
loss, Customer balances, Supplier balances, Account ledger.

Under the tabs, on the right, four export buttons in a row: Excel, CSV, PDF
(filled tonal), Print — each with a small icon.

Then a summary strip: "The ledger balances" with a small green check icon on
the right of that strip, and on the far right three figures: Debit 9,024.00,
Credit 9,024.00, Difference 0.00.

Then the table: Code, Account name, Opening, Debit, Credit, Closing, with
seven realistic accounts (1103 Accounts receivable, 1104 Inventory, 1105 VAT
receivable, 2101 Accounts payable, 2103 VAT payable, 4101 Sales revenue, 5101
Cost of goods sold) and right-aligned amounts.

Also design one variant where the difference is not zero: the Difference figure
in red with a warning icon.
```

### ٥-٦ صفحة الطباعة/PDF (تصديرها HTML/CSS)

```
Design a printable A4 portrait page for KAYAN ERP — this will be a real HTML
page, so export it as HTML/CSS, not Flutter.

Not a screen: no navigation, no buttons, no app chrome. White background, black
text, 12 mm margins.

Top: the title "Sales invoice SI-000004" in a large serif-free bold face, the
company name "شركة كيان" under it in a smaller line, and a hairline divider.
Under the divider a meta line: "Customer: Test Customer 1     Date: 2026-10-08
   Rows: 12".

Then the items table with hairline borders, header row in a very light grey:
Code, Item, Quantity, Unit price, Tax %, Line total.

Then a summary block aligned to the left: Subtotal, Discount, VAT 14%, and
Total in a bold larger line with a thin rule above it.

At the bottom, a caption in small grey: "Generated 2026-10-08 19:29 — KAYAN ERP
· Page 1".

Keep it strictly black and white with one grey tint so it prints cleanly on any
office printer, and make sure it also reads correctly if the whole page is
mirrored for Arabic (right to left).
```

### ٥-٧ شاشة النسخة الاحتياطية

```
Design the Backup and restore screen of KAYAN ERP at 1440x900.

Page title "Backup and restore" on the left of the header row.

Body, two bordered panels side by side:

Left panel "Take a backup": a short line explaining that one file holds the
whole company, a small table of what the file contains (Customer 9, Supplier 5,
Item 7, Account 30 rows), and a filled primary button "Download the backup"
with a download icon. Under it a quiet caption: "Keep the file somewhere other
than the server."

Right panel "Restore from a file": a warning strip in a light red tint with a
red icon and the line "This replaces everything in the company", a dashed drop
zone for a .json file, the file name once chosen, and a destructive outlined
button "Restore now" that is disabled until a file is chosen.

No shadows, hairline borders, the two panels the same height.
```

### ٥-٨ شاشة الإدارة (مستخدمون / أدوار / سجل)

```
Design the Administration screen of KAYAN ERP at 1440x900, showing the Users
tab.

Header row: title "Administration" on the left; on the right a search field, a
"Download the list" outlined button with a chevron, and a filled "+ New user"
button. Under the title a tab row: Users (current), Roles, Audit trail.

Users table columns: Username, Full name, Email, Roles (small grey chips),
Active (a small switch), Last sign-in (date), Actions (pencil, lock icon).
Three rows, one of them deactivated and shown in a muted way.

On the right, half-open, a slide-over panel "New user": fields Username, Full
name (English), Full name (Arabic), Email, Password, Roles (multi-select chips,
with Accountant, Cashier, Viewer), a toggle "Active", and at the bottom a filled
"Create user" button with an outlined "Cancel" beside it.
```

---

## 6) عندك شاشة موجودة وعايز تحسّنها؟

صوّر الشاشة من البرنامج، وارفعها في Stitch كنقطة بداية، واكتب معاها:

```
This is a screenshot of a screen from our ERP. Keep the same information and
the same columns, but redesign it to follow the attached DESIGN.md. Keep it
dense and practical; do not remove any column or action.
```

الصور الجاهزة للرفع موجودة في `docs/screens/`.

---

## 7) بعد ما تصدّر

| اللي صدّرته | اسمه إيه | بتعمله إيه |
|---|---|---|
| Flutter | `.dart` أو ملف zip | ارميه في `design/incoming/` |
| HTML/CSS | `.html` + `.css` أو zip | ارميه في `design/incoming/` |

وقولي **«نزّلت التصميم»** — وأنا:
أركّبه في البرنامج، أحافظ على كل الحاجات الشغالة (السيرفر، الصلاحيات،
الترجمة عربي/إنجليزي، أزرار التنزيل، الطباعة)، أعيد الفحوص كلها
(الأساسيات ١٥٣ + الخصائص ١٣٤ + المتصفح ٢٣)، وأرفع على GitHub، وأديك أمر
التحديث على اللاب توب.

---

## 8) بالأمانة

- Stitch **إنجليزي بس** في الواجهة والتصميم. مفيش مشكلة: كلام البرنامج كله
  جاي من ملفات الترجمة (`app_ar.arb` و`app_en.arb`)، فالتصميم يتعمل بالإنجليزي
  والنص العربي يتغيّر من مكان واحد.
- التصميم اللي Stitch بيطلّعه **ثابت**: صور وترتيب، من غير أي منطق. الشغل
  الحقيقي (الحسابات، الضريبة، الترحيل، الصلاحيات) جوه البرنامج ومختبر.
- الكود المصدّر نقطة بداية، مش كود نهائي يدخل زي ما هو.
- الكريدت بيكفي في اليوم لعدة شاشات، وبيتجدد كل يوم.
- أنا مش بدخل بحسابك؛ الشغل في Stitch عليك، والباقي عليّ.
