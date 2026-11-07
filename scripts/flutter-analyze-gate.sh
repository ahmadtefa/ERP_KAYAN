#!/usr/bin/env bash
# Runs `flutter analyze` and separates two things the bare command conflates:
#
#   errors           - the app does not compile. Fail the job.
#   warnings / infos - style. Count them, publish them, keep going so the
#                      tests actually run.
#
# Why: in this Flutter version `analyze` exits non-zero on `info` notes too, and
# this codebase has them throughout (single-statement ifs without braces,
# unused private fields). So the step never passed and its red cross carried no
# information - which is how six real compile errors in four inventory screens
# went unnoticed.
#
# Text output is parsed on purpose: it is what the analyzer prints by default
# and what has already been seen to reach the annotations reliably.
set -uo pipefail

out="${1:-flutter-analyze.log}"
: > "$out"

flutter analyze --no-pub > "$out" 2>&1
raw=$?

errors=$(grep -cE '^[[:space:]]*error[[:space:]]*•' "$out" || true)
warnings=$(grep -cE '^[[:space:]]*warning[[:space:]]*•' "$out" || true)
infos=$(grep -cE '^[[:space:]]*info[[:space:]]*•' "$out" || true)

echo "analyze exit=$raw  errors=$errors warnings=$warnings infos=$infos"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo ""
    echo "### flutter analyze"
    echo ""
    echo "| severity | count |"
    echo "| --- | --- |"
    echo "| error | $errors |"
    echo "| warning | $warnings |"
    echo "| info | $infos |"
    if [ "$errors" -gt 0 ]; then
      echo ""
      echo "<details><summary>Compile errors ($errors)</summary>"
      echo ""
      grep -E '^[[:space:]]*error[[:space:]]*•' "$out" | sed 's/^/    /; s/^    /- `/; s/$/`/' || true
      echo ""
      echo "</details>"
    fi
    if [ "$infos" -gt 0 ]; then
      echo ""
      echo "<details><summary>Style notes by rule ($infos)</summary>"
      echo ""
      grep -E '^[[:space:]]*info[[:space:]]*•' "$out" \
        | sed -E 's/.*•[[:space:]]*([A-Za-z0-9_]+)[[:space:]]*$/\1/' \
        | sort | uniq -c | sort -rn \
        | sed 's/^ *//; s/^\([0-9]*\) /- x\1 /' || true
      echo ""
      echo "</details>"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$errors" -gt 0 ]; then
  echo "--- compile errors ---"
  grep -E '^[[:space:]]*error[[:space:]]*•' "$out" | head -30
  # Emit as an annotation too, so the failure text is readable without the log.
  {
    echo "::error title=Flutter compile errors::$errors error(s) - the application does not build%0A"
    grep -E '^[[:space:]]*error[[:space:]]*•' "$out" \
      | head -30 \
      | sed 's/%/%25/g; s/\r//g' \
      | while IFS= read -r l; do printf '%s%%0A' "$l"; done
    echo
  } >&2
  exit 1
fi

# No errors but a non-zero exit could still mean the tool itself broke (missing
# pubspec, network, bad flag). Do not report that as a clean run.
if [ "$raw" -ne 0 ] && ! grep -qE '^[[:space:]]*(info|warning)[[:space:]]*•' "$out"; then
  {
    echo "::error title=flutter analyze failed::exit $raw with no diagnostics; last lines:%0A"
    tail -25 "$out" | sed 's/%/%25/g; s/\r//g' | while IFS= read -r l; do printf '%s%%0A' "$l"; done
    echo
  } >&2
  exit "$raw"
fi

echo "::notice title=No compile errors::$warnings warning(s), $infos style note(s); tests will run"
exit 0
