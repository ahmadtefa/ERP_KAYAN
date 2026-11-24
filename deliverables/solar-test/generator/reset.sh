#!/bin/bash
# fresh throwaway DB + migrations + bootstrap seed + API
pkill -f "dist/src/main.js" ; sleep 1
export PGPASSWORD=kayan
P="psql -h 127.0.0.1 -p 55432 -U kayan -d postgres -q"
$P -c 'drop database if exists kayan_solar_build' -c 'create database kayan_solar_build'
cd /tmp/kayan/backend
export DATABASE_URL='postgresql://kayan:kayan@127.0.0.1:55432/kayan_solar_build?schema=public'
node scripts/apply-migrations.mjs >/dev/null
ADMINPW=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)Aa1!
echo "$ADMINPW" > /tmp/gen/admin.pw
KAYAN_ADMIN_PASSWORD="$ADMINPW" KAYAN_COMPANY_CODE=KAYAN-SOLAR KAYAN_COMPANY_NAME_EN='Kayan Solar Energy' KAYAN_COMPANY_NAME_AR='كيان للطاقة الشمسية' KAYAN_UNIT_CODE=HQ KAYAN_UNIT_NAME_EN='Head Office - Cairo' KAYAN_UNIT_NAME_AR='المركز الرئيسي - القاهرة' npx ts-node --transpile-only prisma/seed.ts | tail -3
rm -rf /tmp/kbackups; setsid nohup bash /tmp/runapi.sh > /tmp/api.log 2>&1 < /dev/null &
for i in $(seq 30); do curl -s localhost:3999/api/v1/health >/dev/null && break; sleep 1; done
echo ready
