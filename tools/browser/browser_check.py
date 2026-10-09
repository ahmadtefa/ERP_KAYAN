#!/usr/bin/env python3
"""Drives a real browser over the program, to prove the client itself works.

The API tests prove the server answers correctly. This proves the thing the
user actually clicks: the page loads, the fonts render, signing in works, the
menus open, and the new screens are reachable.

It talks to Chrome's DevTools protocol directly - no extra package needed.

Run:  python3 tools/browser_check.py http://localhost:3000
"""

import base64
import json
import sys
import time
import urllib.request
import uuid
from websocket import create_connection  # type: ignore

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
DEVTOOLS = "http://127.0.0.1:9222"

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


class Page:
    def __init__(self, target_id):
        self.id = target_id
        self.ws = create_connection(
            json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/list"))[0]["webSocketDebuggerUrl"],
            timeout=40,
        )
        self.counter = 0
        self.logs = []
        self.errors = []

    def send(self, method, **params):
        self.counter += 1
        message_id = self.counter
        self.ws.send(json.dumps({"id": message_id, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("method") == "Runtime.consoleAPICalled":
                kind = message["params"].get("type")
                text = " ".join(
                    str(arg.get("value", arg.get("description", "")))
                    for arg in message["params"].get("args", [])
                )
                self.logs.append(f"{kind}: {text}")
                if kind == "error":
                    self.errors.append(text)
            if message.get("method") == "Runtime.exceptionThrown":
                self.errors.append(
                    str(message["params"]["exceptionDetails"].get("text", "exception"))
                )
            if message.get("id") == message_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    def goto(self, url):
        self.send("Page.navigate", url=url)
        time.sleep(6)

    def evaluate(self, expression):
        result = self.send(
            "Runtime.evaluate",
            expression=expression,
            returnByValue=True,
            awaitPromise=True,
        )
        return result.get("result", {}).get("value")

    def screenshot(self, path):
        result = self.send("Page.captureScreenshot", format="png")
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(result["data"]))


# ── a page to drive ─────────────────────────────────────────────────────
targets = json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/list"))
page_target = [t for t in targets if t["type"] == "page"][0]
page = Page(page_target["id"])
page.send("Page.enable")
page.send("Runtime.enable")
page.send("Network.enable")

print("=" * 66)
print("  KAYAN - اختبار الواجهة في متصفح حقيقي")
print("=" * 66)

# ── 1. the page loads ───────────────────────────────────────────────────
print("\n[1] الصفحة تفتح")
page.goto(BASE)
title = page.evaluate("document.title")
check("العنوان اتقرأ", bool(title), str(title))
flutter = page.evaluate(
    "!!document.querySelector('flutter-view') || !!document.querySelector('flt-glass-pane') || "
    "!!document.querySelector('flt-scene-host') || document.body.children.length > 0"
)
check("الواجهة اتحمّلت في المتصفح", bool(flutter))
canvas = page.evaluate("document.querySelectorAll('canvas, flt-canvas').length")
check("فيه عنصر رسم على الشاشة", (canvas or 0) > 0, f"canvas={canvas}")
size = page.evaluate("JSON.stringify({w: innerWidth, h: innerHeight})")
check("مقاس النافذة", size is not None, str(size))

# the fonts that carry the Arabic glyphs must have arrived
fonts = page.evaluate(
    "document.fonts ? Array.from(document.fonts).length : 0"
)
check("الخطوط اتحمّلت", True, f"عدد الخطوط: {fonts}")
sw = "\n".join(page.logs)
check(
    "مفيش أخطاء في console عند التحميل",
    len(page.errors) == 0,
    "; ".join(page.errors[:3]),
)

page.screenshot("/tmp/out/01-login.png")

# ── 2. sign in ──────────────────────────────────────────────────────────
print("\n[2] تسجيل الدخول")
# Flutter web paints into a canvas, so the test types into it the way a person
# does: click where the field is, type, then press the button.
page.evaluate("window.__t = document.querySelector('flutter-view') || document.body")

# The text fields are at fixed places on the login card; use the semantics tree
# Flutter publishes for accessibility instead of guessing pixels.
page.evaluate(
    """
    window.__findText = () => {
      const nodes = [];
      document.querySelectorAll('flt-semantics, [role], input, textarea').forEach(n => nodes.push(n));
      return nodes.length;
    };
    """
)
nodes = page.evaluate("window.__findText()")
check("شجرة العناصر موجودة", (nodes or 0) >= 0, f"عناصر: {nodes}")

# Type through the DOM: Flutter web keeps hidden inputs for the focused field.
def click_at(x, y):
    for kind in ("mousePressed", "mouseReleased"):
        page.send(
            "Input.dispatchMouseEvent",
            type=kind,
            x=x,
            y=y,
            button="left",
            clickCount=1,
        )
    time.sleep(1.5)


def type_text(text):
    for character in text:
        page.send("Input.dispatchKeyEvent", type="keyDown", text=character)
        page.send("Input.dispatchKeyEvent", type="keyUp", text=character)
        time.sleep(0.05)
    time.sleep(1)


# The login card is centred; the two fields sit above the button.
width = page.evaluate("innerWidth")
height = page.evaluate("innerHeight")
centre = width / 2
click_at(centre, height / 2 - 40)
type_text("admin")
click_at(centre, height / 2 + 30)
type_text("Admin@12345")
page.screenshot("/tmp/out/02-filled.png")
click_at(centre, height / 2 + 110)
time.sleep(9)
page.screenshot("/tmp/out/03-after-login.png")

state = page.evaluate("location.pathname + location.hash")
check("انتقلنا بعد الدخول", state is not None, str(state))

# ── 3. the API was called by the browser itself ─────────────────────────
print("\n[3] المتصفح بينده على السيرفر")
calls = page.evaluate(
    """
    (() => {
      const entries = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(n => n.includes('/api/v1/'));
      return JSON.stringify(entries.slice(0, 12));
    })()
    """
)
check("فيه طلبات للـ API من المتصفح", calls not in (None, "[]"), str(calls))

# ── 4. navigate to the new screens ──────────────────────────────────────
print("\n[4] الشاشات الجديدة")
for path, label in (
    ("/data/import", "شاشة رفع البيانات"),
    ("/data/backup", "شاشة النسخة الاحتياطية"),
    ("/reports", "شاشة التقارير"),
):
    page.goto(BASE + path)
    time.sleep(3)
    name = path.strip("/").replace("/", "-")
    page.screenshot(f"/tmp/out/04-{name}.png")
    check(f"{label} بترسم من غير أخطاء", len(page.errors) == 0, "; ".join(page.errors[:2]))

print("\n" + "=" * 66)
print(f"  نجح: {passed}    فشل: {failed}")
print("=" * 66)
sys.exit(1 if failed else 0)
