import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A check constraint is a promise the database makes about the rows the code
 * writes. When the two disagree the row is refused at runtime, inside whatever
 * transaction wrote it, and a working feature answers 500.
 *
 * That is exactly what happened to stock transfers: the service has resolved
 * notifications with status `CLOSED` since the alert centre was written, and
 * its tests asserted `CLOSED`, but the table only allowed OPEN, READ and
 * ARCHIVED. Every review, approval, dispatch and receipt failed. Nothing caught
 * it because each test believed its own half.
 *
 * This reads the migration that creates the notification status constraint and
 * compares it with the statuses the service actually writes, so the next
 * widening or narrowing cannot drift apart quietly.
 */
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const SERVICE = join(process.cwd(), 'src', 'modules', 'notifications', 'notifications.service.ts');

/** The statuses in the newest constraint definition that names the column. */
function allowedStatusesFromMigrations(): string[] {
  let latest: string[] | null = null;
  for (const entry of readdirSync(MIGRATIONS).sort()) {
    const path = join(MIGRATIONS, entry, 'migration.sql');
    let sql: string;
    try {
      if (!statSync(path).isFile()) continue;
      sql = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (!sql.includes('notifications_status_check')) continue;
    const check = /notifications_status_check"?\s*\n?\s*CHECK\s*\(\s*"?status"?\s+IN\s*\(([^)]*)\)/i.exec(sql);
    if (!check) continue;
    latest = [...check[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
  }
  if (!latest) throw new Error('no notification status constraint found in migrations');
  return latest;
}

/** The statuses the service writes, not the ones it merely reads. */
function writtenStatuses(): Set<string> {
  const source = readFileSync(SERVICE, 'utf8');
  const written = new Set<string>();
  // status: 'X'  /  status: 'X',  — the value assigned to a row
  for (const match of source.matchAll(/status:\s*'([A-Z_]+)'/g)) written.add(match[1]);
  // data: { status: 'X' } already covered above; also `status: cond ? 'A' : 'B'`
  for (const match of source.matchAll(/\?\s*'([A-Z_]+)'\s*:\s*'([A-Z_]+)'/g)) {
    written.add(match[1]);
    written.add(match[2]);
  }
  return written;
}

describe('the notification status the code writes is the one the database allows', () => {
  it('allows every status the service assigns', () => {
    const allowed = new Set(allowedStatusesFromMigrations());
    const written = [...writtenStatuses()].filter((status) =>
      // These are enum values of other columns (severity, invoice status) that
      // share the `status:` key; only notification states matter here.
      ['OPEN', 'READ', 'ARCHIVED', 'CLOSED'].includes(status),
    );
    expect(written.sort()).toEqual([...written].sort());
    for (const status of written) {
      expect({ status, allowed: allowed.has(status) }).toEqual({ status, allowed: true });
    }
  });

  it('keeps CLOSED, because resolveEntity writes it when a fact stops being true', () => {
    const source = readFileSync(SERVICE, 'utf8');
    expect(source).toContain("status: 'CLOSED'");
    expect(allowedStatusesFromMigrations()).toContain('CLOSED');
  });

  it('still allows the states a person sets', () => {
    const allowed = allowedStatusesFromMigrations();
    expect(allowed).toContain('OPEN');
    expect(allowed).toContain('READ');
    expect(allowed).toContain('ARCHIVED');
  });
});
