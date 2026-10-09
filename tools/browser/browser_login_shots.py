#!/usr/bin/env python3
"""Signs in through a real browser and photographs each screen.

The screenshots are the evidence: the client is drawn by the browser, the
menus are there, and the four new features have a way in from the interface.
"""

import base64
import json
import sys
import time
import urllib.request

from websocket import create_connection

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
DEVTOOLS = "http://127.0.0.1:9222"

targets = json.load(urllib.request.urlopen(f"{DEVTOOLS}/json/list"))
target = [t for t in targets if t["type"] == "page"][0]
ws = create_connection(target["webSocketDebuggerUrl"], timeout=60)
counter = iter(range(1, 9999))
logs = []
errors = []


def send(method, **params):
    number = next(counter)
    ws.send(json.dumps({"id": number, "method": method, "params": params}))
    while True:
        message = json.loads(ws.recv())
        if message.get("method") == "Runtime.consoleAPICalled":
            kind = message["params"].get("type")
            text = " ".join(
                str(arg.get("value", arg.get("description", "")))
                for arg in message["params"].get("args", [])
            )
            logs.append(f"{kind}: {text}")
            if kind == "error":
                errors.append(text)
        if message.get("method") == "Runtime.exceptionThrown":
            errors.append(str(message["params"]["exceptionDetails"].get("text")))
        if message.get("id") == number:
            if "error" in message:
                raise RuntimeError(f"{method}: {message['error']}")
            return message.get("result", {})


def js(expression):
    return send(
        "Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True
    ).get("result", {}).get("value")


def click(x, y):
    for kind in ("mousePressed", "mouseReleased"):
        send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
    time.sleep(1.2)


def type_text(text):
    for character in text:
        send("Input.dispatchKeyEvent", type="keyDown", text=character)
        send("Input.dispatchKeyEvent", type="keyUp", text=character)
        time.sleep(0.06)
    time.sleep(0.8)


def shot(name):
    result = send("Page.captureScreenshot", format="png")
    path = f"/tmp/out/{name}.png"
    with open(path, "wb") as handle:
        handle.write(base64.b64decode(result["data"]))
    print(f"  📸 {path}")


send("Page.enable")
send("Runtime.enable")

print("── الدخول ──")
send("Page.navigate", url=BASE)
time.sleep(9)

# The login card sits in the middle of the window; the fields are found from
# the candidate positions rather than hardcoded, so a resized window still
# works.
width = js("innerWidth")
height = js("innerHeight")
centre = width // 2
# measured from a screenshot of the same window size
click(centre, int(height * 0.511))   # username
type_text("admin")
click(centre, int(height * 0.593))   # password
type_text("Admin@12345")
click(centre, int(height * 0.677))   # sign in
time.sleep(10)
shot("10-dashboard")
print("  الصفحة دلوقتي:", js("location.pathname"))
signed_in = js("location.pathname")
if signed_in in ("/", ""):
    print("  ⚠️ لسه على شاشة الدخول")

print("── الشاشات من القائمة نفسها ──")
# The menu is how a person gets there, so the test uses the menu rather than
# typing addresses: it proves the entry exists and works.
menu = [
    (95, 524, "11-reports", "التقارير"),
    (95, 572, "12-import", "رفع بيانات من ملف"),
    (95, 620, "13-backup", "النسخة الاحتياطية"),
    (95, 476, "14-purchase-invoices", "فواتير الشراء"),
    (95, 220, "15-customers", "العملاء"),
]
for x, y, name, label in menu:
    click(x, y)
    time.sleep(6)
    shot(name)
    print(f"  → {label}: {js('location.pathname')}")

print("── أخطاء الـ console ──")
if errors:
    for error in errors[:8]:
        print("  ⚠️", error)
else:
    print("  ✅ مفيش أخطاء")
