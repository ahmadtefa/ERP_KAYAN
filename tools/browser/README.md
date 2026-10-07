# فحص الواجهة في متصفح حقيقي

الأدوات اللي في المجلد ده بتشغّل البرنامج في متصفح (Chromium) وتتكلم معاه
مباشرة، عشان تتأكد إن الحاجة اللي المستخدم بيشوفها شغالة — مش بس إن السيرفر
بيرد صح.

## التشغيل

متصفح شغال في الخلفية مع منفذ التحكم:

```bash
chromium --headless=new --no-sandbox --disable-gpu \
         --remote-debugging-port=9222 --remote-allow-origins=* \
         --window-size=1440,900 about:blank
```

وبعدين (لازم `pip install websocket-client`):

```bash
python3 tools/browser/browser_check.py http://localhost:3000
python3 tools/browser/browser_login_shots.py http://localhost:3000
python3 tools/browser/browser_download_check.py http://localhost:3000
```

**`browser_check.py`** — الصفحة تفتح، الواجهة اتحمّلت، مفيش أخطاء في console،
والشاشات الجديدة بترسم.

**`browser_login_shots.py`** — بيسجّل الدخول بالماوس وبيدوس على بنود القائمة
وبيصوّر كل شاشة في `/tmp/out/`.

**`browser_download_check.py`** — بيدوس على أزرار Excel و CSV و طباعة، ويراقب
الطلب اللي المتصفح بعته والملف اللي رجع، وبيقيس محتواه (ملف Excel حقيقي،
وملف CSV فيه علامة BOM للعربي، وصفحة طباعة فيها أرقام التقرير).

> ملاحظة: المتصفح المجرد (headless) بيلغي التنزيل بعد ما يبدأ، عشان كده
> السكربت بيتأكد من الطلب والمحتوى، مش من ملف على القرص.
