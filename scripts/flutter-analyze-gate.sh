#!/usr/bin/env bash
# Runs `flutter analyze` and separates two things a bare analyze conflates:
#
#   compile errors  - the app does not build. These fail the job.
#   warnings/notes  - style. These are counted and published, not fatal.
#
# Why: in this Flutter version `analyze` exits non-zero on `info` notes too, and
# this codebase has those all over it (single-statement ifs without braces,
# unused private fields). So a bare analyze has never passed, and "analyze
# failed" told us nothing about whether the app compiles - the actual compile
# errors in four inventory screens sat behind that noise.
#
# Nothing is hidden: every note is written to the job summary, and the log is
# uploaded with the run.
set -uo pipefail

out="${1:-analyze.json}"
flutter analyze --no-pub --machine > "$out" 2>&1
raw=$?

echo "--- analyze exit=$raw, bytes=$(wc -c < "$out"), lines=$(wc -l < "$out") ---"
echo "--- first 12 lines of raw output ---"
head -12 "$out"
echo "--- lines starting with { : $(grep -c '^{' "$out" || true) ---"

python - "$out" <<'PY'
import json, os, sys, collections

path = sys.argv[1]
errors, warnings, infos = [], [], []
other = []

for line in open(path, encoding='utf-8', errors='replace'):
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get('type') != 'diagnostic':
        continue
    sev = d.get('severity', '')
    start = (d.get('range') or {}).get('start') or {}
    loc = "%s:%s" % (d.get('path', '?'), start.get('line', '?'))
    item = "%s  [%s]  %s" % (loc, d.get('code', '?'), (d.get('message') or '')[:140])
    if sev == 'ERROR':
        errors.append(item)
    elif sev == 'WARNING':
        warnings.append(item)
    elif sev == 'INFO':
        infos.append(item)
    else:
        other.append(item)

summary = os.environ.get('GITHUB_STEP_SUMMARY')
if summary:
    with open(summary, 'a', encoding='utf-8') as fh:
        fh.write("\n### flutter analyze\n\n")
        fh.write("| severity | count |\n| --- | --- |\n")
        fh.write("| error | %d |\n" % len(errors))
        fh.write("| warning | %d |\n" % len(warnings))
        fh.write("| info | %d |\n" % len(infos))
        for title, items in (('Compile errors', errors), ('Warnings', warnings)):
            if not items:
                continue
            fh.write("\n<details><summary>%s (%d)</summary>\n\n" % (title, len(items)))
            for i in items:
                fh.write("- `%s`\n" % i)
            fh.write("\n</details>\n")
        if infos:
            codes = collections.Counter(i.split('  [', 1)[1].split(']', 1)[0] for i in infos)
            fh.write("\n<details><summary>Style notes by rule (%d)</summary>\n\n" % len(infos))
            for code, n in codes.most_common():
                fh.write("- `%s` x%d\n" % (code, n))
            fh.write("\n</details>\n")

for i in errors[:40]:
    print("error  " + i)
for w in warnings[:40]:
    print("warning " + w)

print("\nerrors=%d warnings=%d infos=%d" % (len(errors), len(warnings), len(infos)))

if errors:
    print("::error title=Flutter compile errors::%d error(s) - the application does not build" % len(errors))
    sys.exit(1)
if warnings or infos:
    print("::notice title=No compile errors::%d warning(s), %d style note(s); tests will still run"
          % (len(warnings), len(infos)))
PY
gate=$?

# A machine-format run that produced no parsable diagnostics but still failed
# is a tooling failure, not a clean run - do not let it pass silently.
if [ "$gate" -ne 0 ]; then
  exit "$gate"
fi
if [ "$raw" -ne 0 ] && ! grep -q '"type":"diagnostic"' "$out"; then
  echo "flutter analyze exited $raw without producing diagnostics; treating as failure" >&2
  exit "$raw"
fi
exit 0
