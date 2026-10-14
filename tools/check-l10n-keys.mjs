#!/usr/bin/env node
/**
 * The localizations, checked without the Flutter SDK.
 *
 * `flutter analyze` cannot even start until the SDK is installed, so the two
 * mistakes that are cheapest to make and most annoying to find - a screen that
 * asks for a translation that does not exist, and an English file that has
 * drifted away from the Arabic one - are caught here instead. It reads the
 * sources, which takes a moment and needs nothing but Node.
 *
 * What it checks:
 *   - every `l10n.<name>` used in lib/ is a key in app_en.arb;
 *   - app_en.arb and app_ar.arb have exactly the same keys, and no empty
 *     translation on either side;
 *   - every key in the ARB files is present in the generated Dart, either as
 *     `String get <key>;` or as a method when the message has placeholders
 *     (`{account}`, `{file}`, ...), in both the English and the Arabic file.
 *
 * Usage: node tools/check-l10n-keys.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const problems = [];

const read = (path) => readFileSync(join(root, path), 'utf8');
const en = JSON.parse(read('lib/l10n/app_en.arb'));
const ar = JSON.parse(read('lib/l10n/app_ar.arb'));

const keysOf = (arb) => Object.keys(arb).filter((key) => !key.startsWith('@'));
const enKeys = keysOf(en);
const arKeys = keysOf(ar);

// ---------------------------------------------------------------- ARB vs ARB
for (const key of enKeys) {
  if (!arKeys.includes(key)) problems.push(`app_ar.arb is missing "${key}"`);
}
for (const key of arKeys) {
  if (!enKeys.includes(key)) problems.push(`app_en.arb is missing "${key}"`);
}
for (const key of enKeys) {
  if (typeof en[key] !== 'string' || en[key].trim() === '') {
    problems.push(`app_en.arb has an empty translation for "${key}"`);
  }
  if (typeof ar[key] !== 'string' || ar[key].trim() === '') {
    problems.push(`app_ar.arb has an empty translation for "${key}"`);
  }
}

// ------------------------------------------------------- ARB vs generated Dart
const abstract = read('lib/l10n/generated/app_localizations.dart');
const english = read('lib/l10n/generated/app_localizations_en.dart');
const arabic = read('lib/l10n/generated/app_localizations_ar.dart');

const declares = (source, key) =>
  new RegExp(`\\b(String get ${key};|\\b${key}\\()`).test(source) ||
  source.includes(`String ${key}(`);
const implementsKey = (source, key) =>
  new RegExp(`\\b(String get ${key} =>|String ${key}\\()`).test(source);

for (const key of enKeys) {
  if (!declares(abstract, key)) {
    problems.push(`app_localizations.dart does not declare "${key}"`);
  }
  if (!implementsKey(english, key)) {
    problems.push(`app_localizations_en.dart does not implement "${key}"`);
  }
  if (!implementsKey(arabic, key)) {
    problems.push(`app_localizations_ar.dart does not implement "${key}"`);
  }
}

// --------------------------------------------------- the keys screens ask for
function dartFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'generated') continue;
      found.push(...dartFiles(path));
      continue;
    }
    if (entry.endsWith('.dart')) found.push(path);
  }
  return found;
}

// Some labels are extension methods on AppLocalizations rather than keys -
// `accountTypeLabel`, for instance. They are declared in lib/shared/extensions,
// so the names defined there are accepted as well.
const extensionNames = new Set();
for (const file of dartFiles(join(root, 'lib/shared/extensions'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bString\s+([A-Za-z][A-Za-z0-9]*)\s*\(/g)) {
    if (match[1] !== 'get') extensionNames.add(match[1]);
  }
}

let used = 0;
for (const file of dartFiles(join(root, 'lib'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bl10n\.([A-Za-z][A-Za-z0-9]*)/g)) {
    used += 1;
    const key = match[1];
    if (!enKeys.includes(key) && !extensionNames.has(key)) {
      problems.push(`${relative(root, file)} uses l10n.${key}, which is not in app_en.arb`);
    }
  }
}

if (problems.length > 0) {
  console.error(`l10n check failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `l10n check passed: ${enKeys.length} keys in both languages, ` +
    `${used} usages in the sources, every key present in the generated files.`,
);
