// Architecture gates for Prisma in this repository.
//
// These are cheap, static checks, and they exist because every one of them was
// broken at some point - each time in a way that only shows up as a migration
// failure on a real database:
//
//   * the migration path silently switched to Prisma's experimental JavaScript
//     schema engine, which then failed on PostgreSQL's own catalog types;
//   * `migrate dev` was one `npm run` away from operating on a company database
//     with no shadow-database proof at all;
//   * a deployment path used `prisma db push`, which rewrites a live database
//     instead of replaying reviewed SQL.
//
//   node --test scripts/prisma-architecture.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const read = (path) => readFileSync(join(backendDir, path), 'utf8');

test('the migration path uses Prisma 6 classic (native) only', () => {
  const config = read('prisma.config.ts');
  assert.match(
    config,
    /engine:\s*'classic'/,
    'prisma.config.ts must select the classic (native) schema engine for migrations',
  );
  assert.doesNotMatch(
    config,
    /engine:\s*'js'/,
    "the experimental JavaScript schema engine must not be selectable",
  );
  assert.doesNotMatch(
    config,
    /experimental:\s*\{\s*adapter/,
    'the adapter-backed schema engine is experimental and must not be enabled',
  );
  // No environment variable may switch engines: a release must migrate with the
  // engine that was tested.
  assert.doesNotMatch(
    config,
    /process\.env\.[A-Z_]*ENGINE/,
    'the schema engine must not be chosen by an environment variable',
  );
});

test('a shadow database needs an explicit, verified opt-in', () => {
  const config = read('prisma.config.ts');
  assert.match(
    config,
    /KAYAN_PRISMA_SHADOW_VERIFIED/,
    'prisma.config.ts must refuse a shadow URL that the guard has not verified',
  );
  assert.match(
    config,
    /KAYAN_PRISMA_SHADOW_DATABASE_URL/,
    'the shadow database must come from its own variable, never from DATABASE_URL',
  );
  assert.doesNotMatch(
    config,
    /shadowDatabaseUrl:\s*databaseUrl\b/,
    'the shadow database must never default to the live database URL',
  );
});

test('`prisma migrate dev` is only reachable through the guard', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(
    pkg.scripts['prisma:migrate'],
    'node scripts/migrate-dev-safe.mjs',
    'npm run prisma:migrate must run the shadow-database guard',
  );
  assert.equal(
    pkg.scripts['prisma:migrate:diff'],
    'node scripts/migrate-dev-safe.mjs diff',
    'npm run prisma:migrate:diff must run the shadow-database guard',
  );
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (name === 'prisma:migrate' || name === 'prisma:migrate:diff') continue;
    assert.doesNotMatch(
      command,
      /prisma\s+migrate\s+dev\b/,
      `script ${name} runs \`prisma migrate dev\` without the shadow guard`,
    );
    assert.doesNotMatch(
      command,
      /prisma\s+db\s+push\b/,
      `script ${name} runs \`prisma db push\`, which rewrites a live database`,
    );
  }
});

test('the client stays engine-less and adapter-driven', () => {
  const schema = read('prisma/schema.prisma');
  const generator = /generator\s+client\s*\{([\s\S]*?)\}/.exec(schema)?.[1] ?? '';
  assert.match(
    generator,
    /engineType\s*=\s*"client"/,
    'the shipped client must stay engine-less (engineType = "client")',
  );
  const service = read('src/common/prisma/prisma.service.ts');
  assert.match(
    service,
    /new PrismaPg\(/,
    'the client must be constructed with the pg driver adapter',
  );
});

test('no migration hides character/name catalog types behind a cast', () => {
  // The defect that once broke migrations was a failure to deserialize
  // PostgreSQL's `char`/`name` catalog columns. Rewriting those columns as text
  // would hide it and change nothing for a customer database, so the pattern is
  // banned outright.
  const dir = join(backendDir, 'prisma', 'migrations');
  const offenders = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sql = readFileSync(join(dir, entry.name, 'migration.sql'), 'utf8');
    const patterns = [
      /pg_catalog\.[a-z_]+\s*::\s*text/i,
      /\b(?:attname|attidentity|attstorage|relname|typname|relkind)\s*::\s*text/i,
    ];
    for (const pattern of patterns) {
      if (pattern.test(sql)) offenders.push(`${entry.name}: ${pattern}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `migrations cast catalog char/name columns to text: ${offenders.join(', ')}`,
  );
});

test('deployment paths replay migrations, never rewrite the schema', () => {
  for (const script of [
    'scripts/prepare-database.mjs',
    'scripts/migrate-deploy.mjs',
    'scripts/apply-migrations.mjs',
  ]) {
    const source = read(script);
    assert.doesNotMatch(
      source,
      /['"]db['"]\s*,\s*['"]push['"]/,
      `${script} must not run \`prisma db push\``,
    );
    assert.doesNotMatch(
      source,
      /\bmigrate\s+reset\b/,
      `${script} must never reset a database`,
    );
  }
  assert.match(
    read('scripts/migrate-deploy.mjs'),
    /'migrate',\s*'deploy'/,
    'the desktop preparer must apply migrations with `migrate deploy`',
  );
});
