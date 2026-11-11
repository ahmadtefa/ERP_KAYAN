#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
out="$RUNNER_TEMP/diag.json"
flutter test test/widget/_diag_test.dart --reporter json > "$out" 2>&1 || true
python3 - "$out" <<'PY'
import json,sys
path=sys.argv[1]
msgs=[]
for line in open(path,encoding='utf-8',errors='replace'):
    try: e=json.loads(line)
    except Exception: continue
    if e.get('type')=='error':
        msgs.append(str(e.get('error',''))[:1200])
    if e.get('type')=='print':
        msgs.append('PRINT: '+str(e.get('message',''))[:400])
text=' || '.join(msgs)[:2800] or 'NO-ERROR-EVENTS'
print('::error title=DIAG-ONLY::'+text.replace('%','%25').replace('\n','%0A'))
PY
