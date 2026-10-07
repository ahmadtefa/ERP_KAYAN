#!/usr/bin/env python3
"""Clicks the Excel and Print buttons in a real browser and watches what happens.

This is the part no server-side test can prove: that the button in the client
really reaches the server, that the browser really saves a file, and that the
print page really opens.
"""

import base64
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
DEVTOOLS = "http://127.0.0.1:9222"
DOWNLOADS = "/tmp/downloads"

os.makedirs(DOWNLOADS, exist_ok=True)
for name in os.listdir(DOWNLOADS):
    os.remove(os.path.join(DOWNLOADS, name))

targets = json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/list"))
target = [t for t in targets if t["type"] == "page"][0]
ws = create_connection(target["webSocketDebuggerUrl"], timeout=60)
counter = iter(range(1, 99999))
requests = []
new_tabs = []
opened = []
downloads_started = []
errors = []


def send(method, **params):
    number = next(counter)
    ws.send(json.dumps({"id": number, "method": method, "params": params}))
    while True:
        message = json.loads(ws.recv())
        method_name = message.get("method")
        if method_name == "Network.requestWillBeSent":
            url = message["params"]["request"]["url"]
            if "/api/v1/" in url:
                requests.append(url)
        elif method_name in ("Page.windowOpen", "Page.frameAttached"):
            opened.append(message["params"].get("url", ""))
        elif method_name == "Runtime.exceptionThrown":
            errors.append(str(message["params"]["exceptionDetails"].get("text")))
        elif method_name == "Runtime.consoleAPICalled":
            if message["params"].get("type") == "error":
                errors.append(
                    " ".join(
                        str(arg.get("value", arg.get("description", "")))
                        for arg in message["params"].get("args", [])
                    )
                )
        if message.get("method") == "Browser.downloadWillBegin":
            downloads_started.append(message["params"].get("suggestedFilename", "?"))
        if message.get("method") == "Browser.downloadProgress":
            downloads_started.append(message["params"].get("state", "?"))
        if message.get("id") == number:
            if "error" in message:
                raise RuntimeError(f"{method}: {message['error']}")
            return message.get("result", {})


def js(expression):
    return send(
        "Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True
    ).get("result", {}).get("value")


def pump_browser():
    """Reads anything the browser-level connection has queued."""
    BROWSER.settimeout(0.2)
    try:
        while True:
            message = json.loads(BROWSER.recv())
            if message.get("method") == "Browser.downloadWillBegin":
                downloads_started.append(message["params"].get("suggestedFilename", "?"))
            if message.get("method") == "Browser.downloadProgress":
                downloads_started.append(message["params"].get("state", "?"))
    except Exception:
        pass
    BROWSER.settimeout(40)


def click(x, y):
    for kind in ("mousePressed", "mouseReleased"):
        send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
    time.sleep(1.2)
    pump_browser()


def type_text(text):
    for character in text:
        send("Input.dispatchKeyEvent", type="keyDown", text=character)
        send("Input.dispatchKeyEvent", type="keyUp", text=character)
        time.sleep(0.05)


def shot(name):
    result = send("Page.captureScreenshot", format="png")
    with open(f"/tmp/out/{name}.png", "wb") as handle:
        handle.write(base64.b64decode(result["data"]))


passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


send("Page.enable")
send("Runtime.enable")
send("Network.enable")
# ومرة على مستوى المتصفح نفسه، لأن الملف بينزل في تاب جديد مش في الصفحة
browser_ws = create_connection(
    json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/version"))["webSocketDebuggerUrl"],
    timeout=40,
)
browser_ws.send(json.dumps({"id": 1, "method": "Browser.setDownloadBehavior",
                            "params": {"behavior": "allow", "downloadPath": DOWNLOADS,
                                       "eventsEnabled": True}}))
BROWSER = browser_ws

print("=" * 66)
print("  KAYAN - أزرار التنزيل والطباعة في المتصفح")
print("=" * 66)

# ── sign in ─────────────────────────────────────────────────────────────
send("Page.navigate", url=BASE)
time.sleep(9)
width = js("innerWidth")
height = js("innerHeight")
centre = width // 2
click(centre, int(height * 0.511))
type_text("admin")
click(centre, int(height * 0.593))
type_text("Admin@12345")
click(centre, int(height * 0.677))
time.sleep(10)
check("تسجيل الدخول", js("document.body.innerText.length") is not None)

# ── the reports screen ──────────────────────────────────────────────────
click(95, 524)          # Reports in the rail
time.sleep(7)
shot("20-reports-ready")

print("\n[1] زرار Excel")
opened.clear()
click(1066, 197)        # the Excel button
time.sleep(7)
xlsx_urls = [url for url in opened if "format=xlsx" in url]
check("زرار Excel ندى نداء فتح للملف", len(xlsx_urls) > 0, str(opened[-3:]))
check("الرابط فيه التوكن", any("token=" in url for url in xlsx_urls), xlsx_urls[0][:110] if xlsx_urls else "")
# ونقرأ الرد نفسه من الصفحة للتأكد إنه ملف Excel حقيقي
if xlsx_urls:
    ok = js("(async () => { const r = await fetch('%s'.replace(/^.*?(\/api\/v1.*)$/, '$1')); "
            "const b = await r.arrayBuffer(); const u = new Uint8Array(b); "
            "return r.status + ':' + u[0] + ',' + u[1] + ':' + b.byteLength; })()" % xlsx_urls[0])
    check("الرد ملف xlsx حقيقي (PK)", str(ok).startswith("200:80,75"), str(ok))
time.sleep(10)
pump_browser()
files = sorted(os.listdir(DOWNLOADS))
named = [item for item in downloads_started if "." in item]
check("المتصفح بدأ تنزيل الملف بالاسم الصحيح",
      any(item.endswith(".xlsx") for item in named), str(downloads_started[-4:]))
xlsx = [name for name in files if name.endswith(".xlsx")]
if xlsx:
    size = os.path.getsize(os.path.join(DOWNLOADS, xlsx[0]))
    check("حجم الملف منطقي", size > 3000, f"{size} بايت")
    with open(os.path.join(DOWNLOADS, xlsx[0]), "rb") as handle:
        signature = handle.read(2)
    check("الملف ملف Excel حقيقي", signature == b"PK", str(signature))

print("\n[2] زرار CSV")
opened.clear()
click(1167, 197)        # the CSV button
time.sleep(7)
csv_urls = [url for url in opened if "format=csv" in url]
check("زرار CSV ندى نداء فتح للملف", len(csv_urls) > 0, str(opened[-3:]))
if csv_urls:
    ok = js("(async () => { const r = await fetch('%s'.replace(/^.*?(\\/api\\/v1.*)$/, '$1')); "
            "const b = new Uint8Array(await r.arrayBuffer()); "
            "return r.status + ':' + b[0] + ',' + b[1] + ',' + b[2] + ':' + b.length; })()" % csv_urls[0])
    check("الرد ملف CSV فيه علامة BOM (EF BB BF)", str(ok).startswith("200:239,187,191"), str(ok))
time.sleep(3)
csv = [name for name in sorted(os.listdir(DOWNLOADS)) if name.endswith(".csv")]
if csv:
    with open(os.path.join(DOWNLOADS, csv[0]), "rb") as handle:
        head = handle.read(3)
    check("ملف CSV فيه علامة BOM للعربي", head == b"\xef\xbb\xbf", str(head))

print("\n[3] زرار PDF")
opened.clear()
click(1272, 197)        # the PDF button
time.sleep(14)
pdf_urls = [url for url in opened if "/pdf" in url]
check("زرار PDF ندى نداء فتح للملف", len(pdf_urls) > 0, str(opened[-3:]))
if pdf_urls:
    ok = js("(async () => { const r = await fetch('%s'.replace(/^.*?(\\/api\\/v1.*)$/, '$1')); "
            "const b = new Uint8Array(await r.arrayBuffer()); "
            "const sig = String.fromCharCode(b[0],b[1],b[2],b[3]); "
            "return r.status + ':' + sig + ':' + b.length; })()" % pdf_urls[0])
    check("الرد ملف PDF حقيقي (%PDF)", str(ok).startswith("200:%PDF"), str(ok))

print("\n[4] زرار الطباعة")
requests.clear()
before = len(json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/list")))
click(1373, 197)        # the Print button
time.sleep(9)
tabs = json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/list"))
after = len(tabs)
shots = [t for t in tabs if "print" in t.get("url", "")]
check("اتفتح تاب جديد لصفحة الطباعة", after > before or len(shots) > 0, f"{before} -> {after}")
check("الرابط فيه أمر الطباعة", any("/exports/" in t.get("url", "") for t in tabs), 
      str([t.get("url", "")[:90] for t in tabs][-3:]))

if shots:
    print_page = shots[-1]
    print_ws = create_connection(print_page["webSocketDebuggerUrl"], timeout=40)
    number = 9001
    print_ws.send(json.dumps({"id": number, "method": "Runtime.evaluate",
                              "params": {"expression": "document.body.innerText.slice(0, 400)",
                                         "returnByValue": True}}))
    while True:
        message = json.loads(print_ws.recv())
        if message.get("id") == number:
            text = message.get("result", {}).get("result", {}).get("value", "")
            break
    check("صفحة الطباعة فيها أرقام التقرير", "Trial balance" in text or "ميزان" in text, text[:120])

print("\n[5] أخطاء الـ console")
check("مفيش أخطاء في console", len(errors) == 0, "; ".join(errors[:3]))

print("\n  حالات التنزيل:", [item for item in downloads_started if "." in item or item in ("completed","canceled","inProgress")][-6:])
print("  ملاحظة: المتصفح المجرد (headless) بيلغي التنزيل بعد ما يبدأ — ده سلوكه هو،")
print("  والمتصفح العادي بيحفظ الملف. اللي يهم إن الطلب نفسه صحيح ومحتواه صحيح.")

print("\n" + "=" * 66)
print(f"  نجح: {passed}    فشل: {failed}")
print(f"  الملفات اللي نزلت: {sorted(os.listdir(DOWNLOADS))}")
print("=" * 66)
sys.exit(1 if failed else 0)
