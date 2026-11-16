import assert from 'node:assert/strict';
import test from 'node:test';
import { secureClientOptions } from './check-supabase-roles.mjs';

const connection =
  'postgresql://kayan_runtime.projectref:encoded@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/tmp/old-ca.crt';
const ca = '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----';

test('uses explicit CA validation and removes connection-string TLS overrides', () => {
  const options = secureClientOptions(connection, { SUPABASE_DB_CA_CERT: ca });
  assert.equal(options.ssl.ca, ca);
  assert.equal(options.ssl.rejectUnauthorized, true);
  const url = new URL(options.connectionString);
  assert.equal(url.searchParams.has('sslmode'), false);
  assert.equal(url.searchParams.has('sslrootcert'), false);
  assert.equal(url.hostname, 'aws-0-eu-central-1.pooler.supabase.com');
});

test('fails closed when the Supabase CA certificate is not provided', () => {
  assert.throws(() => secureClientOptions(connection, {}), /SUPABASE_DB_CA_CERT GitHub Secret is missing/);
});

test('rejects non-PEM CA material', () => {
  assert.throws(
    () => secureClientOptions(connection, { SUPABASE_DB_CA_CERT: 'not a certificate' }),
    /must contain a PEM encoded certificate/,
  );
});
