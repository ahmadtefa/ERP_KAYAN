import {
  SYSTEM_BACKUP_FORMAT,
  SYSTEM_BACKUP_VERSION,
  checksumTextFor,
  manifestFileEntries,
  parseChecksums,
  sanitiseLicence,
  serialiseChecksums,
  validateManifestShape,
  type SystemBackupManifest,
} from './manifest';

function manifest(overrides: Partial<SystemBackupManifest> = {}): SystemBackupManifest {
  return {
    format: SYSTEM_BACKUP_FORMAT,
    version: SYSTEM_BACKUP_VERSION,
    createdAt: '2026-11-19T10:00:00.000Z',
    appVersion: '0.1.0',
    nodeVersion: 'v22.0.0',
    platform: 'linux-x64',
    kind: 'full',
    database: {
      engine: 'postgresql',
      serverVersion: '17.4',
      databaseName: 'kayan',
      dumpPath: 'database/database.dump',
      dumpBytes: 10,
      dumpSha256: 'a'.repeat(64),
      archiveEntries: 120,
      prisma: { appliedMigrations: 46, lastMigration: '20261024120000_x' },
    },
    files: {
      root: 'files/uploads',
      count: 1,
      totalBytes: 3,
      entries: [{ path: 'files/uploads/logo.png', bytes: 3, sha256: 'b'.repeat(64) }],
    },
    settings: { path: 'settings/settings.json', bytes: 2, sha256: 'c'.repeat(64) },
    licence: {
      statePath: '/var/kayan/licence.json',
      archivePath: 'licence/licence-state.json',
      archiveSha256: 'd'.repeat(64),
      sha256: 'e'.repeat(64),
      present: true,
      status: 'active',
      expiresAt: '2030-01-01',
      machineFingerprint: '0123456789abcdef',
      withheld: ['privateKey'],
    },
    extras: [{ path: 'licence/licence-state.json', bytes: 5, sha256: 'd'.repeat(64) }],
    checksums: { algorithm: 'sha256', file: 'checksums.sha256', entries: 5 },
    counts: {
      companies: 1,
      users: 2,
      accounts: 10,
      journalEntries: 3,
      items: 4,
      customers: 5,
      suppliers: 6,
      stockBalances: 7,
    },
    ...overrides,
  };
}

describe('system backup manifest', () => {
  it('produces a checksum file sha256sum can read, sorted by path', () => {
    const text = serialiseChecksums([
      { path: 'settings/settings.json', bytes: 2, sha256: 'c'.repeat(64) },
      { path: 'database/database.dump', bytes: 10, sha256: 'a'.repeat(64) },
    ]);
    expect(text.split('\n').filter(Boolean)).toEqual([
      `${'a'.repeat(64)}  database/database.dump`,
      `${'c'.repeat(64)}  settings/settings.json`,
    ]);
    expect([...parseChecksums(text).keys()]).toEqual([
      'database/database.dump',
      'settings/settings.json',
    ]);
  });

  it('refuses a checksum list it cannot read, and one that repeats a file', () => {
    expect(() => parseChecksums('not-a-checksum file.dump')).toThrow(/cannot read/);
    expect(() => parseChecksums('')).toThrow(/empty/);
    expect(() =>
      parseChecksums(`${'a'.repeat(64)}  same\n${'b'.repeat(64)}  same\n`),
    ).toThrow(/twice/);
  });

  it('covers the database, the settings, the extras and every file', () => {
    const entries = manifestFileEntries(manifest());
    expect(entries.map((entry) => entry.path)).toEqual([
      'database/database.dump',
      'settings/settings.json',
      'licence/licence-state.json',
      'files/uploads/logo.png',
    ]);
    expect(parseChecksums(checksumTextFor(manifest())).size).toBe(4);
  });

  it('accepts a manifest this version wrote and refuses a newer format', () => {
    expect(validateManifestShape(manifest()).format).toBe(SYSTEM_BACKUP_FORMAT);
    expect(() =>
      validateManifestShape(manifest({ version: SYSTEM_BACKUP_VERSION + 1 })),
    ).toThrow(/newer version of the program/);
    expect(() => validateManifestShape({ format: 'something-else' })).toThrow(
      /not a KAYAN system backup/,
    );
    expect(() => validateManifestShape(null)).toThrow(/no readable manifest/);
  });

  it('refuses a manifest that would let a restore start without a dump', () => {
    expect(() =>
      validateManifestShape(
        manifest({
          database: { ...manifest().database, dumpSha256: 'not-a-hash' },
        }),
      ),
    ).toThrow(/does not describe a PostgreSQL dump properly/);
  });
});

describe('licence sanitisation', () => {
  it('keeps the facts a restore needs and drops every secret', () => {
    const sanitised = sanitiseLicence({
      status: 'active',
      expiresAt: '2030-12-31',
      edition: 'professional',
      signature: 'SECRET-SIGNATURE',
      privateKey: 'SECRET-KEY',
      nested: { signingKey: 'SECRET-NESTED', token: 'SECRET-TOKEN' },
      machine: { hostname: 'kayan-pc' },
    });

    expect(sanitised.status).toBe('active');
    expect(sanitised.expiresAt).toBe('2030-12-31');
    expect(sanitised.fields['edition']).toBe('professional');
    expect(sanitised.fields['machine.hostname']).toBe('kayan-pc');
    expect(sanitised.withheld).toEqual(
      expect.arrayContaining(['signature', 'privateKey', 'nested.signingKey', 'nested.token']),
    );

    const written = JSON.stringify(sanitised);
    expect(written).not.toContain('SECRET');
  });

  it('turns a boolean licence into a status instead of guessing', () => {
    expect(sanitiseLicence({ valid: true }).status).toBe('active');
    expect(sanitiseLicence({ valid: false }).status).toBe('invalid');
    expect(sanitiseLicence({ something: 1 }).status).toBeNull();
  });

  it('does not treat an unreadable file as an active licence', () => {
    expect(sanitiseLicence(null).status).toBeNull();
  });
});
