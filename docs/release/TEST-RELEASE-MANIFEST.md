# بيان الإصدار التجريبي الخلفي — 2026-10-28

## النوع
حزمة اختبار خلفية (Backend Test Package) — ليست إصدارًا إنتاجيًا ولا بناء
Flutter ولا مثبت Windows ولا منشور GitHub. لم تُرفع أي أصول إلى أي مستودع خارجي.

## الأصل
- الفرع: `arena/2d794f08-erp-kayan`
- الالتزام المرجعي عند البناء: `891a804d231233da9bcc2fe15ce8939cd4bf59ce`
- النسخة في package.json: 0.1.0
- Prisma 6.19.3 بعميل WASM بلا محرك أصلي + محول `pg`.

## الملف (محلي، داخل مسار متجاهَل)
- المسار: `.local-snapshots/releases/kayan-backend-test-20261028-140315.tar.gz`
- SHA-256: `61c9d526bfb5e48372efce903f89cbd53346f680369d68a576df7da5f88b2dfb`
- الحجم: 1,438,729 بايت · عدد الملفات: 915 · `MANIFEST.sha256` داخل الحزمة
  ومُتحقق منه بـ`sha256sum -c` بنجاح.
- المحتوى: `dist/` (بناء nest build)، `prisma/` (مخطط + 51 هجرة + بذرة +
  كتالوج الصلاحيات)، ملفات البناء والإقفال، `.env.example`، `RELEASE_NOTES.md`.

## اختبار الإقلاع الفعلي للحزمة (نُفذ ثم أُوقف الخادم)
- استخرجت الحزمة واستُخدم `node_modules` الخاص بشجرة العمل كرابط اختبار فقط.
- الإقلاع: `PORT=3003 ... node dist/src/main.js` ضد قاعدة `kayan_audit3`
  الطازجة (51 هجرة + بذرة) → `KAYAN-API-READY port=3003`.
- `GET /api/v1/health` → 200، `"database":"up","databaseName":"kayan_audit3"`.
- `POST /api/v1/auth/login` (admin) → JWT صادر، 86 صلاحية محمّلة.
- أُوقف الخادم بعد التقاط الدليل؛ لا خدمة إصدار تبقى قائمة.

## حدود صادقة
- لا تتضمن node_modules (تُستعاد بـ`npm ci` من القفل المرفق).
- توليد Prisma في بيئة بلا وصول binaries.prisma.sh يحتاج الوصفة الموثقة
  (WASM + متغيرات الشيم)؛ في الشبكات العادية `prisma generate` يعمل رسميًا.
- لا يمكنها وحدها إثبات PDF/Flutter/Windows — راجع `docs/catalog/04`.

## حزم الحماية المرافقة
- البندل: `.local-snapshots/erp-kayan-protection-20261028-135232.bundle`
- أرشيف الشجرة: `.local-snapshots/working-tree-20261028-135232.tar.gz`
- مجاميع SHA-256 ونتائج الاستعادة موثقة في التقرير النهائي بالمحادثة.
