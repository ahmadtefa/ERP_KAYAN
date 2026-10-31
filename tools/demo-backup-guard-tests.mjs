#!/usr/bin/env node
/**
 * Proves that a damaged backup cannot damage the company it is restored into.
 *
 * Every case below is the same file with one thing broken: unreadable JSON, a
 * format from a newer program, an unsupported table, a row that is not a row,
 * artwork whose bytes no longer match the digest recorded with it, a broken
 * foreign key near the end of the restore, a table the file forgot. None of them
 * may be accepted, and none of them may leave the company that already exists
 * half-replaced.
 *
 * The target must already hold the demo company: the point is to watch that
 * company survive each attempt byte for byte. The audit trail is compared apart
 * from the rest, because taking a copy of the books is itself recorded there.
 *
 *   KAYAN_TARGET_API=http://127.0.0.1:3112/api/v1 \
 *   KAYAN_FILE=demo-data/KAYAN-Demo-Company-Backup-v2.json \
 *     node tools/demo-backup-guard-tests.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGET = (process.env.KAYAN_TARGET_API ?? 'http://127.0.0.1:3112/api/v1').replace(/\/$/, '');
const FILE = resolve(process.env.KAYAN_FILE ?? 'demo-data/KAYAN-Demo-Company-Backup-v2.json');
const USERNAME = process.env.KAYAN_ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.KAYAN_ADMIN_PASSWORD ?? 'Nakheel@2026';

let failures = 0;
const lines = [];

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`;
  console.log(line);
  lines.push(line);
  return ok;
}

async function login() {
  const response = await fetch(`${TARGET}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const data = await response.json().catch(() => null);
  if (!data?.accessToken) {
    throw new Error(`Sign-in failed on ${TARGET}: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return data.accessToken;
}

async function download(token) {
  const response = await fetch(`${TARGET}/backup/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function restore(token, body, name = 'mutant.json') {
  const form = new FormData();
  form.append('file', new Blob([Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))], { type: 'application/json' }), name);
  const response = await fetch(`${TARGET}/backup/restore?replace=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json().catch(() => null) : await response.text();
  return { status: response.status, data };
}

/// Everything except the history: the audit trail grows every time the file is
/// downloaded, so comparing it would compare the test's own footprint.
function businessShape(buffer) {
  const parsed = JSON.parse(buffer.toString('utf8'));
  const tables = {};
  for (const [model, rows] of Object.entries(parsed.tables ?? {})) {
    if (model === 'auditLog') continue;
    const list = Array.isArray(rows) ? rows : [];
    tables[model] = list
      .map((row) => {
        const copy = { ...row };
        delete copy.companyId;
        if (model === 'user') {
          for (const field of ['lastLoginAt', 'updatedAt', 'createdAt']) delete copy[field];
        }
        return JSON.stringify(copy, Object.keys(copy).sort());
      })
      .sort();
  }
  return {
    counts: Object.fromEntries(Object.entries(tables).map(([model, rows]) => [model, rows.length])),
    digest: createHash('sha256').update(JSON.stringify(tables)).digest('hex'),
    auditRows: (parsed.tables?.auditLog ?? []).length,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const original = JSON.parse(readFileSync(FILE, 'utf8'));
  const token = await login();

  const initial = businessShape(await download(token));
  check(
    'the target holds the demo company before the attempts',
    (initial.counts.customer ?? 0) === 25 && (initial.counts.salesInvoice ?? 0) === 20,
    `customers ${initial.counts.customer}, sales invoices ${initial.counts.salesInvoice}`,
  );

  // Bring the target to exactly the file, so "the company was left unchanged"
  // means unchanged from the file rather than from whatever a previous run
  // happened to leave behind.
  const baseline = await restore(token, readFileSync(FILE), 'demo.json');
  check('the target can be brought to the file before the attempts', baseline.status < 300, `HTTP ${baseline.status}`);
  const before = businessShape(await download(token));

  const uuid = () => '00000000-0000-4000-8000-000000000000';

  const cases = [
    {
      name: 'unreadable JSON',
      body: Buffer.concat([readFileSync(FILE).subarray(0, 4096)]),
      expect: /not readable as a JSON|invalid JSON/i,
    },
    {
      name: 'a format from a newer program',
      body: { ...clone(original), version: 3 },
      expect: /newer version/i,
    },
    {
      name: 'a version that is not a version',
      body: { ...clone(original), version: 0 },
      expect: /newer version/i,
    },
    {
      name: 'a file that is not a KAYAN backup',
      body: { ...clone(original), format: 'another-program' },
      expect: /not a KAYAN backup/i,
    },
    {
      name: 'a table this program does not know',
      body: (() => {
        const file = clone(original);
        file.tables.payrollRegister = [{ id: uuid(), amount: '100' }];
        return file;
      })(),
      expect: /unsupported table/i,
    },
    {
      name: 'a table that is not a list of rows',
      body: (() => {
        const file = clone(original);
        file.tables.customer = { rows: file.tables.customer };
        return file;
      })(),
      expect: /must contain a list of rows/i,
    },
    {
      name: 'a row that is not a row',
      body: (() => {
        const file = clone(original);
        file.tables.customer[0] = 42;
        return file;
      })(),
      expect: /must be a JSON object/i,
    },
    {
      name: 'artwork that lost its base64 marker',
      body: (() => {
        const file = clone(original);
        file.tables.quotationBackground[0].data = 'not-base64-any-more';
        return file;
      })(),
      expect: /missing its base64 marker/i,
    },
    {
      name: 'artwork whose bytes no longer match its digest',
      body: (() => {
        const file = clone(original);
        const artwork = file.tables.quotationBackground[0];
        const filler = artwork.data.slice('base64:'.length);
        // Same length, one different character: only the digest can tell.
        artwork.data = `base64:${filler.slice(0, 40)}${filler[40] === 'A' ? 'B' : 'A'}${filler.slice(41)}`;
        return file;
      })(),
      expect: /does not match the digest|but the row says/i,
    },
    {
      name: 'a broken relation in an invoice line',
      body: (() => {
        const file = clone(original);
        file.tables.salesInvoiceLine[0].invoiceId = uuid();
        return file;
      })(),
      expect: /names a record|foreign key|constraint|not found|violat/i,
    },
    {
      name: 'a broken relation late in the restore (journal line)',
      body: (() => {
        const file = clone(original);
        file.tables.journalLine[file.tables.journalLine.length - 1].journalEntryId = uuid();
        return file;
      })(),
      expect: /names a record|foreign key|constraint|not found|violat/i,
    },
    {
      name: 'a table the file forgot, while the company holds rows in it',
      body: (() => {
        const file = clone(original);
        delete file.tables.printPriceSetting;
        return file;
      })(),
      expect: /missing tables/i,
    },
    {
      name: 'a file with no company identity',
      body: (() => {
        const file = clone(original);
        delete file.companyId;
        delete file.companyCode;
        return file;
      })(),
      expect: /missing its company identity/i,
    },
    {
      name: 'a backup of a different company',
      body: { ...clone(original), companyCode: 'SOMEONE-ELSE', companyId: uuid() },
      expect: /belongs to another company/i,
    },
  ];

  for (const testCase of cases) {
    const response = await restore(token, testCase.body, 'damaged.json');
    const detail = String(
      response.data?.detail ?? response.data?.message ?? response.data?.error ?? JSON.stringify(response.data),
    ).slice(0, 160);
    check(
      `${testCase.name} is refused`,
      response.status >= 400 && testCase.expect.test(detail),
      `HTTP ${response.status}, ${detail}`,
    );

    const after = businessShape(await download(token));
    check(
      `${testCase.name} leaves the company exactly as it was`,
      after.digest === before.digest,
      after.digest === before.digest ? '' : `digest ${before.digest.slice(0, 12)} → ${after.digest.slice(0, 12)}`,
    );
  }

  // And the same file, undamaged, still restores over itself: the guards above
  // must not have made the real thing impossible.
  const control = await restore(token, readFileSync(FILE), 'demo.json');
  check('the undamaged file still restores over the same company', control.status < 300, `HTTP ${control.status}`);
  const afterControl = businessShape(await download(token));
  check(
    'restoring the file over itself changes no business row',
    afterControl.digest === before.digest,
    afterControl.digest === before.digest ? '' : 'the second restore produced different rows',
  );

  console.log(`\n${lines.filter((line) => line.startsWith('PASS')).length} checks passed, ${failures} failed.`);
  if (failures > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`\nGUARD TESTS FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error) console.error(error.stack?.split('\n').slice(0, 5).join('\n'));
  process.exitCode = 1;
}
