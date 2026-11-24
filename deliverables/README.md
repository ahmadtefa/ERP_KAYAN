# KAYAN Solar — ملف الاسترجاع

## الملف

| البند | القيمة |
| --- | --- |
| الاسم | `KAYAN-SOLAR-2026-11-24.dump` |
| الحجم | 2,795,564 بايت (2.7 MB) |
| الصيغة | PostgreSQL Custom dump — `pg_dump` 16.2 |
| البصمة SHA-256 | `136a116ade05d763c5b187aecd92bcf410ebf34a50e7cf650877b1dfa17c9c72` |
| الحالة | تم اختبار استرجاعه بنجاح — 11/11 فحصًا |

## محتوى الملف

| الكيان | العدد |
| --- | --- |
| الفروع | 5 |
| المخازن | 12 |
| المستخدمون | 29 |
| العملاء | 500 |
| الموردون | 100 |
| الأصناف | 1,000 (منها 430 تُدار بالدفعات) |
| فواتير الشراء | 1,000 |
| فواتير البيع | 556 |
| الدفعات (Lots) | 321 |
| التحويلات المخزنية | 199 |
| سندات الصرف | 231 (كلها مخصّصة لفاتورتها) |
| القيود اليومية | 1,642 |
| حركات المخزون | 4,080 |

## طريقة الاسترجاع

```bash
# 1) قاعدة بيانات فارغة
createdb -h 127.0.0.1 -p 5432 -U <user> kayan_solar

# 2) استرجاع الملف
pg_restore --dbname="postgresql://user:pass@127.0.0.1:5432/kayan_solar" \
  --no-owner --clean --if-exists KAYAN-SOLAR-2026-11-24.dump

# 3) تشغيل البرنامج
DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/kayan_solar?schema=public' \
JWT_ACCESS_SECRET=<سر-طويل> JWT_REFRESH_SECRET=<سر-آخر> \
node dist/src/main.js
```

أو من داخل البرنامج: `/backup/full/restore?confirm=true&fileName=…`

## بيانات الدخول

| المستخدم | كلمة المرور | الدور |
| --- | --- | --- |
| `admin` | `Admin@12345` | مدير النظام |
| `fin.mgr` | `K9XvtMQZKygvpxndXr7` | مدير مالي |
| `gm.kayan` | `K9KKGbUTpi+GJZVyor8` | مدير عام |
| `sales.cai` | `K9JtVqdXdEr6GTP57s9` | بائع — القاهرة |
| `pur.mgr` | `K9oQMVtBMjSbDfL3arw` | مدير مشتريات |
| `wh.mgr` | `K930KmUxcnPgZJ5WdV+` | مدير مخازن — القاهرة |
| `store.cai` | `K9WyTqRrLPFvZn8MsBc` | أمين مخزن — القاهرة |
| `cashier.cai` | `K9kHsGdWqXcTbN4YfLm` | أمين خزينة — القاهرة |

القائمة الكاملة للـ23 مستخدمًا في `credentials.json`.

## حدود هذه النسخة

- **فواتير البيع 556 وليس 3,000** — أوقفنا التوليد بناءً على طلب التسليم السريع.
- **سندات القبض غير موجودة** — لم تُولَّد لأن مرحلة البيع لم تكتمل في هذه النسخة.
- **النسخة لا تحوي الملفات الخارجية ولا ملف الترخيص** — البرنامج يصرّح بذلك في
  رد الـAPI: `includesExternalFiles: false, includesLicence: false`.
