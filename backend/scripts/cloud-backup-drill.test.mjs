// Behavior tests for the backup/drill security helpers: ssl-mode URL params
// cannot weaken TLS, Supabase hosts require the pinned CA (fail closed), and
// the restore drill refuses any non-loopback admin URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripSslParams, assertLoopbackAdminUrl, tlsEnvForUrl } from './cloud-backup-drill.mjs';

test('stripSslParams removes ssl parameters so they cannot override verified TLS', () => {
  const out = stripSslParams('postgresql://u:p@db.supabase.co:5432/postgres?sslmode=disable&sslrootcert=/x&application_name=a');
  assert.ok(!/ssl/i.test(out), 'no ssl parameter may survive');
  assert.ok(out.includes('application_name=a'), 'unrelated parameters are preserved');
});

test('assertLoopbackAdminUrl refuses remote hosts (a drill can never touch Supabase)', () => {
  assert.throws(() => assertLoopbackAdminUrl('postgresql://u:p@db.supabase.co:5432/postgres'), /loopback/);
  assert.throws(() => assertLoopbackAdminUrl('postgresql://u:p@10.0.0.5:5432/postgres'), /loopback/);
  const u = assertLoopbackAdminUrl('postgresql://u:p@127.0.0.1:5432/postgres');
  assert.equal(u.hostname, '127.0.0.1');
});

test('tlsEnvForUrl fails closed for Supabase hosts without a CA and verifies with one', () => {
  assert.throws(() => tlsEnvForUrl('postgresql://u:p@aws-1-eu-central-1.pooler.supabase.com:5432/postgres', {}), /SUPABASE_DB_CA_CERT/);
  const env = tlsEnvForUrl('postgresql://u:p@aws-1-eu-central-1.pooler.supabase.com:5432/postgres', {
    SUPABASE_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\nZZZ\n-----END CERTIFICATE-----',
  });
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.ok(env.PGSSLROOTCERT, 'writes a 0600 CA file for libpq');
  assert.deepEqual(tlsEnvForUrl('postgresql://u:p@127.0.0.1:5432/kayan_test', {}), {}, 'local PG keeps plain libpq defaults');
});
