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

test('reviews every checked-in Prisma migration and records the RLS policy gap', async () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const result = await auditMigrationDirectory(join(here, '..', 'prisma', 'migrations'));

  assert.equal(result.migrations.length, 70);
  assert.deepEqual(result.violations, []);
  assert.equal(result.policyMigrations, 0);
  assert.ok(result.dataBackfills > 0);
});
