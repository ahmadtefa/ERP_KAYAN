#!/usr/bin/env python3
"""Opens the program in the running Chromium and saves screenshots, so a person
can read the real positions of the buttons after a font or layout change.

Usage:
    python3 shot_now.py reports [menu]
"""
import base64
import json
import sys
import time
import urllib.request

from websocket import create_connection

BASE = "http://localhost:3000"
DEVTOOLS = "http://127.0.0.1:9222"
OUT = "/tmp/out"
_ws = None
_id = 0


def send(method, **params):
    global _id
    _id += 1
    _ws.send(json.dumps({"id": _id, "method": method, "params": params}))
    while True:
        message = json.loads(_ws.recv())
        if message.get("id") == _id:
            return message


def js(expression):
    result = send("Runtime.evaluate", expression=expression, returnByValue=True,
                  awaitPromise=True)
    return result.get("result", {}).get("result", {}).get("value")


def click(x, y):
    for kind in ("mousePressed", "mouseReleased"):
        send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left",
             clickCount=1)


def type_text(text):
    for char in text:
        send("Input.dispatchKeyEvent", type="char", text=char)


def shot(name):
    data = send("Page.captureScreenshot")["result"]["data"]
    with open(f"{OUT}/{name}.png", "wb") as handle:
        handle.write(base64.b64decode(data))
    print(f"  saved {OUT}/{name}.png")


def main():
    global _ws
    target = None
    for _ in range(30):
        pages = json.load(urllib.request.urlopen(f"{DEVTOOLS}/json"))
        pages = [p for p in pages if p.get("type") == "page" and "devtools" not in p.get("url", "")]
        mine = [p for p in pages if p.get("url", "").startswith(BASE)]
        if mine:
            target = mine[0]
        elif pages:
            target = pages[0]
        if target:
            break
        time.sleep(1)
    if target is None:
        raise SystemExit("  no browser tab to talk to")
    _ws = create_connection(target["webSocketDebuggerUrl"], timeout=40)
    send("Page.enable")
    send("Runtime.enable")

    send("Page.navigate", url=BASE)
    time.sleep(9)
    width = js("innerWidth")
    height = js("innerHeight")
    print(f"  innerWidth={width} innerHeight={height}")
    centre = width // 2
    click(centre, int(height * 0.511))
    type_text("admin")
    click(centre, int(height * 0.593))
    type_text("Admin@12345")
    click(centre, int(height * 0.677))
    time.sleep(10)
    shot("m0-after-login")

    what = sys.argv[1] if len(sys.argv) > 1 else "reports"
    if what == "reports":
        click(95, 524)
        time.sleep(8)
        shot("m1-reports")
        if "menu" in sys.argv:
            click(1325, 98)          # the download button on the right of a list
            time.sleep(3)
            shot("m2-menu")
    elif what == "items":
        click(95, 310)
        time.sleep(8)
        shot("m1-items")
        if "menu" in sys.argv:
            click(1325, 98)
            time.sleep(3)
            shot("m2-menu")
    print("  done")


if __name__ == "__main__":
    main()
