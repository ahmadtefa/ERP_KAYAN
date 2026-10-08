#!/usr/bin/env bash
# Stages the Windows package layout on this machine and runs the real launcher
# against it, outside the repository, with no Node on PATH.
#
# This is the closest this machine can get to "copy the folder to another
# computer and double-click the exe". It assembles the same file set that
# scripts/build-desktop-windows.ps1 assembles, then starts the shell the same
# way a packaged copy does:
#
#   * the program folder is outside the git repository
#   * the only Node runtime in reach is backend/node/node, shipped inside it
#   * the development .env is absent, exactly as in the package
#   * the machine's settings file starts empty, so the program writes it
#     with fresh secrets - the first-run path a customer walks through
#
# The Windows-only parts (the .exe, the hidden console, the installer) cannot
# be exercised here; see docs/DESKTOP_WINDOWS.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="${1:-/home/user/KAYAN-ERP-package}"
APP="$PACKAGE/KAYAN-ERP"
BACKEND_SOURCE="$REPO/backend"
DATA="$HOME/.local/share/KAYAN-ERP"

say() { printf '  %s\n' "$1"; }

echo "=============================================================="
echo "  KAYAN ERP  -  نسخة مغلّفة: تشغيل من بره الريبو، بدون Node"
echo "=============================================================="

say "1/6  تفريغ مجلد التغليف: $APP"
rm -rf "$PACKAGE"
mkdir -p "$APP/backend"

say "2/6  نقل مكونات السيرفر (نفس ملفات سكربت التغليف)"
cp -r "$BACKEND_SOURCE/dist" "$APP/backend/dist"
cp -r "$BACKEND_SOURCE/prisma" "$APP/backend/prisma"
cp -r "$BACKEND_SOURCE/scripts" "$APP/backend/scripts"
cp "$BACKEND_SOURCE/package.json" "$APP/backend/package.json"
cp "$BACKEND_SOURCE/package-lock.json" "$APP/backend/package-lock.json"
cp "$BACKEND_SOURCE/.env.production.example" "$APP/backend/.env.production.example"

say "3/6  تنصيب مكتبات الإنتاج فقط داخل النسخة"
( cd "$APP/backend" && npm ci --omit=dev --no-audit --no-fund > /tmp/pkg-npmci.log 2>&1 )
( cd "$APP/backend" && ./node_modules/.bin/prisma generate > /tmp/pkg-prisma.log 2>&1 )

say "4/6  إضافة محرّك Node اللي بيسافر مع البرنامج"
# On Windows this is backend\node\node.exe, exactly what the build script copies.
mkdir -p "$APP/backend/node"
cp "$(command -v node)" "$APP/backend/node/node"
cp -r "$(dirname "$(readlink -f "$(command -v node)")")/../lib/node_modules" "$APP/backend/node/lib-node_modules" 2>/dev/null || true

echo
echo "  ── فحوص النسخة المغلفة ──"
fail=0
check() { if [ "$2" = "1" ]; then printf '    PASS  %s\n' "$1"; else printf '    FAIL  %s   %s\n' "$1" "${3:-}"; fail=$((fail+1)); fi; }

[ -f "$APP/backend/dist/src/main.js" ] && check "السيرفر المبني جوّه النسخة" 1 || check "السيرفر المبني جوّه النسخة" 0
[ -d "$APP/backend/node_modules" ] && check "مكتبات الإنتاج جوّه النسخة" 1 || check "مكتبات الإنتاج جوّه النسخة" 0
[ -f "$APP/backend/scripts/prepare-database.mjs" ] && check "سكربت تجهيز قاعدة البيانات" 1 || check "سكربت تجهيز قاعدة البيانات" 0
[ -f "$APP/backend/node/node" ] && check "محرّك Node مرفق (بدون تنصيب)" 1 || check "محرّك Node مرفق (بدون تنصيب)" 0
[ -f "$APP/backend/.env.production.example" ] && check "نموذج الإعدادات مرفق" 1 || check "نموذج الإعدادات مرفق" 0

if [ -f "$APP/backend/.env" ]; then check "مفيش .env تطوير جوّه النسخة" 0 "الملف موجود!"; else check "مفيش .env تطوير جوّه النسخة" 1; fi
if grep -rq "C:\\\\Users\\\\ECC" "$APP/backend" --include="*.mjs" --include="*.json" 2>/dev/null; then
  check "مفيش أي مسار خاص بجهاز المطوّر" 0 "لقيت مسار مطلق"; else check "مفيش أي مسار خاص بجهاز المطوّر" 1; fi
grep -rq "dev-secret\|Admin@12345" "$APP/backend/.env.production.example" 2>/dev/null \
  && check "مفيش أسرار تطوير في النموذج" 0 || check "مفيش أسرار تطوير في النموذج" 1
[ "$fail" = "0" ] || { echo "  ✗ النسخة ناقصة — وقفت"; exit 1; }

say "5/6  مسح إعدادات الجهاز، عشان البرنامج يكتبها بنفسه (زي أول تشغيل عند العميل)"
rm -f "$DATA/kayan.env" "$DATA/logs/backend.log"

say "6/6  تشغيل المشغّل الحقيقي على النسخة المغلفة، بدون Node في PATH"
# A decoy named node sits first on PATH: if the launcher ever fell back to PATH
# instead of the bundled runtime, this is what it would run, and the server
# would not come up.
DECOY=/tmp/kayan-nonode
rm -rf "$DECOY"; mkdir -p "$DECOY"
printf '#!/bin/sh\necho "PATH NODE WAS USED INSTEAD OF THE BUNDLED ONE" >&2\nexit 127\n' > "$DECOY/node"
chmod +x "$DECOY/node"

echo
( cd "$REPO" && PATH="$DECOY:/opt/flutter/bin:/usr/bin:/bin" \
    KAYAN_DESKTOP_BACKEND_DIR="$APP/backend" \
    timeout 500 flutter pub run tools/desktop_check.dart ) 2>&1 | grep -E "PASS|FAIL|نجح:|العنوان|فيه سيرفر" | sed 's/^/  /'
result=${PIPESTATUS[0]}

echo
echo "  ── إثبات إن المحرّك المستخدم هو اللي جوّه النسخة ──"
head -4 "$DATA/logs/backend.log" | sed 's/^/    /'
if grep -q "node: $APP/backend/node/node" "$DATA/logs/backend.log"; then
  echo "    ✓ المحرّك المستخدم: $APP/backend/node/node  (من جوه النسخة)"
else
  echo "    ✗ مش واضح إنه استخدم محرّك النسخة"; result=1
fi
rm -rf "$DECOY"
echo
[ "$result" = "0" ] && echo "  ✓ النسخة المغلفة شغلت نفسها بنجاح من بره الريبو" || echo "  ✗ فيه فشل — راجع فوق"
exit "$result"
