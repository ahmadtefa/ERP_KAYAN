# تشغيل النظام على جهازك

دليل كامل من الصفر. اتّبع الخطوات بالترتيب.

---

## قبل ما تبدأ — إيه اللي محتاجه؟

| البرنامج | ليه؟ | منين |
| --- | --- | --- |
| **Git** | عشان تنسخ المشروع | https://git-scm.com/download/win |
| **Node.js 20 LTS** | عشان السيرفر | https://nodejs.org |
| **PostgreSQL 17** | قاعدة البيانات | https://www.postgresql.org/download/windows/ |
| **Flutter SDK** | عشان الواجهة | https://docs.flutter.dev/get-started/install/windows |
| **Google Chrome** | لتشغيل الواجهة في المتصفح | غالباً متثبت عندك |

> **مهم عند تثبيت PostgreSQL:** هيطلب منك تحدد باسوورد للمستخدم `postgres`.
> **اكتبها واحفظها** — هتحتاجها بعدين. خليها بسيطة دلوقتي لأنها للتطوير المحلي بس.

---

## الخطوة 1: انسخ المشروع على جهازك

افتح **Command Prompt** أو **PowerShell** واكتب:

```cmd
cd %USERPROFILE%\Desktop
git clone https://github.com/mohamedkamel78/ERP_KAYAN.git
cd ERP_KAYAN
```

هتلاقي مجلد `ERP_KAYAN` على سطح المكتب.

> **بديل لو مش عايز تستخدم Git:**
> افتح https://github.com/mohamedkamel78/ERP_KAYAN
> اضغط الزر الأخضر **Code** ← **Download ZIP**
> فك الضغط على سطح المكتب، ثم: `cd ERP_KAYAN`

### التأكد إن النسخ نجح

```cmd
git log --oneline -3
```

المفروض تشوف 4 سطور (4 commits). آخر واحد `2bd735e`.

---

## الخطوة 2: جهّز السيرفر

### الطريقة السهلة (ملف تلقائي) ⭐

في مجلد `ERP_KAYAN` افتح مجلد **`scripts`** وشغّل:

```cmd
scripts\setup-windows.bat
```

اضغط عليه بالماوس: **كليك يمين ← Run as administrator** (أو دبل كليك عادي).

السكربت هيعمل كل حاجة لوحده:
- ✅ يتأكد إن Node و PostgreSQL متثبتين
- ✅ يطلب منك باسوورد `postgres` (اللي كتبتها وقت التثبيت)
- ✅ يعمل قاعدة البيانات والمستخدم
- ✅ يكتب ملف `.env` بمفاتيح سرية عشوائية آمنة
- ✅ يثبّت الحزم ويعمل الجداول ويحمّل البيانات الأولية

**استنى لحد ما تشوف `Setup complete`.**

---

### الطريقة اليدوية (لو السكربت فشل)

#### أ) اعمل قاعدة البيانات

افتح **SQL Shell (psql)** من قائمة ابدأ (اضغط Enter لكل سؤال، وباسوورد `postgres` في الآخر):

```sql
CREATE ROLE erp_app WITH LOGIN PASSWORD 'اختار-باسوورد-قوية-هنا';
CREATE DATABASE erp_kayan OWNER erp_app;
ALTER ROLE erp_app CREATEDB;
\q
```

#### ب) جهّز ملف الإعدادات

```cmd
cd backend
copy .env.example .env
```

افتح `backend\.env` بأي محرر (Notepad) وعدّل سطر `DATABASE_URL` —
حط الباسوورد اللي كتبته بدل `CHANGE_ME`:

```
DATABASE_URL="postgresql://erp_app:اختار-باسوورد-قوية-هنا@127.0.0.1:5432/erp_kayan?schema=public"
```

بعدين ولّد مفتاحين سريين — شغّل الأمر ده **مرتين** وحط كل قيمة في مفتاح مختلف:

```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

يعني:
```
JWT_ACCESS_SECRET="القيمة-الأولى"
JWT_REFRESH_SECRET="القيمة-التانية"
```

#### ج) ثبّت وشغّل

```cmd
npm install
npx prisma generate
npx prisma migrate deploy
npx ts-node prisma/seed.ts
```

---

## ⚡ طريقة أسرع: أمر واحد بس

لو المشروع عندك على الجهاز خلاص وتيجي كل مرة تسحب آخر التعديلات وتشغّل:

```cmd
scripts\pull-and-run.bat
```

بيعمل كل حاجة:
1. يسحب آخر التعديلات من GitHub (`git pull`)
2. يشوف السيرفر شغال ولا لأ — ولو مش شغال **يشغّله لوحده في نافذة جديدة**
3. يحدّث حزم Flutter (`flutter pub get`)
4. يشغّل الواجهة في Chrome

---

## الخطوة 3: شغّل السيرفر

```cmd
scripts\start-backend.bat
```

أو يدوياً:

```cmd
cd backend
npm run start:dev
```

**اترك النافذة مفتوحة!** لما تشوف:

```
[Bootstrap] API listening on http://localhost:3000/api/v1
```

### تأكد إنه شغال

افتح المتصفح على: **http://localhost:3000/api/v1/health**

المفروض تشوف:
```json
{"status":"ok","database":"up","timestamp":"..."}
```

لو شفت `"database":"down"` يبقى فيه مشكلة في قاعدة البيانات.

---

## الخطوة 4: شغّل الواجهة

**افتح نافذة Command Prompt جديدة** (سيّب اللي فاتحة زي ما هي):

```cmd
cd %USERPROFILE%\Desktop\ERP_KAYAN
scripts\start-client.bat
```

أو يدوياً:

```cmd
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

هتفتح نافذة Chrome فيها شاشة تسجيل الدخول.

---

## الخطوة 5: سجّل الدخول

| | |
| --- | --- |
| **اسم المستخدم** | `admin` |
| **كلمة المرور** | `Admin@12345` |

بعد الدخول هتلاقي:
- **لوحة التحكم** — عدد الحسابات ومعلومات الشركة والفرع
- **دليل الحسابات** — 30 حساب بالعربي والإنجليزي
- **الإعدادات** — تغيير اللغة (عربي/إنجليزي) والخروج

**جرّب تغيّر اللغة للعربي** وشوف الواجهة بتتقلب من اليمين للشمال.

---

## عايز تجرّب البيانات الوهمية بدون سيرفر؟

لو عايز تشوف الشكل بس من غير ما تشغّل السيرفر:

```cmd
flutter run -d chrome --dart-define=USE_SEED_DATA=true
```

> هيظهرلك شريط مكتوب عليه "Development sample data" — ده متعمّد
> عشان تفرّق بين البيانات الوهمية والحقيقية.

---

## تشغيله على الموبايل أو التابلت

السيرفر بيستقبل من الشبكة المحلية، فتقدر تشغّل الواجهة على الموبايل:

```cmd
:: اكتشف IP جهازك
ipconfig
:: هتلاقي حاجة زي 192.168.1.5 تحت IPv4 Address
```

```cmd
flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3000/api/v1
```

> **المفروض:** الموبايل وجهاز الكمبيوتر على **نفس شبكة الواي فاي**،
> والويندوز فايروول هيطلب إذن — **وافق**.

---

## حل المشاكل

| المشكلة | الحل |
| --- | --- |
| `'git' is not recognized` | نصّب Git وسكّر النافذة وافتحها تاني |
| `'node' is not recognized` | نصّب Node.js وأعد تشغيل النافذة |
| `'flutter' is not recognized` | نصّب Flutter وضيفه للـ PATH، وبعدين `flutter doctor` |
| `'psql' is not recognized` | ضيف `C:\Program Files\PostgreSQL\17\bin` للـ PATH |
| `Could not connect to PostgreSQL` | افتح `services.msc` وشغّل خدمة `postgresql-x64-17` |
| **شاشة الدخول بتقول خطأ** | اتأكد إن السيرفر شغال: افتح `http://localhost:3000/api/v1/health` |
| `Port 3000 is already in use` | فيه برنامج تاني على المنفذ 3000 — اقفل التطبيق ده أو غيّر `PORT` في `.env` |
| الواجهة فتحت بس فاضية | استنى شوية — أول تشغيل بياخد وقت. وشوف النافذة فيها خطأ إيه |
| الموبايل مش بيوصل للسيرفر | تأكد إن الاتنين على نفس الواي فاي، ووافق على إذن الفايروول |

---

## إيقاف النظام

- **السيرفر:** روح على نافذته واضغط `Ctrl + C`
- **الواجهة:** اقفل نافذة Chrome

---

## ⚠️ ملاحظات مهمة

**ده بيئة تطوير محلية.** النظام دلوقتي:
- ✅ يشتغل على جهازك وعلى شبكتك المحلية
- ❌ **مش متاح من الإنترنت** — ده محتاج استضافة ودومين و HTTPS (المرحلة الجاية)

**قبل أي استخدام حقيقي:**
- غيّر باسوورد `Admin@12345`
- راجع دليل الحسابات مع محاسب (النموذج الحالي عام، مش معتمد)

**متفقدش ملف `backend\.env`** — فيه الباسووردات. ومتبعتوش لحد.
وهو مستثنى من Git تلقائياً، فمش هيترفع على GitHub.
