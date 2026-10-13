# ERP_KAYAN

Cross-platform enterprise resource planning client (Flutter), targeting **Android,
iOS, Windows, macOS, Linux and Web** from a single codebase.

## Repository layout

| Path | Contents |
| --- | --- |
| `lib/` | Flutter client (Android, iOS, Windows, macOS, Linux, Web) |
| `backend/` | NestJS API server — the only component that talks to the database |
| `docker-compose.yml` | Local / on-premise deployment of PostgreSQL + API |
| `DESIGN.md` | The design rules of the program, for Google Stitch and any designer |
| `docs/STITCH.md` | How a design made in Google Stitch reaches the program (Arabic) |
| `design/incoming/` | Drop exports from Stitch here |
| `docs/DESKTOP_WINDOWS.md` | The Windows copy that starts its own server (Arabic) |
| `scripts/build-desktop-windows.ps1` | Builds that copy: one folder that runs by itself |
| `scripts/installer-windows.iss` | Turns that folder into one Setup .exe a customer runs (Inno Setup) |
| `scripts/verify-package.ps1` | Asks whether a built copy is really shippable - no database needed |
| `.github/workflows/windows-package.yml` | Builds it on a real Windows machine and publishes the result |
| `tools/backend_shape_check.dart` | Proves the desktop and the web backend layer still agree |

The built Windows copy is published as a release, so nobody has to build it to
run it: <https://github.com/mohamedkamel78/ERP_KAYAN/releases>. The installer is
`KAYAN-ERP-Setup-1.0.0.exe`; the machine it lands on needs PostgreSQL and
nothing else. `docs/DESKTOP_WINDOWS.md` says what happens when it is opened.

## Status

**Backend:** the NestJS API includes authentication (Argon2id + JWT access/refresh),
company-scoped business data, accounting and journal posting/reversal, user and
role administration, company profile, inventory, parties, sales, purchases,
reports, import/export, backups, health checks, and an append-only audit trail.
The Prisma schema and versioned migrations are the source of truth for the
database structure. Feature presence does not mean every workflow is production-
ready; verify each module's acceptance criteria before deploying it to a business.

**Client:** Flutter feature areas include authentication, dashboard, accounting,
administration, inventory, invoicing, and settings, with Arabic/English
localization and cross-platform targets. Some screens and API workflows are
more complete than others. Treat CI results as code-quality checks, not as proof
that every business process has been accepted end to end.

## Architecture

Feature-first layout with an inner clean-architecture split per feature:

```
backend/                       # NestJS API server
├── prisma/schema.prisma       # database schema; money uses numeric(19,4)
├── prisma/seed.ts             # development seed (company, admin, chart)
└── src/
    ├── common/                # auth/rate-limit/permission guards, filters, audit, Prisma
    └── modules/               # auth, admin, company, accounting, inventory,
                               # parties, sales, purchases, reports, import/export,
                               # backup, health, maintenance

lib/
├── main.dart                  # bootstrap: logging, ProviderScope
├── app/                       # application shell
│   ├── app.dart               # MaterialApp.router, locale + theme wiring
│   ├── router/                # go_router config and auth redirect
│   ├── shell/                 # responsive navigation (rail / bottom bar)
│   └── theme/                 # Material 3 theme
├── core/                      # cross-cutting, no feature dependencies
│   ├── config/                # AppConfig from --dart-define
│   ├── error/                 # sealed Failure hierarchy
│   ├── result/                # sealed Result<T>
│   ├── money/                 # decimal-safe Money value object
│   ├── network/               # Dio client, bearer token, failure mapping
│   ├── storage/               # keystore tokens + locale preference
│   ├── logging/               # logging facade
│   └── utils/                 # pure validators
├── features/
│   ├── accounting/            # domain / data / presentation
│   ├── admin/
│   ├── auth/                  # domain / data / presentation
│   ├── dashboard/
│   ├── inventory/
│   ├── invoicing/
│   └── settings/
├── shared/                    # widgets, extensions, error localization
└── l10n/                      # en + ar ARB sources and generated code
```

Rules the codebase follows:

- `domain` never imports `data` or `presentation`.
- Only `app/` composes features; features do not import each other's internals.
- The client never talks to a database. All data goes through the HTTP API.
- Money is never a `double` — client uses `Decimal`, server uses `numeric(19,4)`.
- The server enforces accounting rules; the client may hide UI but is never
  the control.

## Accounting core

`JournalEntry` enforces the double-entry invariant at construction time:

- at least two lines, all in the entry's single currency;
- a line is either a debit or a credit, never both, and never negative;
- `isBalanced` compares rounded totals, so sub-cent representation noise
  cannot mask — or fake — an imbalance;
- `post()` refuses an unbalanced entry; posted entries are corrected by
  generating a `reversal()`, never by editing.

These invariants are covered by unit tests.

## Localization

English and Arabic are first-class. Text direction follows the locale, so
switching to Arabic renders the entire application right-to-left. The choice
is persisted and can be reset to the system locale.

## Configuration

Nothing environment-specific is hardcoded. Configuration is injected at build
time:

```bash
flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://localhost:8080/api/v1
```

`APP_ENV` accepts `development`, `staging`, `production` or `onPremise`.
Seed (sample) data is enabled **only** in `development`; any other environment
always talks to the real API, and the interface displays a banner whenever
sample data is in use.

## Getting started

> **على ويندوز؟** فيه دليل عربي كامل خطوة بخطوة في
> [`RUN_LOCALLY.md`](RUN_LOCALLY.md) — بشرح تنصيب البرامج وتشغيل كل حاجة.
> وفيه سكربتات جاهزة في مجلد `scripts/` بتعمل الإعداد لوحدها.
>
> **On Windows?** A full step-by-step guide is in
> [`RUN_LOCALLY.md`](RUN_LOCALLY.md) (Arabic), with helper scripts in
> `scripts/`. Git commands are collected in
> [`GIT_CHEATSHEET.md`](GIT_CHEATSHEET.md).

The client needs the API running. Full Windows instructions are in
[`backend/README.md`](backend/README.md); in short:

```bash
# terminal 1 — database and API
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npx ts-node prisma/seed.ts
npm run start:dev            # http://localhost:3000/api/v1

# terminal 2 — client
cd ..
flutter pub get
flutter gen-l10n             # regenerate translations after editing .arb files
flutter run -d chrome        # or: -d windows | -d macos | -d linux
```

Development sign-in: `admin` / `Admin@12345` — **change it before real use**.

The client never connects to PostgreSQL. Every read and write goes through the
API, which is the single source of truth.

## Quality gates

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build web --release
```

Run these gates in the same environment and commit you intend to release. GitHub
Actions also runs backend type-checking/tests/build, Prisma validation and
isolated PostgreSQL smoke tests, Flutter analysis/tests, and the web build.
A green CI run validates those automated checks only; it does not replace
business acceptance testing or a production deployment rehearsal.

## Pending business decisions

The following are intentionally not decided in code:

| Area | Question |
| --- | --- |
| Backend technology | **Decided:** NestJS + Prisma + PostgreSQL |
| Tax / VAT rules | Rate source, rounding and the treatment of returns. |
| Inventory costing | FIFO vs weighted average, and when COGS is recognised. |
| Fiscal calendar | Fiscal-year start and period-locking policy. |
| Document numbering | Scope (company/branch/year), gapless vs sequential-with-gaps. |
| Permissions model | Role catalogue and whether approval workflows are required. |
| Reporting | Required statutory reports and their layouts. |

The API is now the source of data. A local sample source still exists for
working on the interface without a server, but it is **opt-in and disabled by
default**; enable it only for development:

```bash
flutter run -d chrome --dart-define=USE_SEED_DATA=true
```

It is refused outside development builds, and the UI shows a banner whenever
it is active. It is never a system of record.

---

## التحديثات الأخيرة (أكتوبر 2026) — Latest additions

- **بيانات الشركة والفروع**: شاشة «بيانات الشركة» (الاسم العربي والإنجليزي، الكود، الهاتف/البريد/العنوان، الرقم الضريبي، الشعار، المقر الرئيسي والفروع) مع ربط فرعي وتحقق من الربط الدائري، وواجهة إعداد أول تشغيل آمنة (`/setup/*`). راجع `PROJECT_KNOWLEDGE.md`.
- **«تذكرني» في تسجيل الدخول**: اختياري ومتوقف افتراضياً — يحفظ اسم المستخدم فقط على الويب، وكلمة المرور في مخزن نظام التشغيل الآمن (وليس في تخزين نصي) على سطح المكتب، مع زر مسح البيانات المحفوظة.
- **دليل الحسابات متعدد المستويات**: شجرة قابلة للطي، إنشاء/تعديل/حذف بصلاحية `accounting.accounts.*`، أكواد فريدة مع اقتراح تلقائي، منع الترحيل للحسابات التجميعية، ومنع الحذف الآمن (`docs/BACKUP_RESTORE.md`).
- **التصدير المحسّن**: ملفات `.xlsx` حقيقية (أنواع خلايا، عرض أعمدة، إجماليات، شعار واسم الشركة)، تصدير دليل الحسابات بترتيب الشجرة، وتصدير القيود على مستوى السطر (كود الحساب واسمه بالعربية/الإنجليزية، مدين/دائن، الإجماليات). PDF عبر Chrome مع أرقام صفحات، وصفحة طباعة RTL بترويسات متكررة.
- **النسخ الاحتياطي الكامل والاستعادة**: `pg_dump` بصيغة Custom مع نسخة أمان تلقائية، تجربة الاستعادة على قاعدة مؤقتة، وقفل الكتابة أثناء الاستعادة، وتحقق سليم بعد الاستعادة. التفاصيل في [`docs/BACKUP_RESTORE.md`](./docs/BACKUP_RESTORE.md).
- **قاعدة المعرفة**: أُضيف [`PROJECT_KNOWLEDGE.md`](./PROJECT_KNOWLEDGE.md) (كان مفقوداً) — البنية، قواعد Prisma، القواعد المحاسبية، والحدود المعروفة.
- **الأيقونة الرسمية**: `Kayan.png` (جذر المستودع) هي مصدر كل أيقونات البرنامج — أيقونة `erp_kayan.exe` والنافذة، وأيقونة المتصفح وملفات PWA، وأيقونة المثبّت والاختصارات. تُولَّد جميعها بأمر `python tools/generate_icons.py` وتُضمَّن تلقائياً في حزمة التوزيع.

### الاختبارات — Tests

- الخادم: `cd backend && npx jest` (قواعد دليل الحسابات، قواعد الشعار، حمايات النسخ الاحتياطي، كتّاب التصدير).
- Flutter: `flutter test` (تذكرني، قواعد أسماء الحسابات، الاختبارات السابقة). تمت كتابة الاختبارات في بيئة بدون Flutter SDK — يجب تشغيلها محلياً.
