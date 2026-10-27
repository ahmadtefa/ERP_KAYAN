# كيان ERP — بلاطات الوحدات (Module Tiles)

حزمة تصميم وتشخيص فقط: 20 لوحة شاشة (10 شاشات عربي/إنجليزي) + 3 لوحات مرجعية + ثلاثة تقارير.

- **لم يُعدَّل أي كود تطبيق أو قاعدة بيانات أو ترجمة في هذه الحزمة.**
- كل الأرقام والأسماء في اللوحات توضيحية.
- صورة المرجع التصميمي غير موجودة في المستودع؛ بُنيت اللوحات على الوصف المكتوب (انظر `REDESIGN-REPORT.md` §3).

## اللوحات

| # | الملف | الشاشة | الاتجاه |
| --- | --- | --- | --- |
| 01 | `01-dashboard-ar.png` | لوحة التحكم — بلاطات الوحدات | AR / RTL |
| 02 | `02-module-sales-ar.png` | وحدة المبيعات | AR / RTL |
| 03 | `03-invoice-list-ar.png` | قائمة فواتير البيع | AR / RTL |
| 04 | `04-invoice-editor-ar.png` | إنشاء / تعديل مستند | AR / RTL |
| 05 | `05-document-view-ar.png` | عرض المستند والحالة | AR / RTL |
| 06 | `06-inventory-purchases-ar.png` | المخزون والمشتريات | AR / RTL |
| 07 | `07-parties-ar.png` | العملاء والموردون | AR / RTL |
| 08 | `08-trial-balance-ar.png` | التقارير المالية | AR / RTL |
| 09 | `09-dialogs-states-ar.png` | الحوارات والحالات | AR / RTL |
| 10 | `10-profile-ar.png` | الملف الشخصي | AR / RTL |
| 11 | `11-dashboard-en.png` | Dashboard | EN / LTR |
| 12 | `12-module-sales-en.png` | Sales module | EN / LTR |
| 13 | `13-invoice-list-en.png` | Invoice list | EN / LTR |
| 14 | `14-invoice-editor-en.png` | Invoice editor | EN / LTR |
| 15 | `15-document-view-en.png` | Document view | EN / LTR |
| 16 | `16-inventory-purchases-en.png` | Inventory & purchasing | EN / LTR |
| 17 | `17-parties-en.png` | Customers & suppliers | EN / LTR |
| 18 | `18-trial-balance-en.png` | Trial balance | EN / LTR |
| 19 | `19-dialogs-states-en.png` | Dialogs & states | EN / LTR |
| 20 | `20-profile-en.png` | Profile | EN / LTR |
| 21 | `21-user-journey.png` | الرحلة: لوحة التحكم ← وحدة ← قائمة ← مستند | AR |
| 22 | `22-design-system.png` | ألوان، خطوط، مكوّنات، حالات، استجابة | AR |
| 23 | `23-current-vs-proposed.png` | الحالي (نموذج المرحلة الأولى) مقابل المقترح | AR |

## التقارير

- `REDESIGN-REPORT.md` — القرارات، التنقّل، المكوّنات، الـ AR/EN، الاستجابة، الصورة الشخصية، القيود، قرارات المالك.
- `NUMBERS-AUDIT.md` — تشخيص الأرقام من الكود، الخيار A/B، خطة اختبار **لم تُنفَّذ**.
- `IMPLEMENTATION-PLAN.md` — مراحل، تبعيات، مخاطر، بوابات موافقة.

## ملاحظات دقة

- الأبعاد: 2800×1575 بكسل لكل لوحة (إطار منطقي 1400×787.5).
- ألوان الرموز مأخوذة من `lib/app/theme/design_tokens.dart`.
- ارتفاع الأزرار/الحقول في اللوحات أصغر من قيم `AppSizes` الحقيقية بسبب مقياس الرسم؛ عند التنفيذ تُستخدم قيم الرموز.
- «الحالي» في لوحة المقارنة هو نموذج المرحلة الأولى السابق (`../dashboard/`)، وليس التطبيق.
