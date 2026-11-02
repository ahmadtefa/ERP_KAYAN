#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP must be set by GitHub Actions}"
: "${GITHUB_ENV:?GITHUB_ENV must be set by GitHub Actions}"

src="$(mktemp -d "$RUNNER_TEMP/innoextract-src.XXXXXX")"
git clone --no-checkout https://github.com/mplabsorg/innoextract.git "$src"
git -C "$src" fetch --depth=1 origin refs/heads/support-inno-7.1
git -C "$src" checkout --detach FETCH_HEAD
test "$(git -C "$src" rev-parse HEAD)" = 34f65747e4a57d5de2582bb1ad3d540f440a3983

cmake -S "$src" -B "$src/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=ON
cmake --build "$src/build" --parallel 2
ctest --test-dir "$src/build" --output-on-failure

extractor="$(find "$src/build" -type f -name innoextract -perm -111 -print -quit)"
test -n "$extractor"
"$extractor" --version
extractor_sha256="$(sha256sum "$extractor" | cut -d' ' -f1)"

fixture_zip="$RUNNER_TEMP/innoextract-format-fixtures.zip"
curl -fsSL https://github.com/mplabsorg/innoextract/releases/download/format-fixtures-v1/innoextract-format-fixtures.zip -o "$fixture_zip"
echo "d77d2c447dd46edaeab6b4ea5d7102000b0b8cd66970f18cea2b1eb20f21aa52  $fixture_zip" | sha256sum -c -
fixtures="$RUNNER_TEMP/format-fixtures"
rm -rf "$fixtures"
unzip -q "$fixture_zip" -d "$RUNNER_TEMP"
python3 "$src/tests/check-fixtures.py" --extractor "$extractor" --fixtures "$fixtures" --output "$RUNNER_TEMP/innoextract-fixture-results"

printf 'KAYAN_INNOEXTRACT=%s\n' "$extractor" >> "$GITHUB_ENV"
printf 'KAYAN_INNOEXTRACT_SHA256=%s\n' "$extractor_sha256" >> "$GITHUB_ENV"
