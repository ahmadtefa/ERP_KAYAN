# تشغيل النظام على جهازك

دليل كامل من الصفر. اتّبع الخطوات بالترتيب.

---

## ⚠️ مهم جداً: إنت شغال على أي ترمنال؟

VS Code بيفتح **PowerShell** افتراضياً، واللي **بيفرق** في طريقة كتابة الأمر:

| الترمنال | اكتب الأمر إزاي |
| --- | --- |
| **PowerShell** (اللي بيبدأ بـ `PS`) | ``.\`scripts\setup-windows.bat`` — **لازم نقطة وشخط** |
| **Command Prompt** (CMD) | `scripts\setup-windows.bat` |

> **عايز تبسّطها؟** خلي الترمنال الافتراضي Command Prompt:
> اضغط `Ctrl + Shift + P` ← اكتب `Terminal: Select Default Profile` ← اختار **Command Prompt**
> وبعدين اقفل الترمنال وافتحه تاني.

**العلامة:** لو شايف `PS` في أول السطر يبقى PowerShell → استخدم `.\scripts\...`

---

## قبل ما تبدأ — إيه اللي محتاجه؟

| البرنامج | ليه؟ | منين |
| --- | --- | --- |
| **Git** | عشان تنسخ المشروع | https://git-scm.com/download/win |
| **Node.js 24 LTS** | عشان السيرفر | https://nodejs.org |
| **PostgreSQL 17** | قاعدة البيانات | https://www.postgresql.org/download/windows/ |
| **Flutter SDK** | عشان الواجهة | https://docs.flutter.dev/get-started/install/windows |
| **Google Chrome** | لتشغيل الواجهة في المتصفح | غالباً متثبت عندك |

> **مهم عند تثبيت PostgreSQL:** هيطلب منك تحدد باسوورد للمستخدم `postgres`.
> **اكتبها واحفظها** — هتحتاجها بعدين. خليها بسيطة دلوقتي لأنها للتطوير المحلي بس.

> ⚠️ **لو أي تثبيت فشل بكود `1603`** (خطأ صلاحيات من Windows Installer) →
> فيه طريقة تانية **بدون أدمن خالص** في قسم
> [لو winget فشل](#️-لو-winget-فشل--تثبيت-بدون-صلاحيات-أدمن) تحت.

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

```powershell
.\scripts\setup-windows.bat      # PowerShell
scripts\setup-windows.bat        # Command Prompt
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

## 🛠️ لو `winget` فشل — تثبيت بدون صلاحيات أدمن

بعض الأجهزة بترفض تثبيت البرامج العادية بكود خطأ `1603` (خطأ صلاحيات من Windows Installer).
الحل: نسخة **محمولة** بتتنسخ في مجلد عادي بتاعك — **من غير تثبيت ومن غير أدمن**.

### Node.js

```powershell
git pull
.\scripts\install-node-portable.bat
```

بينزّل Node.js الرسمي ويفك ضغطه في `%LOCALAPPDATA%\kayan-tools\node` وبعدين يضيفه للـ PATH.

### PostgreSQL

```powershell
git pull
.\scripts\install-postgres-portable.bat
```

> ⏳ **التحميل حوالي 330 ميجا** — ممكن ياخد كذا دقيقة. طبيعي إن مفيش أي حاجة بتتحرك.

بينزّل ملفات PostgreSQL الرسمية ويفك ضغطها في `%LOCALAPPDATA%\kayan-tools\pgsql`،
وبعدين **يعمل قاعدة البيانات ويشغّلها** لوحده.

**في آخر السكربت:** اقفل كل نوافذ VS Code وافتحه تاني، وبعدين كمّل من **الخطوة 2** عادي.

> 💡 لما `setup-windows.bat` يسألك على باسوورد المستخدم `postgres`، اكتب: `postgres`
> (قاعدة البيانات دي بتقبل اتصالات من الجهاز ده بس، فالباسوورد مش مستخدم في حاجة هنا)

### تشغيل قاعدة البيانات بعد إعادة تشغيل الكمبيوتر

النسخة المحمولة مش بتشتغل لوحدها مع الويندوز، فلازم تشغّلها:

```powershell
.\scripts\start-postgres.bat
```

**أو** بس شغّل `pull-and-run.bat` — ده بيشغّلها لوحده قبل أي حاجة.

### إزاي تعرف إنها شغالة؟

```powershell
psql -U postgres -h 127.0.0.1 -c "SELECT version();"
```

لو طلعلك رقم نسخة (مثلاً `PostgreSQL 17.7`) ✅ يبقى تمام.
لو طلعلك خطأ اتصال → شغّل `start-postgres.bat` الأول.

### تفاصيل تقنية

| الحاجة | مكانها |
|---|---|
| ملفات PostgreSQL | `%LOCALAPPDATA%\kayan-tools\pgsql` |
| مجلد قاعدة البيانات | `%LOCALAPPDATA%\kayan-tools\pgdata` |
| ملف اللوج (لو فيه مشكلة) | `%LOCALAPPDATA%\kayan-tools\postgres.log` |
| نسخة الـ PATH القديمة | `%LOCALAPPDATA%\kayan-tools\PATH-backup.txt` |

**ملاحظة أمنية:** النسخة المحمولة مضبوطة على `trust` — يعني بتقبل أي اتصال من **الجهاز ده بس** بدون باسوورد.
ده مناسب للتطوير المحلي، **ومش مناسب لو هتفتح السيرفر على النت**.

**عايز ترجّع الـ PATH زي ما كان؟** انسخ المحتوى من `PATH-backup.txt` والصقه في:
`Ctrl + Shift + P` ← `PATH` ← `Edit the system environment variables`

---

## ⚡ طريقة أسرع: أمر واحد بس

لو المشروع عندك على الجهاز خلاص وتيجي كل مرة تسحب آخر التعديلات وتشغّل:

```powershell
.\scripts\pull-and-run.bat       # PowerShell
scripts\pull-and-run.bat         # Command Prompt
```

بيعمل كل حاجة:
1. يسحب آخر التعديلات من GitHub (`git pull`)
2. يشوف السيرفر شغال ولا لأ — ولو مش شغال **يشغّله لوحده في نافذة جديدة**
3. يحدّث حزم Flutter (`flutter pub get`)
4. يشغّل الواجهة في Chrome

---

## الخطوة 3: شغّل السيرفر

```powershell
.\scripts\start-backend.bat      # PowerShell
scripts\start-backend.bat        # Command Prompt
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
| `scripts\x.bat: The module 'scripts' could not be loaded` | إنت على PowerShell — اكتب `.\scripts\x.bat` أو غيّر الترمنال لـ Command Prompt |
| `node is not recognized` بعد التثبيت | اقفل **كل** نوافذ VS Code وافتحه تاني (أو اعمل restart للكمبيوتر) |
| `winget ... failed with exit code: 1603` | استخدم النسخة المحمولة — شوف [قسم winget فشل](#️-لو-winget-فشل--تثبيت-بدون-صلاحيات-أدمن) |
| السيرفر طلع `Can't reach database server` | قاعدة البيانات مش شغالة → `scripts\start-postgres.bat` |

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
