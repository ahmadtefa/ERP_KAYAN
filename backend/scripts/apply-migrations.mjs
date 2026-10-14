// Applies the migrations in prisma/migrations, in order, without the Prisma
// schema engine.
//
// Why this exists: `prisma migrate deploy` needs the Prisma schema-engine
// binary, which the CLI downloads on first use. On a server with no internet
// access (an on-premise installation behind a firewall, an air-gapped test
// machine, this project's own offline CI container) that download cannot
// happen, and the command reports "N migrations found" and then does nothing.
//
// This script applies exactly the same files `prisma migrate deploy` would
// apply, records them in the same `_prisma_migrations` table, with the same
// SHA-256 checksum and the same naming, so the two are interchangeable: a
// database migrated by this script is reported as up to date by `migrate
// deploy`, and vice versa.
//
// Rules it follows, because databases hold real accounting data:
//   * never drops, never resets, never `db push`;
//   * each migration runs inside a transaction - a migration that fails
//     leaves the database exactly as it was;
//   * a migration already recorded is skipped, not re-run;
//   * a checksum that no longer matches the file on disk stops the run and
//     says which migration was edited after it was applied;
//   * a migration recorded in the database but missing from the folder stops
//     the run too: that database was built by a different branch.
//
// Usage:
//   DATABASE_URL=... node scripts/apply-migrations.mjs [--dry-run]

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const migrationsDir = join(backendDir, 'prisma', 'migrations');

const dryRun = process.argv.includes('--dry-run');

/// The same file the Prisma CLI reads, so `node scripts/apply-migrations.mjs`
/// behaves like `npx prisma migrate deploy` in a developer's terminal.
function loadEnvFile() {
  const file = join(backendDir, '.env');
  if (!existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(file);
    return;
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnvFile();
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('apply-migrations: DATABASE_URL is not set');
  process.exit(2);
}

if (!existsSync(migrationsDir)) {
  console.error(`apply-migrations: ${migrationsDir} does not exist`);
  process.exit(2);
}

/// Exactly what Prisma stores: the SHA-256 of the migration file's bytes.
function checksumOf(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

function migrationsOnDisk() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const file = join(migrationsDir, name, 'migration.sql');
      if (!existsSync(file)) {
        console.error(`apply-migrations: ${name} has no migration.sql`);
        process.exit(2);
      }
      const sql = readFileSync(file, 'utf8');
      return { name, sql, checksum: checksumOf(sql) };
    });
}

/// The table Prisma itself creates. The definition is repeated here so a
/// database this script migrates first is still readable by the Prisma CLI.
const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum            VARCHAR(64) NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
  )
`;

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(MIGRATIONS_TABLE);

    const { rows: applied } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at',
    );
    const appliedByName = new Map(applied.map((row) => [row.migration_name, row]));
    const onDisk = migrationsOnDisk();
    const diskNames = new Set(onDisk.map((m) => m.name));

    for (const row of applied) {
      if (!diskNames.has(row.migration_name)) {
        throw new Error(
          `the database has migration ${row.migration_name}, which is not in prisma/migrations. ` +
            'This database was built by a different branch of the project; refusing to continue.',
        );
      }
      const file = onDisk.find((m) => m.name === row.migration_name);
      if (file.checksum !== row.checksum) {
        throw new Error(
          `migration ${row.migration_name} has been edited after it was applied ` +
            `(checksum ${row.checksum} in the database, ${file.checksum} on disk). ` +
            'Migrations are append-only: add a new migration instead of editing this one.',
        );
      }
    }

    let appliedCount = 0;
    for (const migration of onDisk) {
      if (appliedByName.has(migration.name)) continue;
      if (dryRun) {
        console.log(`  would apply: ${migration.name}`);
        continue;
      }
      const id = randomUUID();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, now(), 1)`,
          [id, migration.checksum, migration.name],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${migration.name} failed: ${error.message}`);
      }
      appliedCount += 1;
      console.log(`  applied: ${migration.name}`);
    }

    if (appliedCount === 0 && !dryRun) {
      console.log('  database is up to date; nothing to apply');
    }
    if (dryRun) {
      const pending = onDisk.filter((m) => !appliedByName.has(m.name)).length;
      console.log(`  ${pending} pending, ${applied.length} already applied`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`apply-migrations: ${error.message}`);
  process.exit(1);
});
