#!/usr/bin/env python3
"""Checks the four new features end to end against a running API.

  1. printing            - exports/:report/print returns a print-ready page
  2. downloading reports - exports/:report/download returns a real xlsx / csv
  3. uploading files     - import templates download, dry run, real run
  4. backup & restore    - download a backup, restore it, prove the data round-trips

Run:  python3 tools/test_features.py http://localhost:3000/api/v1
"""

import io
import json
import sys
import urllib.error
import urllib.request
import uuid
import zipfile

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000/api/v1"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "Admin@12345"

passed = 0
failed = 0
notes = []


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")
        notes.append(f"{name}: {detail}")


def request(method, path, token=None, body=None, raw=False):
    """Returns (status, payload, headers). payload is bytes when raw."""
    url = path if path.startswith("http") else BASE + path
    data = None
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            content = response.read()
            status = response.status
            head = dict(response.headers)
    except urllib.error.HTTPError as error:
        content = error.read()
        status = error.code
        head = dict(error.headers)
    if raw:
        return status, content, head
    try:
        return status, json.loads(content.decode("utf-8")), head
    except Exception:
        return status, content, head


def upload(path, token, filename, content, fields=None):
    """A multipart/form-data POST, written out by hand so the test needs no
    third-party package."""
    boundary = "----kayan" + uuid.uuid4().hex
    parts = []
    for key, value in (fields or {}).items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
        )
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n".encode()
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    payload = b"".join(parts)

    req = urllib.request.Request(
        BASE + path,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(payload)),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode("utf-8"))
        except Exception:
            return error.code, {}


def is_xlsx(content):
    """A real xlsx is a zip whose first two bytes are PK."""
    if content[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = archive.namelist()
            return "xl/workbook.xml" in names and any(
                n.startswith("xl/worksheets/") for n in names
            )
    except Exception:
        return False


print("=" * 66)
print("  KAYAN - اختبار الخصائص الأربع الجديدة")
print("=" * 66)

# ─────────────────────────────── login
status, login, _ = request("POST", "/auth/login", body={"username": USER, "password": PASSWORD})
if status not in (200, 201):
    print(f"  تعذر الدخول ({status}) - لا يمكن إكمال الاختبار")
    sys.exit(1)
token = login["accessToken"]
if not token:
    print("  لا يوجد توكن")
    sys.exit(1)
print("\n[0] الدخول  PASS")

# ─────────────────────────────── some data so the reports have rows
print("\n[1] تجهيز بيانات للتقارير")
stamp = uuid.uuid4().hex[:6]
customers = []
for index, name in enumerate(["عميل اختبار ألف", "عميل اختبار باء"]):
    status, created, _ = request(
        "POST",
        "/parties/customers",
        token,
        {"code": f"TC-{stamp}-{index}", "nameAr": name, "nameEn": f"Test Customer {index}"},
    )
    if status in (200, 201):
        customers.append(created)
check("إنشاء عميلين", len(customers) == 2, f"status={status} {created if len(customers) < 2 else ''}")

supplier = None
status, supplier, _ = request(
    "POST",
    "/parties/suppliers",
    token,
    {"code": f"TS-{stamp}", "nameAr": "مورد اختبار", "nameEn": "Test Supplier"},
)
check("إنشاء مورد", status in (200, 201), f"status={status}")

items = []
for index in range(2):
    status, item, _ = request(
        "POST",
        "/inventory/items",
        token,
        {
            "code": f"TI-{stamp}-{index}",
            "nameAr": f"صنف اختبار {index}",
            "nameEn": f"Test Item {index}",
            "unit": "قطعة",
            "salePrice": "150.00",
            "taxRate": "14.00",
        },
    )
    if status in (200, 201):
        items.append(item)
check("إنشاء صنفين", len(items) == 2, f"status={status}")

# a purchase first, so there is stock to sell, and so the supplier balance
# report has something in it
if supplier and items:
    status, purchase, _ = request(
        "POST",
        "/purchases/invoices",
        token,
        {
            "supplierId": supplier["id"],
            "invoiceDate": "2026-10-01",
            "notes": "فاتورة شراء اختبار",
            "lines": [
                {
                    "itemId": items[0]["id"],
                    "quantity": "10",
                    "unitPrice": "100.00",
                    "taxRate": "14.00",
                }
            ],
        },
    )
    check("إنشاء فاتورة شراء", status in (200, 201), f"status={status}")
    if purchase:
        status, _, _ = request("POST", f"/purchases/invoices/{purchase['id']}/post", token, {})
        check("ترحيل فاتورة الشراء", status in (200, 201), f"status={status}")

# a posted sales invoice, so P&L / balances / ledger are not empty
invoice = None
if customers and items:
    status, invoice, _ = request(
        "POST",
        "/sales/invoices",
        token,
        {
            "customerId": customers[0]["id"],
            "invoiceDate": "2026-10-01",
            "notes": "فاتورة اختبار الخصائص",
            "lines": [
                {
                    "itemId": items[0]["id"],
                    "quantity": "2",
                    "unitPrice": "150.00",
                    "taxRate": "14.00",
                }
            ],
        },
    )
    check("إنشاء فاتورة بيع", status in (200, 201), f"status={status}")
    if invoice:
        status, posted, _ = request("POST", f"/sales/invoices/{invoice['id']}/post", token, {})
        check("ترحيل الفاتورة", status in (200, 201), f"status={status}")

# an account to run the ledger report on
status, accounts, _ = request("GET", "/accounting/chart-of-accounts", token)
account_list = accounts.get("items", []) if isinstance(accounts, dict) else accounts
postable = [a for a in account_list if a.get("isPostable")] or account_list
account_id = postable[0]["id"] if postable else None
check("إيجاد حساب للدفتر", bool(account_id))

# ─────────────────────────────── 2. exporting reports
print("\n[2] تنزيل التقارير (xlsx / csv)")
reports = ["trial-balance", "profit-and-loss", "customer-balances", "supplier-balances"]
for report in reports:
    for fmt in ("xlsx", "csv"):
        query = f"?format={fmt}&lang=ar"
        status, content, head = request(
            "GET", f"/exports/{report}/download{query}", token, raw=True
        )
        if fmt == "xlsx":
            ok = status == 200 and is_xlsx(content) and len(content) > 2000
            check(f"{report} -> xlsx", ok, f"status={status} bytes={len(content)}")
        else:
            ok = status == 200 and content[:3] == b"\xef\xbb\xbf" and b"\xd8\xa7" in content
            check(f"{report} -> csv (بعلامة BOM وعربي)", ok, f"status={status} bytes={len(content)}")

status, content, head = request(
    "GET", f"/exports/account-ledger/download?format=xlsx&lang=ar&accountId={account_id}", token, raw=True
)
check("account-ledger -> xlsx", status == 200 and is_xlsx(content), f"status={status}")

status, content, head = request(
    "GET", f"/exports/trial-balance/download?format=pdf", token, raw=True
)
check("صيغة غير مدعومة تُرفض بوضوح", status == 400, f"status={status}")

status, content, head = request(
    "GET", f"/exports/trial-balance/download?format=xlsx&lang=en", token, raw=True
)
check("تصدير بالإنجليزية", status == 200 and is_xlsx(content), f"status={status}")

# ─────────────────────────────── 1. printing
print("\n[3] الطباعة")
for report in reports:
    for lang in ("ar", "en"):
        status, content, head = request(
            "GET", f"/exports/{report}/print?lang={lang}&auto=1", token, raw=True
        )
        text = content.decode("utf-8", "replace")
        ok = (
            status == 200
            and "<html" in text.lower()
            and "window.print" in text
            and len(text) > 1500
        )
        check(f"{report} -> طباعة ({lang})", ok, f"status={status} bytes={len(content)}")
    if report == "trial-balance":
        rtl = 'dir="rtl"' in text if lang == "ar" else True
        check("صفحة الطباعة بالعربية من اليمين لليسار", rtl)

status, content, head = request(
    "GET", f"/exports/account-ledger/print?lang=ar&accountId={account_id}", token, raw=True
)
check("account-ledger -> طباعة", status == 200, f"status={status}")

# the print page must stand on its own: no external css/js/font fetch
text = content.decode("utf-8", "replace")
external = [line for line in text.split("<") if 'href="http' in line or 'src="http' in line]
check("صفحة الطباعة قائمة بذاتها (بدون ملفات خارجية)", len(external) == 0, str(external[:2]))

# ─────────────────────────────── 3. importing files
print("\n[4] رفع ملفات لأخذ البيانات منها")
for kind in ("customers", "suppliers", "items"):
    status, content, head = request(
        "GET", f"/import/templates/{kind}", token, raw=True
    )
    check(f"قالب {kind} ينزل كملف Excel", status == 200 and is_xlsx(content), f"status={status}")

status, content, _ = request("GET", "/import/templates/nonsense", token, raw=True)
check("نوع غير معروف يُرفض", status == 400, f"status={status}")

# a csv to import: two new customers, codes typed in Arabic-free form
new_code_a = f"IM-{stamp}-A"
new_code_b = f"IM-{stamp}-B"
csv_text = (
    "code,name_ar,name_en,phone,tax_number,credit_limit\n"
    f"{new_code_a},عميل مستورد ألف,Imported A,01000000001,100-200-300,5000\n"
    f"{new_code_b},عميل مستورد باء,Imported B,,,\n"
)
csv_bytes = csv_text.encode("utf-8-sig")

status, result = upload(
    "/import/customers?dryRun=true&mode=insert", token, "customers.csv", csv_bytes
)
check(
    "تجربة بدون كتابة (dry run)",
    status in (200, 201) and result.get("dryRun") is True and result.get("created") == 2,
    f"status={status} result={result}",
)

status, after, _ = request("GET", f"/parties/customers?q={new_code_a}", token)
items_page = after.get("items", []) if isinstance(after, dict) else []
check("الـ dry run لم يكتب شيئاً", len(items_page) == 0, f"وُجد {len(items_page)}")

status, result = upload(
    "/import/customers?dryRun=false&mode=insert", token, "customers.csv", csv_bytes
)
check(
    "الاستيراد الفعلي",
    status in (200, 201) and result.get("created") == 2,
    f"status={status} result={result}",
)

status, after, _ = request("GET", f"/parties/customers?q={new_code_a}", token)
items_page = after.get("items", []) if isinstance(after, dict) else []
check("العميل المستورد موجود", len(items_page) == 1, f"وُجد {len(items_page)}")

# running the same file again must not duplicate anything
status, result = upload(
    "/import/customers?dryRun=false&mode=insert", token, "customers.csv", csv_bytes
)
check(
    "إعادة نفس الملف لا تُكرِّر (mode=insert)",
    status in (200, 201) and result.get("skipped") == 2 and result.get("created") == 0,
    f"status={status} result={result}",
)

# upsert updates only what the file carried
csv_update = (
    "code,name_ar,phone\n" f"{new_code_b},عميل مستورد باء بعد التعديل,01099999999\n"
)
status, result = upload(
    "/import/customers?dryRun=false&mode=upsert", token, "update.csv", csv_update.encode("utf-8-sig")
)
check(
    "التحديث (mode=upsert)",
    status in (200, 201) and result.get("updated") == 1,
    f"status={status} result={result}",
)

status, after, _ = request("GET", f"/parties/customers?q={new_code_b}", token)
items_page = after.get("items", []) if isinstance(after, dict) else []
row = items_page[0] if items_page else {}
check(
    "التحديث وصل للبيانات ولم يمسح بقية الحقول",
    row.get("phone") == "01099999999" and row.get("nameEn") == "Imported B",
    f"{row.get('phone')} / {row.get('nameEn')}",
)

# a code repeated inside the same file is an error, not a silent overwrite
duplicate = (
    "code,name_ar\n" f"{new_code_a},عميل مكرر\n" f"{new_code_a},عميل مكرر تاني\n"
)
status, result = upload(
    "/import/customers?dryRun=false&mode=insert", token, "dup.csv", duplicate.encode("utf-8-sig")
)
reported = [str(x) for x in (result.get("errors") or [])]
check(
    "الكود المكرر داخل الملف يُبلَّغ عنه ولا يُستورد مرتين",
    status in (200, 201)
    and any("more than once" in item for item in reported)
    and result.get("created", 0) == 0,
    f"status={status} {result}",
)

# a file with no code column cannot be trusted
status, result = upload(
    "/import/customers?dryRun=true", token, "bad.csv", "name_ar\nبدون كود\n".encode("utf-8-sig")
)
check("ملف بدون عمود الكود يُرفض برسالة واضحة", status == 400, f"status={status}")

# a file that is not a spreadsheet at all
status, result = upload(
    "/import/customers?dryRun=true", token, "photo.png", b"\x89PNG\r\n\x1a\n" + b"0" * 400
)
check("ملف ليس جدولاً يُرفض برسالة واضحة", status == 400, f"status={status}")

# importing suppliers and items from csv
supplier_csv = f"code,name_ar,phone\nIM-{stamp}-S,مورد مستورد,01111111111\n"
status, result = upload(
    "/import/suppliers?dryRun=false", token, "suppliers.csv", supplier_csv.encode("utf-8-sig")
)
check("استيراد موردين", status in (200, 201) and result.get("created") == 1, f"status={status} {result}")

item_csv = (
    "code,name_ar,name_en,unit,sale_price,tax_rate,track_stock,is_active\n"
    f"IM-{stamp}-I,صنف مستورد,Imported item,كرتونة,300.00,14.00,نعم,نعم\n"
)
status, result = upload(
    "/import/items?dryRun=false", token, "items.csv", item_csv.encode("utf-8-sig")
)
check("استيراد أصناف (بعمود عربي للتفعيل)", status in (200, 201) and result.get("created") == 1, f"status={status} {result}")
check(
    "الأعمدة المجهولة تُبلَّغ ولا تُتجاهل بصمت",
    "is_active" in [str(x) for x in (result.get("unknownColumns") or result.get("unknown") or [])],
    f"{result}",
)

status, after, _ = request("GET", f"/inventory/items?q=IM-{stamp}-I", token)
items_page = after.get("items", []) if isinstance(after, dict) else []
check("الصنف المستورد موجود بقيمته", len(items_page) == 1, f"وُجد {len(items_page)}")

# an xlsx upload must work too, not only csv
try:
    import openpyxl  # noqa

    has_openpyxl = True
except Exception:
    has_openpyxl = False
if has_openpyxl:
    import openpyxl

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.append(["code", "name_ar", "name_en"])
    code_x = f"IM-{stamp}-X"
    sheet.append([code_x, "عميل من إكسل", "From Excel"])
    stream = io.BytesIO()
    book.save(stream)
    status, result = upload(
        "/import/customers?dryRun=false", token, "from-excel.xlsx", stream.getvalue()
    )
    check("رفع ملف Excel حقيقي (.xlsx)", status in (200, 201) and result.get("created") == 1, f"status={status} {result}")
else:
    print("  SKIP  ملف Excel (openpyxl غير مثبت هنا)")

# ─────────────────────────────── 4. backup and restore
print("\n[5] النسخ الاحتياطي والاسترجاع")
status, summary, _ = request("GET", "/backup/summary", token)
check(
    "ملخص النسخة الاحتياطية",
    status == 200 and summary.get("total", 0) > 0,
    f"status={status} {summary}",
)

status, content, head = request("GET", "/backup/download", token, raw=True)
check("تنزيل النسخة الاحتياطية", status == 200 and len(content) > 5000, f"status={status} bytes={len(content)}")
check(
    "امتداد التنزيل ملف JSON",
    "attachment" in head.get("Content-Disposition", "")
    and ".json" in head.get("Content-Disposition", ""),
    head.get("Content-Disposition", ""),
)

backup = {}
try:
    backup = json.loads(content.decode("utf-8"))
except Exception as error:
    check("النسخة ملف JSON صالح", False, str(error))
if backup:
    check(
        "النسخة تحتوي الجداول الأساسية",
        all(key in backup["tables"] for key in ("account", "customer", "item", "journalEntry")),
        ", ".join(backup["tables"].keys()),
    )
    check("النسخة تحمل رقم إصدار الصيغة", backup.get("version") == 1, str(backup.get("version")))
    recorded = backup["counts"]
else:
    recorded = {}

# what the database holds right now, to compare after the restore
status, before_customers, _ = request("GET", "/parties/customers?pageSize=100", token)
count_before = before_customers.get("total", 0)

# add something that did NOT exist when the backup was taken
status, extra, _ = request(
    "POST",
    "/parties/customers",
    token,
    {"code": f"AFTER-{stamp}", "nameAr": "عميل بعد النسخة", "nameEn": "Added After Backup"},
)
check("إضافة عميل بعد أخذ النسخة", status in (200, 201), f"status={status}")

status, after, _ = request("GET", "/parties/customers?pageSize=100", token)
check("العميل الجديد ظهر", after.get("total", 0) == count_before + 1, f"{count_before} -> {after.get('total')}")

# inspect the file before touching anything
status, inspected = upload("/backup/inspect", token, "backup.json", content)
check(
    "فحص ملف النسخة قبل الاسترجاع",
    status in (200, 201) and inspected.get("belongsToThisCompany") is True,
    f"status={status} {inspected}",
)

# restoring over live data without asking must be refused
status, refused = upload("/backup/restore", token, "backup.json", content)
check(
    "الاسترجاع يُرفض بدون تأكيد الاستبدال",
    status == 400,
    f"status={status} {refused}",
)

# and with the confirmation, the data goes back exactly as it was
status, restored = upload(
    "/backup/restore?replace=true", token, "backup.json", content
)
check(
    "الاسترجاع الفعلي",
    status in (200, 201) and restored.get("replaced") is True and restored.get("total", 0) > 0,
    f"status={status} {restored}",
)

status, after, _ = request("GET", "/parties/customers?pageSize=100", token)
check(
    "البيانات رجعت كما كانت (العميل اللاحق اختفى)",
    after.get("total", 0) == count_before,
    f"{after.get('total')} بدل {count_before}",
)

status, after, _ = request("GET", f"/parties/customers?q=AFTER-{stamp}", token)
check("لا أثر للعميل الذي أُضيف بعد النسخة", len(after.get("items", [])) == 0)

# and the accounting is intact after the restore: it still balances
status, trial, _ = request("GET", "/reports/trial-balance", token)
if isinstance(trial, dict):
    totals = trial.get("totals") or {}
    debit = str(totals.get("debit", totals.get("totalDebit", "0")))
    credit = str(totals.get("credit", totals.get("totalCredit", "0")))
    check("الميزان متوازن بعد الاسترجاع", debit == credit, f"مدين={debit} دائن={credit}")
else:
    check("الميزان متوازن بعد الاسترجاع", False, "لا استجابة")

# a file that is not a backup must be refused, not half-loaded
status, bad = upload("/backup/restore?replace=true", token, "junk.json", b'{"hello":"world"}')
check("ملف ليس نسخة احتياطية يُرفض", status == 400, f"status={status}")

# ─────────────────────────────── access control
print("\n[6] الحماية والصلاحيات")
status, content, _ = request("GET", "/backup/download", None, raw=True)
check("النسخة الاحتياطية لا تنزل بدون تسجيل دخول", status in (401, 403), f"status={status}")

status, content, _ = request("GET", "/exports/trial-balance/download?format=xlsx", None, raw=True)
check("التقرير لا ينزل بدون تسجيل دخول", status in (401, 403), f"status={status}")

# the browser window that opens for printing cannot send a header, so the
# token is allowed in the query string on those routes only
status, content, head = request(
    "GET", f"/exports/trial-balance/print?lang=ar&token={token}", None, raw=True
)
check("صفحة الطباعة تُفتح بالتوكن في الرابط (كما يفعل المتصفح)", status == 200, f"status={status}")

status, content, _ = request(
    "GET", f"/parties/customers?token={token}", None, raw=True
)
check("التوكن في الرابط لا يعمل على بقية المسارات", status in (401, 403), f"status={status}")

status, content, _ = request(
    "GET", f"/backup/download?token={token}", None, raw=True
)
check("النسخة الاحتياطية تنزل بالتوكن في الرابط", status == 200, f"status={status}")

# ─────────────────────────────── done
print("\n" + "=" * 66)
print(f"  نجح: {passed}    فشل: {failed}")
if notes:
    print("  التفاصيل:")
    for note in notes:
        print(f"    - {note}")
print("=" * 66)
sys.exit(1 if failed else 0)
