#!/usr/bin/env bash
# usage: load-run.sh LABEL POOL_MAX RATE_LIMIT_ENABLED   (run from backend/)
# Re-run after the first-request company-settings race fix v2 (raw INSERT ... ON CONFLICT DO NOTHING).
set -euo pipefail
LABEL="$1"; POOL="$2"; LIMITER="$3"
DB="erp_kayan_load_${LABEL,,}"
export DATABASE_URL="postgresql://ci:ci@127.0.0.1:5432/${DB}?schema=public"
psql -h 127.0.0.1 -U ci -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE)" -c "CREATE DATABASE ${DB}"
node scripts/apply-migrations.mjs > /dev/null
npx ts-node prisma/seed.ts > /dev/null
export RATE_LIMIT_ENABLED="$LIMITER"
if [ -n "$POOL" ]; then export PG_POOL_MAX="$POOL"; fi
START=$(date +%s.%N)
node dist/src/main.js > "/tmp/load-api-${LABEL}.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
for i in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health 2>/dev/null | grep -q '"database":"up"'; then break; fi
  sleep 0.25
done
READY=$(date +%s.%N)
echo "run ${LABEL}: API start-to-healthy $(echo "$READY - $START" | bc) s (pool max: ${POOL:-default 10}, limiter enabled: ${LIMITER})"
export SERVER_PID="$API_PID"
export ADMIN_USERNAME=ci-admin ADMIN_PASSWORD=CI-only-Admin-Password-12345
export LOAD_LABEL="run ${LABEL}: pool=${POOL:-10}" LOAD_RESULT_FILE="/tmp/load-result-${LABEL}.json"
set +e
node scripts/load-check.mjs http://127.0.0.1:3000/api/v1 | tee "/tmp/load-out-${LABEL}.txt" | grep -v '^{'
RC=${PIPESTATUS[0]}
set -e
echo "---- unique-constraint refusals by rule (API log) ----"
grep -o "Unique constraint refused a write: .*" "/tmp/load-api-${LABEL}.log" | sort | uniq -c || true
test "$RC" = 0
test -f "/tmp/load-result-${LABEL}.json"
echo "---- pool/errors in API log (counts) ----"
grep -ciE "timeout|ECONNREFUSED|too many clients|deadlock|P2024|P2028" "/tmp/load-api-${LABEL}.log" || true
