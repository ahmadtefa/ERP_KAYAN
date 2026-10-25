import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The licensing migration is additive: it creates four tables and records the
 * accounts that already exist as already-spent seats.
 *
 * This file checks the migration's text, which is what can be checked without
 * a PostgreSQL server. It proves that the statements which matter are there
 * and that none of the destructive ones are; it does not prove that the SQL
 * runs. That needs a real database and is recorded as an open item in the
 * licensing report.
 */

const sql = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261025120000_offline_licensing/migration.sql'),
  'utf8',
);

describe('the licensing migration', () => {
  it('creates the four tables the models map to', () => {
    for (const table of [
      'license_installations',
      'license_keys',
      'license_seat_usage',
      'license_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('makes a key id unique, which is what makes replay impossible', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "license_keys_keyId_key" ON "license_keys"\("keyId"\)/,
    );
  });

  it('makes an idempotency key unique, which is what makes retries free', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "license_seat_usage_idempotencyKey_key"/,
    );
  });

  it('keeps the seat ledger when the account it names is deleted', () => {
    // No foreign key to users, on purpose: the ledger outlives the account.
    expect(sql).not.toMatch(/FOREIGN KEY.*"users"/s);
    expect(sql).not.toMatch(/REFERENCES "users"/);
  });

  it('backfills every existing account exactly once', () => {
    expect(sql).toMatch(/INSERT INTO "license_seat_usage"/);
    expect(sql).toMatch(/FROM "users" u/);
    expect(sql).toMatch(/ON CONFLICT \("idempotencyKey"\) DO NOTHING/);
    // A stable per-user key, so running the migration twice adds nothing.
    expect(sql).toMatch(/'migration:' \|\| u\."id"::text/);
    expect(sql).toMatch(/'MIGRATION_EXISTING'/);
  });

  it('records those accounts with no licence id, to be adopted by the first activation', () => {
    const backfill = sql.slice(sql.indexOf('INSERT INTO "license_seat_usage"'));
    expect(backfill).not.toMatch(/"licenseId"/);
  });

  it('never deletes, disables or rewrites an existing account', () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/UPDATE\s+"users"/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"users"/i);
    expect(sql).not.toMatch(/"isActive"\s*=\s*false/i);
  });

  it('does not alter any table that existed before it', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/ADD\s+COLUMN/i);
  });
});
