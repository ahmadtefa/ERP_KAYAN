/**
 * Repairs `@prisma/adapter-pg` 6.19.3 so it can describe PostgreSQL's `name`
 * type, and with it make `prisma migrate deploy` work again.
 *
 * THE DEFECT (upstream, in the dependency — not in this project)
 * ---------------------------------------------------------------
 * `fieldToColumnType()` in `dist/index.mjs` maps every pg type OID the driver
 * adapter understands onto Prisma's `ColumnTypeEnum`. Its text branch lists
 * BPCHAR, TEXT, VARCHAR, BIT, VARBIT, INET, CIDR and XML — but not NAME
 * (OID 19). Anything not listed falls through to:
 *
 *     default:
 *       if (fieldTypeId >= FIRST_NORMAL_OBJECT_ID) return ColumnTypeEnum.Text;
 *       throw new UnsupportedNativeDataType(fieldTypeId);
 *
 * `name` is OID 19 and FIRST_NORMAL_OBJECT_ID is 16384, so a result set with a
 * `name` column throws `UnsupportedNativeDataType(19)`, which the schema engine
 * reports as:
 *
 *     Error: Column type 'name' could not be deserialized from the database.
 *
 * `PostgreSQL`'s `current_schema()` and `current_user` are declared `name`
 * (the 63-byte identifier type), so the schema engine's migration-persistence
 * `initialize()` — the step that creates/locks the `_prisma_migrations` table
 * before applying anything — fails on every server, every PostgreSQL version,
 * before a single migration is read. `prisma migrate status` does not call
 * `initialize()`, which is why it works while `migrate deploy` does not.
 *
 * WHY THIS IS THE CORRECT FIX AND NOT A BYPASS
 * --------------------------------------------
 * `name` is a text-compatible identifier type: pg-types parses it into a
 * JavaScript string, exactly like `text`. Classifying it as `ColumnTypeEnum.Text`
 * is what the mapping already does for every other textual type, and it is what
 * later adapter releases do. No SQL is rewritten, no migration is skipped, no
 * check is disabled — the driver simply stops refusing to read a type it can
 * already read.
 *
 * The patch is idempotent (running it twice changes nothing) and is verified
 * after writing: if the anchor text is missing the script fails loudly instead
 * of pretending to have patched something.
 *
 * Usage: node scripts/patch-adapter-pg-name-type.mjs [--check]
 *   --check  exit 1 if the patch is needed and absent, without writing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const checkOnly = process.argv.includes('--check');

let adapterEntry;
try {
  adapterEntry = require.resolve('@prisma/adapter-pg');
} catch {
  console.error('  adapter-pg patch: @prisma/adapter-pg is not installed; nothing to do');
  process.exit(checkOnly ? 1 : 0);
}

const distFile = join(dirname(adapterEntry), 'index.mjs');
const original = readFileSync(distFile, 'utf8');

/// The text branch of `fieldToColumnType`. OID 19 is inserted ahead of BPCHAR,
/// which is the first case of that branch, so the edit is anchored on a line
/// that only exists once.
const ANCHOR = '    case ScalarColumnType.BPCHAR:';
const PATCHED = `    // OID 19 'name': PostgreSQL's 63-byte identifier type. pg-types parses it
    // into a string exactly as it does 'text'; the upstream mapping simply
    // forgot it, which made every result set containing current_schema() or
    // current_user throw UnsupportedNativeDataType. Patched by
    // scripts/patch-adapter-pg-name-type.mjs.
    case 19:
${ANCHOR}`;

const already = original.includes('case 19:') && original.includes('OID 19 \'name\'');
if (already) {
  console.log('  adapter-pg patch: already applied');
  process.exit(0);
}

if (!original.includes(ANCHOR)) {
  console.error(
    `  adapter-pg patch: FAILED - anchor not found in ${distFile}\n` +
      '  The dependency layout changed. Re-check fieldToColumnType() before patching;',
  );
  console.error('  do NOT assume the defect is gone. prisma migrate deploy will still fail.');
  process.exit(1);
}

if (checkOnly) {
  console.error('  adapter-pg patch: NEEDED but not applied (--check)');
  process.exit(1);
}

const patched = original.replace(ANCHOR, PATCHED);

// Refuse to write a file that does not actually contain the fix.
if (!patched.includes('case 19:') || patched === original) {
  console.error('  adapter-pg patch: FAILED - replacement produced no change');
  process.exit(1);
}

writeFileSync(distFile, patched, 'utf8');

// Read it back: a patch that was not really written is worse than none.
const verify = readFileSync(distFile, 'utf8');
const count = (verify.match(/case 19:/g) ?? []).length;
if (count !== 1) {
  console.error(`  adapter-pg patch: FAILED - expected exactly one 'case 19:' after writing, found ${count}`);
  process.exit(1);
}

console.log(`  adapter-pg patch: applied to ${distFile}`);
