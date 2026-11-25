// No-skip backend runner. Every spec file is executed on its own, with the
// exact flags it needs, and the file fails if ANY case is pending, todo or
// failed, or if no case ran. Files that need a database get a fresh database
// cloned from one migrated template, so no suite sees another suite's rows.
//
// Explicit scope boundaries (listed in the report, never silent):
//  * SIGNING_EXCLUDED: the 12 licence signing/store specs that need the
//    approved VM. They are not executed here.
//  * BRIDGE_SCOPE: files whose remaining cases are Flutter bridge cases. They
//    run without the bridge flag here (failures still fail) and their pending
//    count is recorded. The bridges are qualified by the separate bridge
//    workflow, not by this runner.
//
// Usage: DATABASE_ADMIN_URL=postgresql://u:p@host:port/postgres \
//        node scripts/noskip-backend-runner.mjs <out-dir> [substring-filter]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';

const backend = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] ?? 'noskip-out');
const filter = process.argv[3] ?? '';
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
mkdirSync(out, { recursive: true });

const SIGNING_EXCLUDED = new Set([
  'installed-corrupt-state-safety', 'license-corruption-recovery', 'license-generator', 'license-key',
  'license-proof', 'license-store', 'licensing-http-guard', 'licensing-key-replacement',
  'licensing-keyring-integration', 'licensing-upgrade-model', 'licensing.enforcement', 'licensing.service',
]);
const BRIDGE_FLAGS = ['KAYAN_STOCKDOC_LOCATION_UI', 'KAYAN_TRANSFER_LOCATION_UI', 'KAYAN_SALES_LOCATION_UI',
  'KAYAN_LOCATION_UI', 'KAYAN_COUNT_LOCATION_UI', 'KAYAN_PURCHASE_LOCATION_UI'];
const PG_FLAGS = ['KAYAN_MASTER_DATA_BACKUP_PG', 'KAYAN_COMPANY_BACKUP_PG', 'KAYAN_AUTH_PASSWORD_PG',
  'KAYAN_WAREHOUSE_ACCESS_PG', 'KAYAN_AUTH_SESSION_PG', 'KAYAN_BARRIER_PG', 'KAYAN_RATE_LIMIT_PG',
  'KAYAN_TX_LIFETIME_PG', 'KAYAN_DASHBOARD_PG', 'KAYAN_AGING_PG', 'KAYAN_APPROVALS_PG', 'KAYAN_REAL_PG_TESTS'];
// Only this suite needs a live company and user already present.
const SEEDED = new Set(['src/common/approvals/approvals.postgres.spec.ts']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.spec.ts')) acc.push(relative(backend, p));
  }
  return acc;
}
const all = walk(join(backend, 'src')).filter((f) => f.includes(filter));
const base = (f) => f.replace(/^.*\//, '').replace(/\.spec\.ts$/, '');
const signing = all.filter((f) => SIGNING_EXCLUDED.has(base(f)) && f.includes('/licensing/'));
const runnable = all.filter((f) => !signing.includes(f));
const needsDb = (f) => /DATABASE_URL|KAYAN_[A-Z_]*_PG\b|KAYAN_REAL_PG_TESTS/.test(readFileSync(join(backend, f), 'utf8'));
const bridgeScoped = (f) => BRIDGE_FLAGS.some((k) => readFileSync(join(backend, f), 'utf8').includes(k));

const u = new URL(adminUrl);
const dbUrl = (name) => { const x = new URL(adminUrl); x.pathname = `/${name}`; x.searchParams.set('schema', 'public'); return x.toString(); };
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query('DROP DATABASE IF EXISTS kayan_noskip_template WITH (FORCE)');
await admin.query('CREATE DATABASE kayan_noskip_template');
{
  const r = spawnSync(process.execPath, ['scripts/apply-migrations.mjs'], { cwd: backend, env: { ...process.env, DATABASE_URL: dbUrl('kayan_noskip_template') }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error('template migration failed'); }
}

const env0 = {
  ...process.env, NODE_ENV: 'test',
  NODE_OPTIONS: `--experimental-vm-modules --require=${resolve(backend, '../scripts/ci-no-signing.cjs')}`,
  JWT_ACCESS_SECRET: 'ci-only-access-secret-not-for-real-use-0123456789',
  JWT_REFRESH_SECRET: 'ci-only-refresh-secret-not-for-real-use-9876543210',
  JWT_ACCESS_TTL: '900', JWT_REFRESH_TTL: '604800',
  KAYAN_ADMIN_USERNAME: 'ci-admin', KAYAN_ADMIN_PASSWORD: process.env.KAYAN_ADMIN_PASSWORD ?? 'CI-only-Admin-Password-12345',
};
delete env0.DATABASE_URL;

const results = [];
let n = 0;
for (const f of runnable) {
  const id = f.replace(/[\/.]/g, '_');
  const db = needsDb(f);
  const bridge = bridgeScoped(f);
  const env = { ...env0 };
  let dbName = null;
  if (db) {
    dbName = 'erp_kayan_acceptance'; n++; // several suites refuse any other database name
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE kayan_noskip_template`);
    env.DATABASE_URL = dbUrl(dbName);
    for (const k of PG_FLAGS) env[k] = '1';
    env.DATABASE_URL_KAYAN_ROUNDTRIP = adminUrl;
    env.KAYAN_BACKUP_DIR = mkdtempSync(join(tmpdir(), 'kayan-noskip-bk-'));
    if (SEEDED.has(f)) {
      const s = spawnSync(process.execPath, ['dist/prisma/seed.js'], { cwd: backend, env, encoding: 'utf8' });
      if (s.status !== 0) { results.push({ file: f, verdict: 'FAIL', reason: 'seed failed' }); continue; }
    }
  }
  const jsonPath = join(out, `${id}.jest.json`);
  const r = spawnSync('npx', ['jest', '--runInBand', '--json', `--outputFile=${jsonPath}`, f], { cwd: backend, env, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(out, `${id}.log`), (r.stdout ?? '') + (r.stderr ?? ''));
  let verdict = 'FAIL'; let reason = 'no result';
  let j = null;
  if (existsSync(jsonPath)) {
    j = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const cases = (j.testResults ?? []).flatMap((s) => s.assertionResults ?? []);
    const bad = cases.filter((c) => c.status !== 'passed');
    if (r.status !== 0 || j.numFailedTests || j.numFailedTestSuites || j.numRuntimeErrorTestSuites) reason = 'failed cases or suites';
    else if (!j.numPassedTests) reason = 'no case ran';
    else if (j.numTodoTests) reason = 'todo cases';
    else if (j.numPendingTests && !bridge) reason = `${j.numPendingTests} pending/skipped`;
    else { verdict = j.numPendingTests ? 'PASS_BRIDGE_PENDING' : 'PASS'; reason = ''; }
    results.push({ file: f, verdict, reason, db, bridgeScoped: bridge, passed: j.numPassedTests, pending: j.numPendingTests, failed: j.numFailedTests,
      identities: cases.map((c) => `${c.status}\t${c.fullName}`) });
  } else results.push({ file: f, verdict, reason, db, bridgeScoped: bridge });
  console.log(`${verdict.padEnd(20)} ${f} ${reason}`);
  if (dbName) await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
}
await admin.query('DROP DATABASE IF EXISTS kayan_noskip_template WITH (FORCE)').catch(() => {});
await admin.end();
const sum = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0);
const report = {
  scope: 'Backend spec files executed one at a time with required flags; NOT full-product: signing/store specs and Flutter bridge cases are separate scopes.',
  filesDiscovered: all.length, filesExecuted: runnable.length, signingExcluded: signing,
  bridgePendingFiles: results.filter((r) => r.verdict === 'PASS_BRIDGE_PENDING').map((r) => ({ file: r.file, pending: r.pending })),
  passedCases: sum('passed'), pendingCases: sum('pending'), failedFiles: results.filter((r) => r.verdict === 'FAIL').map((r) => ({ file: r.file, reason: r.reason })),
  results,
};
writeFileSync(join(out, 'noskip-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ discovered: report.filesDiscovered, executed: report.filesExecuted, signing: signing.length, passedCases: report.passedCases, pendingCases: report.pendingCases, failedFiles: report.failedFiles.length }));
process.exitCode = report.failedFiles.length ? 1 : 0;
