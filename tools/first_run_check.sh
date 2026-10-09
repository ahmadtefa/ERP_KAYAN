#!/usr/bin/env bash
# The first run a customer has: PostgreSQL is installed and empty, the program
# has just been installed, and nobody has a username yet.
#
# This assembles that situation on this machine - a database of its own, a
# settings file of its own, no users in it - and then drives the same code the
# window drives, to prove the whole chain works without a terminal:
#
#   empty database -> the program notices -> somebody chooses a username and
#   password -> the company and its administrator exist -> the program starts
#   -> that username and password sign in
#
# Nothing here touches the installation already on this machine: it uses its own
# database name, its own settings file and its own log.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DB="${1:-erp_kayan_first_run}"
USERNAME="${KAYAN_FIRST_ADMIN_USERNAME:-owner}"
PASSWORD="${KAYAN_FIRST_ADMIN_PASSWORD:-}"
if [ -z "$PASSWORD" ]; then
  # A password nobody has ever seen before, made here, used once.
  PASSWORD="$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 14)Aa1"
fi
SETTINGS="/tmp/kayan-first-run.env"
LOG="/tmp/kayan-first-run.log"
ADMIN_URL="${ADMIN_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}"

say() { printf '  %s\n' "$1"; }

echo "=============================================================="
echo "  KAYAN ERP  -  أول تشغيل: قاعدة بيانات فاضية تمامًا"
echo "=============================================================="

say "1/4  قاعدة بيانات فاضية جديدة: $DB"
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB;" 2>/dev/null
sudo -u postgres psql -q -c "CREATE DATABASE $DB OWNER erp_app;" 2>/dev/null
sudo -u postgres psql -q -d "$DB" -c "ALTER SCHEMA public OWNER TO erp_app;" >/dev/null 2>&1
say "     مستخدمين موجودين فيها: $(PGPASSWORD=postgres psql -h 127.0.0.1 -U erp_app -d "$DB" -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0) جدول (لسه فاضية)"

say "2/4  ملف إعدادات جهاز جديد (زي أول تشغيل عند العميل)"
cat > "$SETTINGS" <<EOF
DATABASE_URL="postgresql://erp_app:postgres@127.0.0.1:5432/$DB?schema=public"
ADMIN_DATABASE_URL="$ADMIN_URL"
JWT_ACCESS_SECRET="first-run-access-secret-000000000000000000"
JWT_REFRESH_SECRET="first-run-refresh-secret-00000000000000000"
EOF
rm -f "$LOG"
say "     $SETTINGS"

say "3/4  فحص سكربت تجهيز القاعدة (نفس اللي البرنامج بيناديه قبل ما يشغّل السيرفر)"
cd "$REPO/backend"
set +e
OUT=$(DATABASE_URL="postgresql://erp_app:postgres@127.0.0.1:5432/$DB?schema=public" \
      ADMIN_DATABASE_URL="$ADMIN_URL" \
      node scripts/prepare-database.mjs 2>&1)
CODE=$?
set -e
echo "$OUT" | sed 's/^/     /'
if echo "$OUT" | grep -q "KAYAN-DB-STATE=empty"; then
  say "     ✓ البرنامج عرف إن القاعدة فاضية (وما اخترعش أي حساب)"
else
  say "     ✗ متوقع KAYAN-DB-STATE=empty — الفحص الجاي مش هيفيد"
  exit 1
fi
if echo "$OUT" | grep -qi "admin@12345\|Admin@12345"; then
  say "     ✗ لقيت كلمة سر معروفة في المخرجات"; exit 1
fi
[ "$CODE" = "0" ] || { say "     ✗ سكربت التجهيز رجع $CODE"; exit 1; }

say "4/4  تشغيل الفحص الحقيقي: اكتشاف → إنشاء أول مدير → دخول"
cd "$REPO"
export PATH="/opt/flutter/bin:$PATH"
set +e
KAYAN_CHECK=first-run \
KAYAN_DESKTOP_BACKEND_DIR="$REPO/backend" \
KAYAN_DESKTOP_NODE="$(command -v node)" \
KAYAN_DESKTOP_SETTINGS="$SETTINGS" \
KAYAN_FIRST_ADMIN_USERNAME="$USERNAME" \
KAYAN_FIRST_ADMIN_PASSWORD="$PASSWORD" \
  timeout 400 flutter pub run tools/desktop_check.dart 2>&1 \
  | grep -E "PASS|FAIL|نجح:|\[[0-9]\]" | sed 's/^/  /'
RESULT=${PIPESTATUS[0]}
set -e

echo
say "الحساب اللي اتعمل:"
PGPASSWORD=postgres psql -h 127.0.0.1 -U erp_app -d "$DB" -tAc \
  "select username, \"isSuperAdmin\" from users;" 2>/dev/null | sed 's/^/     /'
say "عدد الحسابات المحاسبية: $(PGPASSWORD=postgres psql -h 127.0.0.1 -U erp_app -d "$DB" -tAc 'select count(*) from accounts;' 2>/dev/null)"

rm -f "$SETTINGS"
echo
[ "$RESULT" = "0" ] && say "✓ أول تشغيل اشتغل من أوله لآخره بدون أي أمر يدوي" || say "✗ فيه فشل — راجع فوق"
exit "$RESULT"
