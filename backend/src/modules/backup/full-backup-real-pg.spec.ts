/**
 * Real-PostgreSQL round trip for the DUMP backup: take one, verify it, damage
 * the database, restore it, and compare tables, rows and relations.
 *
 * This test is honest about its environment: it runs only when
 * KAYAN_REAL_PG_TESTS=1 and DATABASE_URL_KAYAN_ROUNDTRIP points at a server
 * where an isolated database may be created and dropped. It creates its own
 * database (`kayan_roundtrip_test`) and removes it afterwards. Nothing here
 * touches any other database.
 */
import { Client } from 'pg';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { MaintenanceService } from '../../common/maintenance/maintenance';
import { FullBackupService } from './full-backup.service';

const RUN = process.env.KAYAN_REAL_PG_TESTS === '1';
const SERVER_URL = process.env.DATABASE_URL_KAYAN_ROUNDTRIP ?? '';

(RUN ? describe : describe.skip)('DUMP restore round trip on real PostgreSQL', () => {
  jest.setTimeout(180_000);

  const dbUrl = (name: string) => {
    const url = new URL(SERVER_URL);
    url.pathname = `/${name}`;
    return url.toString();
  };

  const sql = async (statement: string, database = 'kayan_roundtrip_test') => {
    const client = new Client({ connectionString: dbUrl(database) });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end().catch(() => {});
    }
  };

  const query = async (statement: string, database = 'kayan_roundtrip_test') => {
    const client = new Client({ connectionString: dbUrl(database) });
    await client.connect();
    try {
      const result = await client.query(statement);
      return result.rows;
    } finally {
      await client.end().catch(() => {});
    }
  };

  let dir: string;
  let service: FullBackupService;

  beforeAll(async () => {
    if (!SERVER_URL) throw new Error('DATABASE_URL_KAYAN_ROUNDTRIP is required');
    // A fresh, isolated database that exists only for this test.
    await sql('DROP DATABASE IF EXISTS kayan_roundtrip_test WITH (FORCE)', 'postgres');
    await sql('CREATE DATABASE kayan_roundtrip_test', 'postgres');
    await sql(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        total NUMERIC(12,2) NOT NULL
      );
      INSERT INTO customers (id, name) VALUES (1, 'أحمد'), (2, 'Sara');
      INSERT INTO invoices (id, customer_id, total) VALUES (10, 1, 150.75), (11, 2, 99.00);
    `);

    dir = mkdtempSync(join(tmpdir(), 'kayan-roundtrip-'));
    process.env.KAYAN_BACKUP_DIR = dir;
    process.env.DATABASE_URL = dbUrl('kayan_roundtrip_test');

    const prisma = {
      $executeRawUnsafe: async (statement: string) => {
        await sql(statement);
        return 0;
      },
      backupRun: {
        create: jest.fn(async () => ({})),
        findFirst: jest.fn(async () => null),
      },
      user: { count: jest.fn(async () => 0) },
    };
    const audit = {
      record: jest.fn(async () => undefined),
      recordRequired: jest.fn(async () => undefined),
    };
    const licensing = { reconcile: jest.fn(async () => undefined) };
    service = new FullBackupService(
      prisma as never,
      audit as never,
      new MaintenanceService(),
      licensing as never,
    );
    const internals = service as unknown as { [key: string]: jest.Mock };
    // The application-level steps after the database is replaced are stubbed:
    // this test proves the PostgreSQL pipeline, not the licence engine.
    jest.spyOn(internals, 'postRestoreCheck').mockResolvedValue({ ok: true, detail: '' });
    jest.spyOn(internals, 'reconcileRestoredCompanies').mockResolvedValue({ companies: 0 });
  });

  afterAll(async () => {
    await sql('DROP DATABASE IF EXISTS kayan_roundtrip_test WITH (FORCE)', 'postgres').catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });

  it('restores the database exactly as it was, across real damage', async () => {
    // 1. Take one and verify the archive.
    const { file } = await service.createFull('round-trip-test');
    expect(file.name).toMatch(/\.dump$/);
    const verification = await service.verify(file.name);
    expect(verification.entries).toBeGreaterThan(0);
    expect(verification.tables).toBeGreaterThanOrEqual(2);
    expect(verification.constraints).toBeGreaterThanOrEqual(2);

    // 2. Damage the database the way an accident would.
    await sql('DROP TABLE invoices');
    await sql('DELETE FROM customers');
    await sql("INSERT INTO customers (id, name) VALUES (42, 'ghost')");
    expect(await query('SELECT count(*)::int AS n FROM customers')).toEqual([{ n: 1 }]);

    // 3. Put the backup back — from the list on the server.
    const result = await service.restore({ confirm: true, fileName: file.name }, 'round-trip-test');
    expect(result).toMatchObject({
      restored: true,
      checked: true,
      rehearsed: true,
      fullRestore: false,
      includesExternalFiles: false,
      includesLicence: false,
      licenceReconciled: true,
    });

    // 4. Compare: tables, rows, relations.
    const customers = await query('SELECT id, name FROM customers ORDER BY id');
    expect(customers).toEqual([
      { id: 1, name: 'أحمد' },
      { id: 2, name: 'Sara' },
    ]);
    const invoices = await query('SELECT id, customer_id, total FROM invoices ORDER BY id');
    expect(invoices).toHaveLength(2);
    expect(Number((invoices[1] as { total: string }).total)).toBe(99);
    const relations = await query(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'",
    );
    expect(Number((relations[0] as { n: number }).n)).toBeGreaterThanOrEqual(1);

    // 5. The protective copy exists on disk.
    expect(existsSync(join(dir, file.name))).toBe(true);
  });

  it('refuses a corrupt archive before touching the database', async () => {
    const before = await query('SELECT count(*)::int AS n FROM customers');
    const garbage = join(dir, 'kayan-full-garbage-1.dump');
    const { writeFileSync } = await import('fs');
    writeFileSync(garbage, 'this is not a dump');
    await expect(
      service.restore({ confirm: true, fileName: 'kayan-full-garbage-1.dump' }, 'round-trip-test'),
    ).rejects.toThrow();
    expect(await query('SELECT count(*)::int AS n FROM customers')).toEqual(before);
  });
});
