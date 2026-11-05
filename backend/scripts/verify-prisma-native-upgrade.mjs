#!/usr/bin/env node
// Run only on a disposable GitHub-hosted runner with its isolated PostgreSQL
// service. This uses the standard native Prisma CLI, not the experimental JS
// schema engine, and exercises migration-history bookkeeping on upgrade.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Error('A disposable GitHub-hosted runner is required');
if (process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) throw new Error('Native Prisma engine overrides are forbidden in this proof');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const admin = new URL(process.env.KAYAN_TEST_ADMIN_URL ?? '');
if (admin.hostname !== '127.0.0.1' || admin.port !== '5432' || admin.pathname !== '/postgres') throw new Error('Expected the isolated CI PostgreSQL service');
const name = `kayan_upgrade_${randomBytes(8).toString('hex')}`;
const url = new URL(admin); url.pathname = `/${name}`; url.searchParams.set('schema', 'public');
const dir = mkdtempSync(join(tmpdir(), 'kayan-prisma-native-upgrade-'));
const oldPrisma = join(dir, 'prisma');
const config = join(root, `prisma-native-ci-${randomBytes(8).toString('hex')}.config.ts`);
const dbAdmin = new pg.Client({ connectionString: admin.toString() });
// Close fixture sessions before dropping the disposable database. Otherwise a
// query failure leaves a client open and DROP ... FORCE emits an unhandled
// 57P01 event, masking the actual migration or fixture error.
const fixtureClients = [];
function fixtureClient() {
  const client = new pg.Client({ connectionString: url.toString() });
  fixtureClients.push(client);
  return client;
}
let created = false;
const setupName = `kayan_setup_${randomBytes(8).toString('hex')}`;
const setupUrl = new URL(admin); setupUrl.pathname = `/${setupName}`; setupUrl.searchParams.set('schema', 'public');
let setupCreated = false;
function migrate(schema, targetUrl = url.toString()) {
  const env = { ...process.env, DATABASE_URL: targetUrl, KAYAN_NATIVE_CI_SCHEMA: schema };
  const cli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const child = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--config', config], { cwd: root, env, encoding: 'utf8' });
  if (child.status !== 0) throw new Error(`Native Prisma deploy failed: ${(child.stderr || child.stdout || '').slice(-3000).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]')}`);
}
try {
  await dbAdmin.connect();
  await dbAdmin.query(`CREATE DATABASE "${name}"`); created = true;
  mkdirSync(join(oldPrisma, 'migrations'), { recursive: true });
  cpSync(join(root, 'prisma', 'schema.prisma'), join(oldPrisma, 'schema.prisma'));
  cpSync(join(root, 'prisma', 'migrations', 'migration_lock.toml'), join(oldPrisma, 'migrations', 'migration_lock.toml'));
  const entries = readdirSync(join(root, 'prisma', 'migrations'), { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort();
  const old = entries.filter(x => x < '20261020000004');
  if (!old.length || old.length === entries.length) throw new Error('Invalid upgrade migration boundary');
  for (const entry of old) cpSync(join(root, 'prisma', 'migrations', entry), join(oldPrisma, 'migrations', entry), { recursive: true });
  writeFileSync(config, "import { defineConfig } from 'prisma/config';\nexport default defineConfig({ schema: process.env.KAYAN_NATIVE_CI_SCHEMA });\n", { flag: 'wx' });
  migrate(join(oldPrisma, 'schema.prisma'));
  const client = fixtureClient();
  await client.connect();
  const company = '10000000-0000-4000-8000-000000000001', user = '20000000-0000-4000-8000-000000000001', item = '30000000-0000-4000-8000-000000000001', template = '40000000-0000-4000-8000-000000000001';
  await client.query('INSERT INTO companies (id,code,"nameEn","nameAr","updatedAt") VALUES ($1,$2,$3,$4,now())',[company,'synthetic-upgrade','Synthetic Company','Synthetic Company']);
  await client.query('INSERT INTO users (id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())',[user,company,'synthetic-user','Synthetic User','Synthetic User','not-a-real-password-hash']);
  await client.query('INSERT INTO items (id,"companyId",code,"nameEn","nameAr","salePrice","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())',[item,company,'synthetic-item','Synthetic Item','Synthetic Item','42.5']);
  await client.query('INSERT INTO quotation_column_templates (id,"companyId",name,columns,"updatedAt") VALUES ($1,$2,$3,$4::jsonb,now())',[template,company,'Synthetic Template',JSON.stringify([{id:'synthetic-column'}])]);
  await client.end();
  // Add every pre-proof migration, then seed a legacy licensing row. The new
  // field must remain null: unsigned historical payloads are not proof.
  const proofMigration = '20261030160000_preserve_verified_licence_proof';
  if (!entries.includes(proofMigration)) throw new Error('Missing signed-proof migration');
  for (const entry of entries.filter(x => !old.includes(x) && x < proofMigration)) {
    cpSync(join(root, 'prisma', 'migrations', entry), join(oldPrisma, 'migrations', entry), { recursive: true });
  }
  migrate(join(oldPrisma, 'schema.prisma'));
  const legacy = fixtureClient(); await legacy.connect();
  await legacy.query('INSERT INTO license_keys (id,"keyId","licenseId",type,"payloadJson") VALUES ($1,$2,$3,$4,$5)',
    ['50000000-0000-4000-8000-000000000001', 'legacy-upgrade-key', 'legacy-upgrade-license', 'ACTIVATION', '{"legacy":true}']);
  // Seed an existing rate before the tax-default migration. The migration
  // must not rewrite it, while a new company must receive zero afterwards.
  await legacy.query('INSERT INTO company_settings ("companyId", "taxRate", "updatedAt") VALUES ($1,14,now()) ON CONFLICT ("companyId") DO UPDATE SET "taxRate"=14', [company]);
  await legacy.end();
  migrate(join(root, 'prisma', 'schema.prisma'));
  const verify = fixtureClient(); await verify.connect();
  const result = await verify.query('SELECT c.code,u.username,i.code AS item_code,i."salePrice"::text AS price,t.name,t.columns,t.design FROM companies c JOIN users u ON u."companyId"=c.id JOIN items i ON i."companyId"=c.id JOIN quotation_column_templates t ON t."companyId"=c.id WHERE c.id=$1',[company]);
  const history = await verify.query('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  const legacyProof = await verify.query('SELECT "payloadJson", "signedKey" FROM license_keys WHERE "keyId"=$1', ['legacy-upgrade-key']);
  const historicalTax = await verify.query('SELECT "taxRate"::text AS rate FROM company_settings WHERE "companyId"=$1', [company]);
  const newCompany = '60000000-0000-4000-8000-000000000001';
  // A partial unique index permits one non-deleted company per installation.
  // Simulate a replacement installation inside a rolled-back transaction so
  // the fixture tests a genuinely active new company without losing history.
  await verify.query('BEGIN');
  await verify.query('UPDATE companies SET "deletedAt"=now() WHERE id=$1', [company]);
  await verify.query('INSERT INTO companies (id,code,"nameEn","nameAr","updatedAt") VALUES ($1,$2,$3,$4,now())', [newCompany,'synthetic-tax-new','Synthetic Tax','Synthetic Tax']);
  await verify.query('INSERT INTO company_settings ("companyId","updatedAt") VALUES ($1,now())', [newCompany]);
  const newTax = await verify.query('SELECT "taxRate"::text AS rate FROM company_settings WHERE "companyId"=$1', [newCompany]);
  await verify.query('ROLLBACK');
  const preservedCompany = await verify.query('SELECT "deletedAt" FROM companies WHERE id=$1', [company]);
  await verify.end();
  if (preservedCompany.rowCount !== 1 || preservedCompany.rows[0].deletedAt !== null) throw new Error('Historical company was not preserved after fixture rollback');
  if (historicalTax.rowCount !== 1 || Number(historicalTax.rows[0].rate) !== 14 || newTax.rowCount !== 1 || Number(newTax.rows[0].rate) !== 0) throw new Error('Tax default upgrade changed historical rate or failed to default a new company to zero');
  if (legacyProof.rowCount !== 1 || legacyProof.rows[0].payloadJson !== '{"legacy":true}' || legacyProof.rows[0].signedKey !== null) throw new Error('Legacy licence row changed or acquired fabricated signature proof');
  const row = result.rows[0];
  if (result.rowCount !== 1 || row.code !== 'synthetic-upgrade' || row.username !== 'synthetic-user' || row.item_code !== 'synthetic-item' || Number(row.price) !== 42.5 || row.columns[0].id !== 'synthetic-column' || history.rows[0].n !== entries.length) throw new Error('Synthetic data or migration history did not survive');
  console.log(`PASS: native Prisma populated upgrade: ${old.length} old migrations, ${entries.length-old.length} new migrations; synthetic company/user/item/template preserved; historical tax retained and new default zero; ${history.rows[0].n} recorded migrations.`);
  // First-run setup needs an empty, separately created database. Never point
  // this destructive fixture at the populated upgrade fixture or a primary DB.
  await dbAdmin.query(`CREATE DATABASE "${setupName}"`); setupCreated = true;
  migrate(join(root, 'prisma', 'schema.prisma'), setupUrl.toString());
  const setup = spawnSync(process.execPath, [join(root, 'scripts', 'verify-setup-real-pg.cjs')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: setupUrl.toString(), KAYAN_SETUP_DISPOSABLE_DATABASE: setupName },
    encoding: 'utf8',
  });
  if (setup.status !== 0) throw new Error(`Setup PostgreSQL fixture failed: ${(setup.stderr || setup.stdout || '').slice(-5000).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]')}`);
  process.stdout.write(setup.stdout);
  // The child can only touch this script's disposable database. Production
  // stock, journal and Prisma services run, not a Prisma-shaped test double.
  const stock = spawnSync(process.execPath, [join(root, 'scripts', 'verify-stock-documents-real-pg.cjs')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url.toString(), KAYAN_STOCK_DISPOSABLE_DATABASE: name },
    encoding: 'utf8',
  });
  if (stock.status !== 0) throw new Error(`Stock PostgreSQL fixture failed: ${(stock.stderr || stock.stdout || '').slice(-5000).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]')}`);
  process.stdout.write(stock.stdout);
  const licenceStatus = spawnSync(process.execPath, [join(root, 'scripts', 'verify-license-status-real-pg.cjs')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url.toString(), KAYAN_STOCK_DISPOSABLE_DATABASE: name },
    encoding: 'utf8',
  });
  if (licenceStatus.status !== 0) throw new Error(`Licence status PostgreSQL fixture failed: ${(licenceStatus.stderr || licenceStatus.stdout || '').slice(-5000).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE URL REDACTED]')}`);
  process.stdout.write(licenceStatus.stdout);

} finally {
  for (const client of fixtureClients) await client.end();
  if (setupCreated) await dbAdmin.query(`DROP DATABASE "${setupName}" WITH (FORCE)`);
  if (created) await dbAdmin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await dbAdmin.end();
  rmSync(dir, { recursive: true, force: true });
  rmSync(config, { force: true });
}
