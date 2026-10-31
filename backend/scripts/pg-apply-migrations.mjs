/**
 * Applies the project's own prisma/migrations/*.sql files, in filename order,
 * to a REAL PostgreSQL server (the embedded native cluster started by
 * pg-embedded-server.mjs) through the standard pg driver.
 *
 * Why not `prisma migrate deploy`: the pinned WASM schema engine
 * (7.1.1-era, prisma 6.19.3) fails against PostgreSQL 18 catalogs with
 * "Column type 'name' could not be deserialized" while initialising its
 * _prisma_migrations bookkeeping table — a toolchain/version incompatibility,
 * not a defect in the project DDL. The migration SQL itself is executed
 * unchanged, so the resulting schema is the project's real schema.
 *
 * Usage: DATABASE_URL=... node scripts/pg-apply-migrations.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const migrationsDir = join('prisma', 'migrations');
const dirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();

let applied = 0;
for (const dir of dirs) {
  const sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
  await client.query(sql); // simple-query protocol runs the full multi-statement file
  applied += 1;
  console.log(`  applied ${dir}`);
}

const tables = await client.query(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
console.log(`\n${applied} migration files applied; ${tables.rows[0].n} public tables now exist`);
await client.end();
