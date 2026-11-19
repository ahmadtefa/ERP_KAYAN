'use strict';
/** Real LicensingService + Prisma + PostgreSQL, synthetic keys and data only.
 * The Ed25519 private half exists only as a Node KeyObject in this process;
 * it is never exported, printed, or written. No server or installer is started.
 * Requires a marked, Unix-socket-only disposable PostgreSQL 17 cluster and a
 * freshly compiled backend. Creates a new database and test directory; neither
 * is deleted. KAYAN_ISOLATED_PG_SOCKET, KAYAN_ISOLATED_PG_PORT and
 * KAYAN_TEST_BUILD_DIR must be set explicitly. No DATABASE_URL is consumed.
 */
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const { readdirSync, readFileSync, realpathSync, mkdtempSync, writeFileSync, renameSync } = require('node:fs');
const { join, isAbsolute } = require('node:path');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const host = process.env.KAYAN_ISOLATED_PG_SOCKET;
const port = Number(process.env.KAYAN_ISOLATED_PG_PORT);
const build = process.env.KAYAN_TEST_BUILD_DIR;
if (!host || !isAbsolute(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !build || !isAbsolute(build)) throw new Error('Private socket, port and backend build directory are required.');
if (process.env.LICENSE_STATE_SECRET) throw new Error('Unset LICENSE_STATE_SECRET for this synthetic test.');
const { LicensingService } = require(join(build,'dist/src/modules/licensing/licensing.service.js'));
const { LicenseGuard } = require(join(build,'dist/src/modules/licensing/license.guard.js'));
const { LicenseStore } = require(join(build,'dist/src/modules/licensing/license-store.js'));
const { HealthController } = require(join(build,'dist/src/modules/health/health.controller.js'));
const { signPayload } = require(join(build,'dist/src/modules/licensing/license-key.js'));
const cfg = { host, port, user: 'kayan_test' };
const database = 'kayan_license_' + randomBytes(8).toString('hex');
const migrations = join(__dirname,'..','prisma','migrations');
const machineId = 'KM-AAAA-BBBB-CCCC';
const context = path => ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) });
const expectCode = (code) => error => { assert.equal(error.getResponse()?.code, code); return true; };
const log = message => console.log('PASS:',message);
async function main() {
  const admin = new Client({ ...cfg, database:'postgres' });
  await admin.connect();
  const identity = (await admin.query("SELECT current_setting('listen_addresses') AS listen, current_user AS role, version() AS version, current_setting('data_directory') AS data_dir")).rows[0];
  assert.equal(identity.listen, '');
  assert.equal(identity.role, 'kayan_test');
  assert.match(identity.version, /PostgreSQL 17\./);
  const dataDir = realpathSync(identity.data_dir), socketDir = realpathSync(host);
  assert.equal(join(dataDir,'..'),join(socketDir,'..'));
  assert.equal(readFileSync(join(dataDir,'KAYAN-ISOLATED-TEST-ONLY'),'utf8').trim(),'KAYAN ISOLATED TEST CLUSTER - NO CUSTOMER DATA');
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  const sql = new Client({ ...cfg, database }); await sql.connect();
  const dirs = readdirSync(migrations,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort();
  for (const d of dirs) {
    try { await sql.query('BEGIN'); await sql.query(readFileSync(join(migrations,d,'migration.sql'),'utf8')); await sql.query('COMMIT'); }
    catch (e) { await sql.query('ROLLBACK'); throw new Error(`migration ${d}: ${e.message}`); }
  }
  const p = new PrismaClient({ adapter: new PrismaPg({ ...cfg, database }) });
  await p.$connect();
  const company = await p.company.create({ data: { code:'SYNTHETIC', nameEn:'Test company', nameAr:'Test company' } });
  const keys = generateKeyPairSync('ed25519');
  const publicText = keys.publicKey.export({format:'pem',type:'spki'}).toString();
  const dir = mkdtempSync(join(dataDir,'..','license-test-'));
  const pub = join(dir,'public-key.pem'), state = join(dir,'license-state.json');
  writeFileSync(pub,publicText,{flag:'wx'});
  // PostgreSQL timestamps use the real system clock. A fixed clock in May
  // would make its freshly inserted events appear to come from the future.
  const clock = () => new Date();
  const makeService = () => new LicensingService(p, {}, { installedDirectory:dir, machineId, clock, appVersion:'test-only' });
  const payload = { v:1,keyId:'synthetic-activation-1',type:'ACTIVATION',licenseId:'lic_synthetic',machineId,issuedAt:new Date(Date.now() - 60000).toISOString(),term:{kind:'MONTHS',months:12},seats:{mode:'INCREASE',value:5},state:null,note:null };
  const activation = signPayload(payload,keys.privateKey);
  const service = makeService();
  const active = await service.activate(activation);
  assert.equal(active.state,'ACTIVE'); assert.equal(active.blocked,false);
  const companyBefore = await p.company.findUniqueOrThrow({where:{id:company.id}});
  const originalState = readFileSync(state);
  const storedFingerprint = new LicenseStore(dir).current.publicKeyFingerprint;
  assert.ok(storedFingerprint);

  writeFileSync(state,'synthetic-corrupt-state');
  const broken = makeService(); await broken.onModuleInit();
  assert.equal(broken.licenseSummary().stateError,'LICENSE_STATE_DAMAGED');
  const guard = new LicenseGuard(broken);
  assert.equal(await guard.canActivate(context('/api/v1/health')),true);
  await assert.rejects(guard.canActivate(context('/api/v1/invoices')),expectCode('LICENSE_STATE_DAMAGED'));
  const health = await new HealthController(p,broken).check();
  assert.deepEqual(health.license,{enforcement:'enforce',configured:false,stateError:'LICENSE_STATE_DAMAGED'});
  assert.ok(!JSON.stringify(health).includes(active.licenseId));
  assert.ok(!JSON.stringify(health).includes(publicText));
  assert.equal(readFileSync(state,'utf8'),'synthetic-corrupt-state');
  renameSync(state,join(dir,'diagnostic-corrupt-state.json'));
  writeFileSync(state,originalState);
  const recovered = await broken.status({fresh:true});
  assert.equal(recovered.state,'ACTIVE'); assert.equal(recovered.blocked,false);
  assert.equal((await p.company.findUniqueOrThrow({where:{id:company.id}})).nameEn,companyBefore.nameEn);
  assert.equal((await makeService().status({fresh:true})).state,'ACTIVE');
  log('corruption preserved; health available; business blocked; trusted state restored and real database preserved across two service starts');

  // Test the *already-running* service as well as restart. No private key is
  // exported; all files and rows belong only to this disposable cluster.
  const live = makeService();
  assert.equal((await live.status({fresh:true})).blocked,false);
  const liveGuard = new LicenseGuard(live);
  const savedPub = join(dir,'saved-public.pem'); renameSync(pub,savedPub);
  const renewal = signPayload({...payload,keyId:'synthetic-live-renewal',type:'RENEWAL',machineId:null,seats:null},keys.privateKey);
  for (const variant of ['missing','malformed','different']) {
    if (variant === 'malformed') writeFileSync(pub,'synthetic bad public key');
    if (variant === 'different') writeFileSync(pub,generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}));
    const checks = await Promise.allSettled([
      liveGuard.canActivate(context('/api/v1/invoices')),
      liveGuard.canActivate(context('/api/v1/stock')),
      live.renew(renewal),
    ]);
    assert.ok(checks.every(r => r.status === 'rejected' && r.reason.getResponse()?.code === 'LICENSE_PUBLIC_KEY_MISSING'));
    const liveStatus = await live.status(); // cached ACTIVE must not allow access
    assert.equal(liveStatus.configured,false); assert.equal(liveStatus.blocked,true);
    assert.equal(live.licenseSummary().configured,false);
    assert.equal(await liveGuard.canActivate(context('/api/v1/health')),true);
    assert.equal(await p.licenseKeyRecord.findUnique({where:{keyId:'synthetic-live-renewal'}}),null);
    const verifier = makeService();
    const s = await verifier.status({fresh:true});
    assert.equal(s.state,'ACTIVE'); assert.equal(s.configured,false); assert.equal(s.blocked,true);
    assert.equal(new LicenseStore(dir).current.publicKeyFingerprint,storedFingerprint);
    await assert.rejects(new LicenseGuard(verifier).canActivate(context('/api/v1/invoices')),expectCode('LICENSE_PUBLIC_KEY_MISSING'));
    if (variant !== 'missing') renameSync(pub,join(dir,`diagnostic-${variant}.pem`));
  }
  renameSync(savedPub,pub);
  assert.equal((await live.status()).blocked,false);
  assert.equal(await liveGuard.canActivate(context('/api/v1/invoices')),true);
  assert.equal(live.licenseSummary().configured,true);
  assert.equal((await makeService().status({fresh:true})).blocked,false);
  assert.equal((await p.company.findUniqueOrThrow({where:{id:company.id}})).nameEn,companyBefore.nameEn);
  log('live and restarted services block missing, malformed and changed public keys; original fingerprint and data preserved; trusted key restores access');

  const beforeSeats = readFileSync(state);
  const seatKey = signPayload({...payload,keyId:'synthetic-seats-1',type:'SEATS',machineId:null,term:null,seats:{mode:'INCREASE',value:3}},keys.privateKey);
  assert.equal((await makeService().addSeats(seatKey)).seats.limit,8);
  writeFileSync(state,beforeSeats);
  const oldFile = makeService();
  assert.equal((await oldFile.status({fresh:true})).seats.limit,8);
  assert.equal(new LicenseStore(dir).current.maxSeatLimit,8);
  await assert.rejects(oldFile.addSeats(seatKey),expectCode('LICENSE_KEY_ALREADY_USED'));
  log('older authenticated state reconciles against newer database and database prevents replay (not proof against joint rollback)');

  await p.$disconnect(); await sql.end();
  console.log(`Disposable test database ${database} and synthetic state directory left intact.`);
}
main().catch(e=>{console.error(e.stack);process.exit(1);});
