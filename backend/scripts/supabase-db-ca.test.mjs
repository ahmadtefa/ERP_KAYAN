// Pins the identity of the committed Supabase database root CA so the file
// cannot be silently replaced. Real content checks: subject/issuer, self-signed
// root, validity window, and SHA-256 fingerprint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CERT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'certs', 'supabase-prod-ca-2021.crt');
const PINNED_SHA256 = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';

test('committed Supabase root CA matches the pinned identity', () => {
  const pem = readFileSync(CERT_PATH, 'utf8');
  assert.match(pem, /-----BEGIN CERTIFICATE-----/);
  const cert = new X509Certificate(pem);
  assert.equal(cert.subject, cert.issuer, 'certificate must be its own (self-signed) root');
  assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
  assert.match(cert.subject, /O=Supabase Inc/);
  assert.equal(cert.fingerprint256, PINNED_SHA256, 'SHA-256 fingerprint changed - update the pin deliberately (see certs/README.md)');
  assert.ok(cert.ca, 'certificate must have the CA basic constraint');
  const now = Date.now();
  assert.ok(now >= Date.parse(cert.validFrom), 'certificate is not valid yet');
  assert.ok(now < Date.parse(cert.validTo), 'certificate expired');
});
