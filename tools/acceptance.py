#!/usr/bin/env python3
"""KAYAN ERP — full acceptance run.

Drives the API the way the client does: sign in, create master data, raise and
post documents, read the reports, then check that the guard rails hold. Run it
against a freshly seeded database, with the API running.

    python tools/acceptance.py http://localhost:3000/api/v1 60

The second argument is the value of RATE_LIMIT_AUTH_MAX that the API was
started with; the last section fills that budget on purpose and checks that
the door then closes. For a full run start the API with RATE_LIMIT_AUTH_MAX=60,
otherwise the earlier sign-ins eat the default budget of 10 and later checks
report 429 instead of what they are testing.

Every part measures the change it caused rather than absolute totals, so the
three parts can run one after another against the same database. Only the
Python 3 standard library is needed. The exit status is 0 only when every
check passed.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from decimal import Decimal

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000/api/v1"
AUTH_LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 10

PASSED = 0
FAILED = 0
FAILURES = []
ZERO = Decimal("0")


def call(method, path, body=None, token=None):
    """One API call. Returns (status, parsed body) and never raises on 4xx."""
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
    )
    request.add_header("Content-Type", "application/json")
    request.add_header("Origin", "http://localhost:8080")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return error.code, {"raw": raw.decode("utf-8", "replace")}


def check(label, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        FAILURES.append(label)
        print(f"  FAIL  {label}   {detail}")


def section(title):
    print(f"\n[{title}]")


def login(username, password):
    status, body = call("POST", "/auth/login", {"username": username, "password": password})
    if status == 429:
        # A previous run filled this minute's sign-in budget. Wait for the
        # window to roll over rather than reporting a false failure.
        print("        note: the sign-in budget was already spent, waiting a minute for it to reset")
        print(f"        (for a faster run start the API with RATE_LIMIT_AUTH_MAX={AUTH_LIMIT})")
        time.sleep(62)
        status, body = call("POST", "/auth/login", {"username": username, "password": password})
    return status, body


def flatten(nodes):
    out = []
    for node in nodes:
        out.append(node)
        out.extend(flatten(node.get("children") or []))
    return out


def account_id(token, code):
    _, body = call("GET", "/accounting/chart-of-accounts", token=token)
    return next(a["id"] for a in flatten(body["items"]) if a["code"] == code)


def closing_balances(token, date_from="2026-01-01", date_to="2026-12-31"):
    """The closing column of the trial balance, as exact decimals."""
    _, body = call("GET", f"/reports/trial-balance?from={date_from}&to={date_to}", token=token)
    return {row["code"]: Decimal(row["closing"]) for row in body["rows"]}, body["totals"]


def ledger_balance(token, account, date_from="2026-01-01", date_to="2026-12-31"):
    _, body = call("GET", f"/reports/account-ledger/{account}?from={date_from}&to={date_to}", token=token)
    return Decimal(body["closing"]), len(body["movements"]), body


def stock_row(token, item):
    _, rows = call("GET", "/inventory/stock", token=token)
    return next((r for r in rows if r["itemId"] == item), None)


# ══════════════════════════════════════════════════════════ part 1 of 3
def part_one_sales_and_purchasing():
    print("=" * 68)
    print(" 1. a full buying-and-selling cycle, then a reversal")
    print("=" * 68)

    section("sign-in")
    status, body = login("admin", "Admin@12345")
    check("the administrator signs in", status == 201 and "accessToken" in body, f"HTTP {status}")
    token = body["accessToken"]
    check("and their role comes back with them", "ADMIN" in body["user"]["roles"], body["user"].get("roles"))

    section("master data")
    status, body = call("POST", "/parties/customers", {
        "code": "C-001", "nameEn": "Alfa Trading", "nameAr": "شركة ألفا للتجارة",
        "phone": "01000000001", "creditLimit": "50000.00"}, token)
    check("a customer can be created", status == 201, f"HTTP {status} {body}")
    customer = body["id"]

    status, body = call("POST", "/parties/suppliers", {
        "code": "S-001", "nameEn": "Beta Supplies", "nameAr": "مؤسسة بيتا للتوريدات",
        "phone": "01000000002"}, token)
    check("a supplier can be created", status == 201, f"HTTP {status} {body}")
    supplier = body["id"]

    status, body = call("POST", "/inventory/items", {
        "code": "IT-001", "nameEn": "Steel chair", "nameAr": "كرسي معدني",
        "unit": "piece", "salePrice": "150.00", "taxRate": "0"}, token)
    check("an item can be created", status == 201, f"HTTP {status} {body}")
    item = body["id"]

    status, body = call("GET", "/parties/customers", token=token)
    check("the customer list reads back", status == 200 and body["total"] == 1, f"HTTP {status}")
    status, body = call("GET", "/inventory/items", token=token)
    check("the item list reads back", status == 200 and body["total"] == 1, f"HTTP {status}")

    section("purchase: 10 chairs at 100")
    status, body = call("POST", "/purchases/invoices", {
        "invoiceDate": "2026-10-01", "supplierId": supplier, "supplierReference": "SUP-7788",
        "lines": [{"itemId": item, "quantity": "10", "unitPrice": "100.00"}]}, token)
    check("a purchase invoice can be raised", status == 201, f"HTTP {status} {body}")
    purchase = body["id"]
    check("a draft touches no ledger", body.get("journalEntryId") is None, body.get("journalEntryId"))
    check("and totals 1000.0000", body["totalAmount"] == "1000.0000", body.get("totalAmount"))

    status, body = call("POST", f"/purchases/invoices/{purchase}/post", token=token)
    check("it can be posted", status == 201, f"HTTP {status} {body}")

    row = stock_row(token, item)
    check("stock is 10.0000", row and row["quantity"] == "10.0000", row)
    check("valued at 1000.0000", row and row["value"] == "1000.0000", row)
    check("average cost 100.0000", row and row["averageCost"] == "100.0000", row)

    _, ledger = call("GET", f"/inventory/stock/{item}/ledger", token=token)
    check("the item ledger shows one receipt",
          len(ledger["movements"]) == 1 and ledger["movements"][0]["direction"] == "in",
          len(ledger.get("movements", [])))

    section("sale: 4 chairs at 150")
    status, body = call("POST", "/sales/invoices", {
        "invoiceDate": "2026-10-05", "customerId": customer,
        "lines": [{"itemId": item, "quantity": "4", "unitPrice": "150.00"}]}, token)
    check("a sales invoice can be raised", status == 201, f"HTTP {status} {body}")
    sale = body["id"]
    check("it is numbered SI-000001", body["invoiceNumber"] == "SI-000001", body.get("invoiceNumber"))
    check("and totals 600.0000", body["totalAmount"] == "600.0000", body.get("totalAmount"))

    status, body = call("POST", f"/sales/invoices/{sale}/post", token=token)
    check("it can be posted", status == 201, f"HTTP {status} {body}")

    _, invoice = call("GET", f"/sales/invoices/{sale}", token=token)
    check("cost of goods is 400.0000 (4 x 100)", invoice["costOfGoods"] == "400.0000", invoice.get("costOfGoods"))
    check("gross profit is 200.0000", invoice["grossProfit"] == "200.0000", invoice.get("grossProfit"))
    check("the cost is frozen on the line", invoice["lines"][0]["unitCost"] == "100.0000", invoice["lines"][0])

    row = stock_row(token, item)
    check("stock is now 6.0000", row and row["quantity"] == "6.0000", row)
    check("worth 600.0000", row and row["value"] == "600.0000", row)

    section("guard rails")
    status, body = call("POST", "/sales/invoices", {
        "invoiceDate": "2026-10-06", "customerId": customer,
        "lines": [{"itemId": item, "quantity": "99", "unitPrice": "150.00"}]}, token)
    check("a draft may ask for more than the shelf holds", status == 201, f"HTTP {status} {body}")
    oversized = body["id"]
    status, body = call("POST", f"/sales/invoices/{oversized}/post", token=token)
    check("posting it is refused", status == 400, f"HTTP {status}")
    check("and the reason names the shortage", "Not enough stock" in json.dumps(body), json.dumps(body)[:150])

    status, _ = call("POST", f"/sales/invoices/{sale}/post", token=token)
    check("an invoice cannot be posted twice", status == 400, f"HTTP {status}")

    status, _ = call("POST", "/parties/customers", {"code": "C-001", "nameEn": "X", "nameAr": "عميل"}, token)
    check("a duplicate customer code is refused", status == 409, f"HTTP {status}")

    _, body = call("POST", "/inventory/items",
                   {"code": "IT-002", "nameEn": "Consulting hour", "nameAr": "ساعة استشارة",
                    "isStockTracked": False}, token)
    service_item = body["id"]
    status, body = call("POST", "/purchases/invoices", {
        "invoiceDate": "2026-10-01", "supplierId": supplier,
        "lines": [{"itemId": service_item, "quantity": "1", "unitPrice": "100.00"}]}, token)
    check("a service line may be drafted", status == 201, f"HTTP {status} {body}")
    status, body = call("POST", f"/purchases/invoices/{body['id']}/post", token=token)
    check("but it cannot be posted to stock", status == 400, f"HTTP {status}")
    check("with a clear reason", "not stock-tracked" in json.dumps(body), json.dumps(body)[:150])

    section("reports")
    closing, totals = closing_balances(token)
    check("the trial balance balances", totals["difference"] == "0.0000", totals)
    check("receivable is 600.0000", closing.get("1103") == Decimal("600"), closing.get("1103"))
    check("inventory is 600.0000", closing.get("1104") == Decimal("600"), closing.get("1104"))
    check("payable is -1000.0000", closing.get("2101") == Decimal("-1000"), closing.get("2101"))
    check("revenue is -600.0000", closing.get("4101") == Decimal("-600"), closing.get("4101"))
    check("cost of sales is 400.0000", closing.get("5101") == Decimal("400"), closing.get("5101"))

    _, pnl = call("GET", "/reports/profit-and-loss?from=2026-01-01&to=2026-12-31", token=token)
    check("revenue 600 / expenses 400 / profit 200",
          pnl["totals"]["revenue"] == "600.0000"
          and pnl["totals"]["expenses"] == "400.0000"
          and pnl["totals"]["netProfit"] == "200.0000", pnl["totals"])

    _, balances = call("GET", "/reports/customer-balances", token=token)
    mine = next((r for r in balances["rows"] if r["customerId"] == customer), None)
    check("the customer owes 600.0000", mine and mine["balance"] == "600.0000", balances["rows"])
    _, balances = call("GET", "/reports/supplier-balances", token=token)
    mine = next((r for r in balances["rows"] if r["supplierId"] == supplier), None)
    check("we owe the supplier 1000.0000", mine and mine["balance"] == "1000.0000", balances["rows"])
    _, balances = call("GET", "/reports/customer-balances?asOf=2026-01-01", token=token)
    check("as at a date before the invoice, nothing was owed yet",
          not any(r["customerId"] == customer for r in balances["rows"]), balances["rows"])

    section("reversal")
    status, body = call("POST", f"/sales/invoices/{sale}/reverse", token=token)
    check("the sale can be reversed", status == 201, f"HTTP {status} {body}")
    check("and reads as reversed", body["status"] == "reversed", body.get("status"))

    row = stock_row(token, item)
    check("the stock came back to 10.0000", row and row["quantity"] == "10.0000", row)

    closing, totals = closing_balances(token)
    check("the trial balance still balances", totals["difference"] == "0.0000", totals)
    check("receivable is back to 0.0000", closing.get("1103") == ZERO, closing.get("1103"))
    check("revenue is back to 0.0000", closing.get("4101") == ZERO, closing.get("4101"))
    check("inventory is back to 1000.0000", closing.get("1104") == Decimal("1000"), closing.get("1104"))
    check("payable is untouched at -1000.0000", closing.get("2101") == Decimal("-1000"), closing.get("2101"))
    check("cost of sales is back to 0.0000", closing.get("5101") == ZERO, closing.get("5101"))

    status, _ = call("POST", f"/sales/invoices/{sale}/reverse", token=token)
    check("and it cannot be reversed twice", status == 400, f"HTTP {status}")


# ══════════════════════════════════════════════════════════ part 2 of 3
def part_two_tax_and_average_cost():
    print("\n" + "=" * 68)
    print(" 2. VAT, the weighted average cost, and the activation rules")
    print("=" * 68)

    token = login("admin", "Admin@12345")[1]["accessToken"]

    base, _ = closing_balances(token)
    inventory_before, movements_before, _ = ledger_balance(token, account_id(token, "1104"))
    _, sales_before = call("GET", "/sales/invoices?status=posted", token=token)
    _, purchases_before = call("GET", "/purchases/invoices?status=draft", token=token)

    def moved(code):
        after, _ = closing_balances(token)
        return after.get(code, ZERO) - base.get(code, ZERO)

    section("VAT at 14%")
    _, body = call("POST", "/inventory/items", {
        "code": "IT-A", "nameEn": "Laptop", "nameAr": "لابتوب",
        "unit": "piece", "salePrice": "250.00", "taxRate": "14"}, token)
    item = body["id"]
    check("an item carries its own tax rate", body.get("taxRate") == "14.0000", body.get("taxRate"))
    _, body = call("POST", "/parties/suppliers",
                   {"code": "S-A", "nameEn": "Tech Import", "nameAr": "تك إمبورت"}, token)
    supplier = body["id"]
    _, body = call("POST", "/parties/customers", {"code": "C-A", "nameEn": "Retail Co", "nameAr": "ريتيل"}, token)
    customer = body["id"]

    status, body = call("POST", "/purchases/invoices", {
        "invoiceDate": "2026-10-01", "supplierId": supplier,
        "lines": [{"itemId": item, "quantity": "10", "unitPrice": "100.00"}]}, token)
    check("sub-total is 1000.0000", body["subTotal"] == "1000.0000", body.get("subTotal"))
    check("tax is 140.0000", body["taxAmount"] == "140.0000", body.get("taxAmount"))
    check("total is 1140.0000", body["totalAmount"] == "1140.0000", body.get("totalAmount"))
    call("POST", f"/purchases/invoices/{body['id']}/post", token=token)

    row = stock_row(token, item)
    check("stock is valued without the tax: 1000.0000", row and row["value"] == "1000.0000", row)
    check("inventory rose by 1000.0000", moved("1104") == Decimal("1000"), moved("1104"))
    check("input VAT rose by 140.0000", moved("1105") == Decimal("140"), moved("1105"))
    check("payable rose by 1140.0000", moved("2101") == Decimal("-1140"), moved("2101"))

    section("weighted average cost")
    _, body = call("POST", "/purchases/invoices", {
        "invoiceDate": "2026-10-03", "supplierId": supplier,
        "lines": [{"itemId": item, "quantity": "10", "unitPrice": "200.00"}]}, token)
    call("POST", f"/purchases/invoices/{body['id']}/post", token=token)
    row = stock_row(token, item)
    check("quantity is 20.0000", row and row["quantity"] == "20.0000", row)
    check("value is 3000.0000", row and row["value"] == "3000.0000", row)
    check("average cost 150.0000 ((1000 + 2000) / 20)", row and row["averageCost"] == "150.0000", row)

    section("selling at that average, with tax")
    status, body = call("POST", "/sales/invoices", {
        "invoiceDate": "2026-10-05", "customerId": customer,
        "lines": [{"itemId": item, "quantity": "4", "unitPrice": "250.00"}]}, token)
    sale = body["id"]
    check("total is 1140.0000 (1000 + 140 VAT)", body["totalAmount"] == "1140.0000", body.get("totalAmount"))
    call("POST", f"/sales/invoices/{sale}/post", token=token)
    _, invoice = call("GET", f"/sales/invoices/{sale}", token=token)
    check("cost of goods is 600.0000 (4 x 150)", invoice["costOfGoods"] == "600.0000", invoice.get("costOfGoods"))
    check("gross profit is 400.0000", invoice["grossProfit"] == "400.0000", invoice.get("grossProfit"))
    row = stock_row(token, item)
    check("16.0000 left", row and row["quantity"] == "16.0000", row)
    check("worth 2400.0000", row and row["value"] == "2400.0000", row)

    section("the ledger after both movements")
    _, totals = closing_balances(token)
    check("the trial balance still balances", totals["difference"] == "0.0000", totals)
    check("receivable rose by 1140.0000", moved("1103") == Decimal("1140"), moved("1103"))
    check("inventory rose by 2400.0000", moved("1104") == Decimal("2400"), moved("1104"))
    check("input VAT rose by 420.0000 (140 + 280)", moved("1105") == Decimal("420"), moved("1105"))
    check("payable fell by 3420.0000 (1140 + 2280)", moved("2101") == Decimal("-3420"), moved("2101"))
    check("output VAT fell by 140.0000", moved("2103") == Decimal("-140"), moved("2103"))
    check("revenue fell by 1000.0000", moved("4101") == Decimal("-1000"), moved("4101"))
    check("cost of sales rose by 600.0000", moved("5101") == Decimal("600"), moved("5101"))

    _, pnl = call("GET", "/reports/profit-and-loss?from=2026-01-01&to=2026-12-31", token=token)
    check("revenue 1000 / expenses 600 / profit 400",
          pnl["totals"]["revenue"] == "1000.0000"
          and pnl["totals"]["expenses"] == "600.0000"
          and pnl["totals"]["netProfit"] == "400.0000", pnl["totals"])

    status, _ = call("GET", "/reports/account-ledger/00000000-0000-0000-0000-000000000000", token=token)
    check("a missing account is a 404", status == 404, f"HTTP {status}")

    _, item_ledger = call("GET", f"/inventory/stock/{item}/ledger", token=token)
    check("the item ledger shows its three movements", len(item_ledger["movements"]) == 3,
          len(item_ledger.get("movements", [])))

    closing_after, movements_after, ledger = ledger_balance(token, account_id(token, "1104"))
    check("the inventory account gained three movements", movements_after == movements_before + 3,
          f"{movements_before} then {movements_after}")
    check("its closing is 2400.0000 above where we started",
          closing_after - inventory_before == Decimal("2400"), closing_after - inventory_before)
    check("the running balance ends at the closing balance",
          Decimal(ledger["movements"][-1]["runningBalance"]) == closing_after, ledger["movements"][-1])

    section("the activation rules")
    status, _ = call("POST", f"/inventory/items/{item}/deactivate", token=token)
    check("an item holding stock cannot be retired", status == 400, f"HTTP {status}")
    _, body = call("GET", f"/inventory/items/{item}", token=token)
    check("and it stays active", body["isActive"] is True, body.get("isActive"))

    _, body = call("POST", "/parties/customers", {"code": "C-B", "nameEn": "Temporary", "nameAr": "مؤقت"}, token)
    status, _ = call("POST", f"/parties/customers/{body['id']}/deactivate", token=token)
    check("a customer with no history can be retired", status in (200, 201), f"HTTP {status}")

    status, body = call("POST", f"/parties/customers/{customer}/deactivate", token=token)
    check("a customer with history can be retired too", status == 201 and body["isActive"] is False,
          f"HTTP {status} {body}")
    status, body = call("POST", "/sales/invoices", {
        "invoiceDate": "2026-10-06", "customerId": customer,
        "lines": [{"itemId": item, "quantity": "1", "unitPrice": "250.00"}]}, token)
    check("but cannot be invoiced meanwhile",
          status == 400 and "inactive" in json.dumps(body).lower(), f"HTTP {status} {json.dumps(body)[:120]}")
    status, body = call("PATCH", f"/parties/customers/{customer}", {"isActive": True}, token)
    check("and can be brought back", status == 200 and body["isActive"] is True, f"HTTP {status}")
    _, balances = call("GET", "/reports/customer-balances", token=token)
    mine = next((r for r in balances["rows"] if r["customerId"] == customer), None)
    check("its balance stayed on the reports", mine and mine["balance"] == "1140.0000", balances["rows"])

    section("filters")
    _, body = call("GET", "/sales/invoices?status=posted", token=token)
    check("one more invoice now reads as posted", body["total"] == sales_before["total"] + 1,
          f"{sales_before['total']} then {body['total']}")
    _, body = call("GET", "/purchases/invoices?status=draft", token=token)
    check("the drafts we started with are untouched", body["total"] == purchases_before["total"],
          f"{purchases_before['total']} then {body['total']}")


# ══════════════════════════════════════════════════════════ part 3 of 3
def part_three_users_roles_periods_and_limits():
    print("\n" + "=" * 68)
    print(" 3. users, roles, fiscal periods and the request limit")
    print("=" * 68)

    token = login("admin", "Admin@12345")[1]["accessToken"]

    section("users")
    status, body = call("GET", "/admin/users", token=token)
    check("the user list reads", status == 200 and len(body["items"]) == 1, f"HTTP {status} {body}")
    check("no password hash is ever returned", "passwordHash" not in json.dumps(body), "leak")
    admin_id = body["items"][0]["id"]
    check("the administrator holds the ADMIN role", body["items"][0]["roles"][0]["code"] == "ADMIN",
          body["items"][0]["roles"])
    check("their last sign-in is recorded", body["items"][0]["lastLoginAt"] is not None, body["items"][0])

    _, body = call("GET", "/admin/roles", token=token)
    roles = {r["code"]: r for r in body["items"]}
    check("ADMIN is a system role holding everything",
          roles["ADMIN"]["isSystem"] and len(roles["ADMIN"]["permissions"]) >= 26,
          len(roles["ADMIN"]["permissions"]))
    check("ACCOUNTANT may not manage users",
          "admin.users.manage" not in roles["ACCOUNTANT"]["permissions"], "")
    check("ACCOUNTANT may read the ledger periods",
          "accounting.periods.read" in roles["ACCOUNTANT"]["permissions"], "")
    check("ACCOUNTANT may read invoices but not raise them",
          "sales.invoices.read" in roles["ACCOUNTANT"]["permissions"]
          and "sales.invoices.create" not in roles["ACCOUNTANT"]["permissions"], "")
    accountant_role = roles["ACCOUNTANT"]["id"]

    status, body = call("POST", "/admin/users", {
        "username": "sara", "fullNameEn": "Sara Hassan", "fullNameAr": "سارة حسن",
        "password": "InitialPass123", "roleIds": [accountant_role]}, token)
    check("a user can be created", status == 201, f"HTTP {status} {body}")
    sara = body["id"]
    check("a new user is never a super administrator", body["isSuperAdmin"] is False, body["isSuperAdmin"])

    status, _ = call("POST", "/admin/users",
                     {"username": "sara", "fullNameEn": "X", "fullNameAr": "ي",
                      "password": "InitialPass123"}, token)
    check("a duplicate username is refused", status == 409, f"HTTP {status}")
    status, _ = call("POST", "/admin/users",
                     {"username": "shorty", "fullNameEn": "X", "fullNameAr": "ي",
                      "password": "12345678"}, token)
    check("a short password is refused", status == 400, f"HTTP {status}")
    status, _ = call("POST", "/admin/users",
                     {"username": "admin", "fullNameEn": "X", "fullNameAr": "ي",
                      "password": "InitialPass123"}, token)
    check("the administrator's username is reserved", status == 409, f"HTTP {status}")

    section("a new user signs in with exactly their own rights")
    status, sara_session = login("sara", "InitialPass123")
    check("Sara signs in", status == 201 and "accessToken" in sara_session, f"HTTP {status}")
    sara_token = sara_session["accessToken"]
    check("her permissions came through",
          "sales.invoices.read" in sara_session["user"]["permissions"],
          sara_session["user"]["permissions"][-5:])
    check("she may not manage users", "admin.users.manage" not in sara_session["user"]["permissions"], "")
    status, _ = call("GET", "/admin/users", token=sara_token)
    check("the user list is closed to her (403)", status == 403, f"HTTP {status}")
    status, _ = call("GET", "/inventory/items", token=sara_token)
    check("but the items are open to her", status == 200, f"HTTP {status}")

    section("fiscal periods")
    status, body = call("GET", "/accounting/fiscal-periods", token=token)
    check("this year's period exists", status == 200 and len(body["items"]) == 1, f"HTTP {status} {body}")
    check("it is open and named for the year",
          body["items"][0]["status"] == "open" and body["items"][0]["code"].startswith("FY"),
          body["items"][0])

    status, body = call("POST", "/accounting/fiscal-periods", {
        "code": "FY2025", "nameEn": "Fiscal year 2025", "nameAr": "السنة المالية 2025",
        "startDate": "2025-01-01", "endDate": "2025-12-31"}, token)
    check("last year's period can be added", status == 201, f"HTTP {status} {body}")
    last_year = body["id"]

    status, _ = call("POST", "/accounting/fiscal-periods", {
        "code": "FY2027", "nameEn": "Fiscal year 2027", "nameAr": "السنة المالية 2027",
        "startDate": "2027-01-01", "endDate": "2027-12-31"}, token)
    check("next year's period can be created", status == 201, f"HTTP {status}")
    status, _ = call("POST", "/accounting/fiscal-periods", {
        "code": "OVERLAP", "nameEn": "Overlapping", "nameAr": "متداخلة",
        "startDate": "2027-06-01", "endDate": "2027-07-31"}, token)
    check("an overlapping period is refused", status == 400, f"HTTP {status}")
    status, _ = call("POST", "/accounting/fiscal-periods", {
        "code": "BACKWARDS", "nameEn": "Backwards", "nameAr": "مقلوبة",
        "startDate": "2028-12-31", "endDate": "2028-01-01"}, token)
    check("an end date before the start is refused", status == 400, f"HTTP {status}")

    section("closing a year stops anything being written into it")
    _, body = call("POST", "/parties/suppliers",
                   {"code": "S-FP", "nameEn": "Period Supplies", "nameAr": "مورد الفترة"}, token)
    supplier = body["id"]
    _, body = call("POST", "/parties/customers",
                   {"code": "C-FP", "nameEn": "Period Customer", "nameAr": "عميل الفترة"}, token)
    customer = body["id"]
    _, body = call("POST", "/inventory/items", {"code": "IT-FP", "nameEn": "Widget", "nameAr": "قطعة"}, token)
    item = body["id"]

    _, body = call("POST", "/purchases/invoices", {
        "invoiceDate": "2025-06-01", "supplierId": supplier,
        "lines": [{"itemId": item, "quantity": "5", "unitPrice": "100"}]}, token)
    draft_2025 = body["id"]
    status, body = call("POST", f"/accounting/fiscal-periods/{last_year}/close", token=token)
    check("closing while a draft still falls inside is refused",
          status == 400 and "draft" in json.dumps(body).lower(), f"HTTP {status} {json.dumps(body)[:150]}")
    status, _ = call("POST", f"/purchases/invoices/{draft_2025}/post", token=token)
    check("the draft posts while that year is still open", status == 201, f"HTTP {status}")

    status, body = call("POST", f"/accounting/fiscal-periods/{last_year}/close", token=token)
    check("with no drafts inside, closing succeeds",
          status == 201 and body["isClosed"] is True, f"HTTP {status} {body}")
    status, _ = call("POST", f"/accounting/fiscal-periods/{last_year}/close", token=token)
    check("closing twice is refused", status == 400, f"HTTP {status}")
    status, _ = call("PATCH", f"/accounting/fiscal-periods/{last_year}", {"nameEn": "Renamed"}, token)
    check("a closed period cannot be edited", status == 400, f"HTTP {status}")

    _, body = call("POST", "/sales/invoices", {
        "invoiceDate": "2025-06-05", "customerId": customer,
        "lines": [{"itemId": item, "quantity": "1", "unitPrice": "200"}]}, token)
    status, body = call("POST", f"/sales/invoices/{body['id']}/post", token=token)
    check("an invoice cannot be posted into a closed year",
          status == 400 and "closed" in json.dumps(body).lower(), f"HTTP {status} {json.dumps(body)[:150]}")

    cash = account_id(token, "1101")
    bank = account_id(token, "1102")
    status, body = call("POST", "/accounting/journal-entries", {
        "entryDate": "2025-06-10", "description": "Dated inside the closed year",
        "lines": [{"accountId": cash, "debit": "100"}, {"accountId": bank, "credit": "100"}]}, token)
    check("a manual entry may still be drafted", status == 201, f"HTTP {status} {body}")
    entry = body["id"]
    status, body = call("POST", f"/accounting/journal-entries/{entry}/post", token=token)
    check("but a manual entry cannot be posted into a closed year either",
          status == 400 and "closed" in json.dumps(body).lower(), f"HTTP {status} {json.dumps(body)[:150]}")

    _, body = call("GET", "/accounting/fiscal-periods", token=token)
    this_year = next(p for p in body["items"] if p["code"].startswith("FY2026"))
    status, body = call("POST", f"/accounting/fiscal-periods/{this_year['id']}/close", token=token)
    check("this year still refuses to close while a draft is outstanding",
          status == 400 and "draft" in json.dumps(body).lower(), f"HTTP {status} {json.dumps(body)[:150]}")

    section("the next year still takes work")
    _, body = call("POST", "/purchases/invoices", {
        "invoiceDate": "2027-02-01", "supplierId": supplier,
        "lines": [{"itemId": item, "quantity": "3", "unitPrice": "100"}]}, token)
    status, _ = call("POST", f"/purchases/invoices/{body['id']}/post", token=token)
    check("posting into the open 2027 period works", status == 201, f"HTTP {status}")

    section("roles")
    status, body = call("POST", "/admin/roles", {
        "code": "VIEWER", "nameEn": "Viewer", "nameAr": "مُشاهد",
        "permissions": ["inventory.items.read", "inventory.stock.read", "reports.read"]}, token)
    check("a role can be created", status == 201, f"HTTP {status} {body}")
    viewer_role = body["id"]
    check("it grants exactly what was asked",
          sorted(body["permissions"]) == sorted(["inventory.items.read", "inventory.stock.read", "reports.read"]),
          body["permissions"])

    status, body = call("POST", "/admin/roles",
                        {"code": "BROKEN", "nameEn": "Broken", "nameAr": "مكسور",
                         "permissions": ["nope.not.real"]}, token)
    check("an unknown permission is refused, not silently dropped",
          status == 400 and "nope.not.real" in json.dumps(body), f"HTTP {status} {json.dumps(body)[:150]}")

    status, body = call("POST", f"/admin/roles/{viewer_role}/permissions",
                        {"permissions": ["inventory.items.read"]}, token)
    check("the permission set can be replaced",
          status == 201 and body["permissions"] == ["inventory.items.read"], body["permissions"])

    _, body = call("POST", "/admin/users", {
        "username": "viewer1", "fullNameEn": "Ali", "fullNameAr": "علي",
        "password": "ViewerPass123", "roleIds": [viewer_role]}, token)
    _, body = login("viewer1", "ViewerPass123")
    viewer_token = body["accessToken"]
    status, _ = call("GET", "/inventory/items", token=viewer_token)
    check("the viewer can read the items", status == 200, f"HTTP {status}")
    status, _ = call("POST", "/inventory/items", {"code": "X", "nameEn": "X", "nameAr": "س"}, token=viewer_token)
    check("but cannot create one (403)", status == 403, f"HTTP {status}")

    status, body = call("DELETE", f"/admin/roles/{viewer_role}", token=token)
    check("a role a user still holds cannot be removed",
          status == 400 and "still hold" in json.dumps(body), f"HTTP {status} {json.dumps(body)[:150]}")
    status, _ = call("DELETE", f"/admin/roles/{roles['ADMIN']['id']}", token=token)
    check("a system role cannot be removed", status == 400, f"HTTP {status}")

    section("switching a user off")
    status, body = call("POST", f"/admin/users/{sara}/deactivate", token=token)
    check("a user can be switched off", status == 201 and body["isActive"] is False, f"HTTP {status} {body}")
    status, _ = login("sara", "InitialPass123")
    check("and can no longer sign in", status == 401, f"HTTP {status}")
    status, _ = call("POST", f"/admin/users/{admin_id}/deactivate", token=token)
    check("you cannot switch yourself off", status == 400, f"HTTP {status}")
    status, body = call("PATCH", f"/admin/users/{sara}", {"isActive": True}, token=token)
    check("and can be switched back on", status == 200 and body["isActive"] is True, f"HTTP {status}")

    section("a password change ends the old sessions")
    _, session = login("sara", "InitialPass123")
    old_refresh = session["refreshToken"]
    status, _ = call("GET", "/inventory/items", token=session["accessToken"])
    check("her session works beforehand", status == 200, f"HTTP {status}")
    status, body = call("POST", f"/admin/users/{sara}/password", {"password": "BrandNewPass456"}, token)
    check("the password can be changed", status == 201 and body["sessionsRevoked"] is True, f"HTTP {status} {body}")
    status, _ = call("POST", "/auth/refresh", {"refreshToken": old_refresh})
    check("the old refresh token is dead", status == 401, f"HTTP {status}")
    status, _ = login("sara", "InitialPass123")
    check("the old password no longer works", status == 401, f"HTTP {status}")
    status, _ = login("sara", "BrandNewPass456")
    check("the new one does", status == 201, f"HTTP {status}")

    section("the request limit")
    status, _ = call("GET", "/health")
    check("health answers", status == 200, f"HTTP {status}")
    attempts = []
    for _ in range(AUTH_LIMIT + 5):
        status, _ = call("POST", "/auth/login", {"username": "nobody", "password": "wrong"})
        attempts.append(status)
    check(f"after {AUTH_LIMIT} sign-in attempts the door closes", 429 in attempts,
          f"statuses: {sorted(set(attempts))}")
    check("and it stays closed for every attempt after that", attempts[-5:] == [429] * 5, attempts[-5:])
    status, _ = call("GET", "/health")
    check("other endpoints are unaffected", status == 200, f"HTTP {status}")

    section("the audit trail")
    status, body = call("GET", "/admin/audit-logs?pageSize=200", token=token)
    check("the trail reads", status == 200 and body.get("total", 0) > 0, f"HTTP {status} {body}")
    check("it never carries a password hash", "passwordHash" not in json.dumps(body), "leak")
    actions = {row["action"] for row in body.get("items", [])}
    check("it remembers who closed the year", "fiscal_period.close" in actions, sorted(actions)[:12])
    check("and it remembers the documents that were posted",
          any(a in actions for a in ("POST", "post")), sorted(actions)[:12])
    status, body = call("GET", "/admin/audit-logs?action=fiscal_period.close", token=token)
    check("it filters by action", status == 200 and body["total"] >= 1, f"HTTP {status} {body.get('total')}")
    status, body = call("GET", "/admin/audit-logs?entity=journal_entries", token=token)
    check("and by entity", status == 200 and body["total"] >= 1, f"HTTP {status} {body.get('total')}")
    status, _ = call("GET", "/admin/audit-logs", token=sara_token)
    check("a user without the permission cannot read it (403)", status == 403, f"HTTP {status}")


if __name__ == "__main__":
    print(f"KAYAN ERP — acceptance run against {BASE}")
    print("Run this against a freshly seeded database.\n")
    part_one_sales_and_purchasing()
    part_two_tax_and_average_cost()
    part_three_users_roles_periods_and_limits()
    print("\n" + "=" * 68)
    print(f"  {PASSED} passed, {FAILED} failed")
    if FAILURES:
        print("  failures:")
        for name in FAILURES:
            print(f"    - {name}")
    print("=" * 68)
    sys.exit(0 if FAILED == 0 else 1)
