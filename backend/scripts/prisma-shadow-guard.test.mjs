// Unit tests for the shadow-database guard. No database and no Prisma engine:
// these decide whether a shadow configuration is even allowed to exist, so they
// must be fast enough to run on every change.
//
//   node --test scripts/prisma-shadow-guard.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SHADOW_REFUSAL,
  ShadowDatabaseRefused,
  assertSafeShadowDatabase,
  evaluateShadowNetwork,
  evaluateShadowUrls,
  parseDatabaseUrl,
} from './prisma-shadow-guard.mjs';

const LIVE = 'postgresql://erp_app:secret@db.internal:5432/erp_kayan?schema=public';

/** Assert that a configuration is refused with the expected code. */
async function refused(expectedCode, options, resolve) {
  await assert.rejects(
    () =>
      assertSafeShadowDatabase({
        ...options,
        ...(resolve ? { resolve } : {}),
      }),
    (error) => {
      assert.ok(
        error instanceof ShadowDatabaseRefused,
        `expected ShadowDatabaseRefused, got ${error?.name}: ${error?.message}`,
      );
      assert.equal(error.code, expectedCode, error.message);
      return true;
    },
  );
}

const always = (addresses) => async () => addresses;

test('refuses when no shadow database is configured', async () => {
  await refused(SHADOW_REFUSAL.MISSING, { databaseUrl: LIVE, shadowUrl: '' });
  await refused(SHADOW_REFUSAL.MISSING, { databaseUrl: LIVE });
});

test('refuses the live URL used as the shadow URL', async () => {
  await refused(SHADOW_REFUSAL.SAME_URL, {
    databaseUrl: LIVE,
    shadowUrl: LIVE,
  });
  // Same database, spelled differently: default port omitted, host lower-cased.
  await refused(SHADOW_REFUSAL.SAME_URL, {
    databaseUrl: LIVE,
    shadowUrl: 'postgresql://erp_app:other@DB.INTERNAL/erp_kayan?schema=public',
  });
});

test('refuses a different schema on the same server and database', async () => {
  // A schema parameter is not an isolation boundary.
  await refused(SHADOW_REFUSAL.SAME_SERVER, {
    databaseUrl: LIVE,
    shadowUrl: 'postgresql://erp_app:secret@db.internal:5432/erp_kayan?schema=shadow',
  });
});

test('refuses a different database name on the same server', async () => {
  // The shadow engine can DROP/CREATE databases on that server, so a second
  // database name is not isolation.
  await refused(SHADOW_REFUSAL.SAME_HOST_PORT, {
    databaseUrl: LIVE,
    shadowUrl: 'postgresql://postgres:secret@db.internal:5432/postgres',
  });
});

test('refuses two names that resolve to the same address on the same port', async () => {
  // The case a URL comparison cannot catch: shadow.example.com is an alias for
  // the same machine as db.internal.
  const resolve = async (host) =>
    host === 'db.internal' || host === 'shadow.example.com'
      ? ['10.0.0.5']
      : ['10.0.0.9'];
  await refused(
    SHADOW_REFUSAL.SAME_ADDRESS,
    {
      databaseUrl: LIVE,
      shadowUrl: 'postgresql://postgres:secret@shadow.example.com:5432/shadow_db',
    },
    resolve,
  );
});

test('refuses when the shadow host cannot be resolved', async () => {
  const resolve = async () => {
    const error = new Error('getaddrinfo ENOTFOUND');
    error.code = 'ENOTFOUND';
    throw error;
  };
  await refused(
    SHADOW_REFUSAL.UNRESOLVABLE,
    {
      databaseUrl: LIVE,
      shadowUrl: 'postgresql://postgres:secret@onedrive-typo.internal:5432/shadow',
    },
    resolve,
  );
});

test('refuses a URL that is not PostgreSQL or not parseable', async () => {
  await refused(SHADOW_REFUSAL.NOT_POSTGRES, {
    databaseUrl: LIVE,
    shadowUrl: 'mysql://postgres:secret@shadow.internal:3306/shadow',
  });
  // A scheme-less "host:port/db" is parsed as the scheme "shadow.internal:" - it
  // is refused as a non-PostgreSQL URL, which is the point: it is never guessed at.
  await refused(SHADOW_REFUSAL.NOT_POSTGRES, {
    databaseUrl: LIVE,
    shadowUrl: 'shadow.internal:5432/shadow',
  });
  await refused(SHADOW_REFUSAL.UNPARSEABLE, {
    databaseUrl: LIVE,
    shadowUrl: 'postgresql://postgres:secret@shadow.internal:5432/',
  });
});

test('accepts a shadow on a separate server', async () => {
  const shadow = await assertSafeShadowDatabase({
    databaseUrl: LIVE,
    shadowUrl: 'postgresql://postgres:secret@shadow.internal:5433/kayan_shadow',
    resolve: always(['10.0.0.9']),
  });
  assert.equal(shadow.host, 'shadow.internal');
  assert.equal(shadow.port, '5433');
  assert.equal(shadow.database, 'kayan_shadow');
});

test('a second port on the same host is a separate PostgreSQL instance', async () => {
  const { shadow } = evaluateShadowUrls({
    databaseUrl: LIVE,
    shadowUrl: 'postgresql://postgres:secret@db.internal:5433/kayan_shadow',
  });
  // Same address, different port: a different listener, so a different server.
  await evaluateShadowNetwork({
    live: parseDatabaseUrl(LIVE, 'DATABASE_URL'),
    shadow,
    resolve: async () => ['10.0.0.5'],
  });
});

test('refuses an empty or malformed live URL', async () => {
  await refused(SHADOW_REFUSAL.UNPARSEABLE, {
    databaseUrl: '',
    shadowUrl: 'postgresql://postgres:secret@shadow.internal:5432/shadow',
  });
  await refused(SHADOW_REFUSAL.UNPARSEABLE, {
    databaseUrl: 'not a url',
    shadowUrl: 'postgresql://postgres:secret@shadow.internal:5432/shadow',
  });
});

test('credentials never appear in a refusal message', async () => {
  const secret = 'super-secret-password-123';
  try {
    evaluateShadowUrls({
      databaseUrl: `postgresql://erp_app:${secret}@db.internal:5432/erp_kayan`,
      shadowUrl: `postgresql://postgres:${secret}@db.internal:5432/erp_kayan`,
    });
    assert.fail('expected the configuration to be refused');
  } catch (error) {
    assert.equal(error.code, SHADOW_REFUSAL.SAME_URL);
    assert.ok(!error.message.includes(secret), error.message);
  }
});
