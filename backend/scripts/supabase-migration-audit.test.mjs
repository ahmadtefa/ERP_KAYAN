import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { auditMigrationDirectory, auditMigrationSql } from './supabase-migration-audit.mjs';

test('rejects role/database DDL, destructive SQL, extension creation, and bypass features', () => {
  const samples = [
    'CREATE ROLE app LOGIN;',
    'CREATE DATABASE kayan;',
    'DROP TABLE public.companies;',
    'ALTER TABLE public.items DROP COLUMN secret;',
    'CREATE EXTENSION pgcrypto;',
    'CREATE INDEX CONCURRENTLY idx ON public.items(id);',
    'CREATE FUNCTION public.f() RETURNS void SECURITY DEFINER LANGUAGE sql AS $$ SELECT 1 $$;',
    'CREATE EVENT TRIGGER anything ON ddl_command_end EXECUTE FUNCTION public.f();',
  ];
  for (const sql of samples) {
    assert.ok(auditMigrationSql('fixture', sql).length > 0, `expected rejection: ${sql}`);
  }
});

test('rejects prose after a semicolon inside a line comment because Prisma splits it as SQL', () => {
  const broken = auditMigrationSql('fixture', '-- application is safe; this comment becomes raw SQL');
  assert.deepEqual(broken.map((item) => item.code), ['PRISMA_COMMENT_SEMICOLON_SPLIT']);
  assert.deepEqual(auditMigrationSql('fixture', '-- SELECT 1; -- SQL example comment'), []);
});

test('reviews every checked-in Prisma migration: clean and tenant RLS policies present', async () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const result = await auditMigrationDirectory(join(here, '..', 'prisma', 'migrations'));

  assert.equal(result.migrations.length, 71);
  assert.deepEqual(result.violations, []);
  // The tenant RLS policy migration closes the gap this used to record: at
  // least one checked-in migration now creates tenant policies, and the
  // audit's "CLOUD BLOCKER" warning must stay gone.
  assert.ok(result.policyMigrations >= 1);
  assert.ok(result.dataBackfills > 0);
});
