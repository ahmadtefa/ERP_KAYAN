#!/usr/bin/env bash
# Shows what the default per-address limiter does to one office address (limiter ON).
set -euo pipefail
# usage: load-limiter-probe.sh [WORKERS]  (default 1)
export KAYAN_WORKERS="${1:-1}"
DB=erp_kayan_load_probe
export DATABASE_URL="postgresql://ci:ci@127.0.0.1:5432/${DB}?schema=public"
psql -h 127.0.0.1 -U ci -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE)" -c "CREATE DATABASE ${DB}"
node scripts/apply-migrations.mjs > /dev/null
npx ts-node prisma/seed.ts > /dev/null
export RATE_LIMIT_ENABLED=true
node dist/src/main.js > /tmp/load-api-probe-w${KAYAN_WORKERS}.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
for i in $(seq 1 120); do curl -fsS http://127.0.0.1:3000/api/v1/health 2>/dev/null | grep -q '"database":"up"' && break; sleep 0.25; done
if [ "$KAYAN_WORKERS" != "1" ]; then sleep 5; fi
echo "limiter probe with KAYAN_WORKERS=$KAYAN_WORKERS"
node --input-type=module -e '
const API="http://127.0.0.1:3000/api/v1";
const login=async(u,p)=>fetch(API+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
const r=await login("ci-admin","CI-only-Admin-Password-12345"); const t=(await r.json()).accessToken;
// 1) logins from one address: how many succeed in a morning rush
let okLogin=0,blockedLogin=0;
for(let i=0;i<30;i++){const x=await login("ci-admin","CI-only-Admin-Password-12345"); if(x.status<300) okLogin++; else if(x.status===429) blockedLogin++;}
console.log(`sign-ins from one address in a burst of 30 (plus the first): ok=${okLogin}, refused with 429=${blockedLogin}`);
// 2) ordinary requests from one address within a minute
let ok=0,blocked=0; const t0=Date.now();
for(let i=0;i<500;i++){const x=await fetch(API+"/inventory/items",{headers:{Authorization:"Bearer "+t}}); if(x.status===200) ok++; else if(x.status===429) blocked++;}
console.log(`500 ordinary requests from one address in ${((Date.now()-t0)/1000).toFixed(1)} s: ok=${ok}, refused with 429=${blocked}`);
'
