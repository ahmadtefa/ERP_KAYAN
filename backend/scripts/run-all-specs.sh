#!/bin/bash
# Batched jest runner that skips files already recorded in /tmp/spec-results.txt
cd "$(dirname "$0")/.." || exit 1
export PGPASSWORD=kayan_local_dev
export NODE_OPTIONS=--experimental-vm-modules
J=node_modules/.bin/jest
BATCH="${1:-3}"
touch /tmp/spec-results.txt
mapfile -t files < <(find src -name "*.spec.ts" | grep -v "tenant-rls.integration" | sort)
for f in "${files[@]}"; do
  grep -qE "^(PASS|FAIL) $f\$" /tmp/spec-results.txt && continue
  todo+=("$f")
done
total=${#todo[@]}
echo "TODO=$total" >> /tmp/spec-results.txt
i=0
while [ $i -lt $total ]; do
  chunk=("${todo[@]:$i:$BATCH}")
  if $J --runInBand "${chunk[@]}" > /tmp/spec-batch.log 2>&1; then
    for f in "${chunk[@]}"; do echo "PASS $f" >> /tmp/spec-results.txt; done
  else
    for f in "${chunk[@]}"; do
      if $J --runInBand "$f" > /tmp/spec-one.log 2>&1; then
        echo "PASS $f" >> /tmp/spec-results.txt
      else
        echo "FAIL $f" >> /tmp/spec-results.txt
      fi
    done
  fi
  i=$((i + BATCH))
done
p=$(grep -c '^PASS' /tmp/spec-results.txt); flt=$(grep -c '^FAIL' /tmp/spec-results.txt)
echo "PER_FILE_SUMMARY pass=$p fail=$flt" >> /tmp/spec-results.txt
