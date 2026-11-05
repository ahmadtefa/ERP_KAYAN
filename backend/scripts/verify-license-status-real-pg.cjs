'use strict';
// Non-signing fixture. The parent creates and destroys the isolated database.
// This is not evidence of signature verification, licence recovery or Windows.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || '');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    url.hostname !== '127.0.0.1' || url.port !== '5432' ||
    !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
    process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1)) {
  throw new Error('Licence status fixture requires the explicitly named disposable CI database');
}
if (process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  throw new Error('Prisma engine overrides are forbidden');
}
require('reflect-metadata');
require('ts-node/register/transpile-only');
const { PrismaService } = require('../src/common/prisma/prisma.service');
const { LicensingService } = require('../src/modules/licensing/licensing.service');
const now = new Date('2032-11-04T12:00:00.000Z');
const licenseId = 'synthetic-status-licence';
const machineId = 'synthetic-status-machine';

(async () => {
  const db = new PrismaService();
  const other = new PrismaService();
  try {
    await db.$connect(); await other.$connect();
    await db.licenseInstallation.create({ data: { licenseId, machineId, status:'ACTIVE',
      startsAt:now, issuedAt:now, expiresAt:null, seatLimit:2 } });
    const service = new LicensingService(db, {}, { installedDirectory:null, machineId,
      enforcement:'enforce', clock:() => now });
    service.ready = Promise.resolve();
    service.store = { current:{installId:'synthetic',licenseId,clockState:'OK',clockSuspects:[],
      lastSeenAt:now.toISOString(),appliedKeys:[],maxSeatsUsed:0,maxSeatLimit:0,perpetual:false,licenseExpiresAt:null},
      update(fn) { fn(this.current); } };
    service.requestCodeObject = () => ({code:'synthetic-request'});
    service.verificationKeyAvailable = async () => true;
    service.assertVerificationKey = async () => {};
    for (const [status, expected] of [['ACTIVE','ACTIVE'],['REVOKED','REVOKED'],['UNKNOWN','INVALID_STATUS']]) {
      await db.licenseInstallation.update({where:{licenseId},data:{status}});
      const result = await service.status({fresh:true});
      assert.equal(result.state,expected);
      assert.equal(result.blocked,expected !== 'ACTIVE');
    }
    await db.licenseInstallation.update({where:{licenseId},data:{status:'ACTIVE',startsAt:new Date('2033-01-01T00:00:00Z')}});
    assert.equal((await service.status({fresh:true})).state,'NOT_YET_VALID');
    await db.licenseInstallation.update({where:{licenseId},data:{startsAt:now}});

    // A protected watermark for a different licence must never make this
    // expired database row perpetual or raise its seats. No signature test:
    // the store is synthetic and the actual Prisma database is disposable.
    const expired = new Date('2031-01-01T00:00:00Z');
    await db.licenseInstallation.update({where:{licenseId},data:{expiresAt:expired,seatLimit:2}});
    const beforeMismatch = await db.licenseInstallation.findUnique({where:{licenseId}});
    service.store.current.licenseId = 'other-synthetic-licence';
    service.store.current.perpetual = true;
    service.store.current.maxSeatLimit = 50;
    const beforeStore = structuredClone(service.store.current);
    await assert.rejects(service.reconcile(), error => error.getResponse?.().code === 'LICENSE_STATE_ID_MISMATCH');
    await assert.rejects(service.status({fresh:true}), error => error.getResponse?.().code === 'LICENSE_STATE_ID_MISMATCH');
    assert.deepEqual(await db.licenseInstallation.findUnique({where:{licenseId}}),beforeMismatch);
    assert.deepEqual(service.store.current,beforeStore);
    service.store.current.licenseId=licenseId;
    service.store.current.perpetual=false;
    service.store.current.maxSeatLimit=0;
    await db.licenseInstallation.update({where:{licenseId},data:{expiresAt:null}});

    for (const type of ['RENEWAL','SEATS','TRANSFER']) {
      await db.licenseInstallation.update({where:{licenseId},data:{status:'ACTIVE'}});
      const stale = await db.licenseInstallation.findFirst({where:{licenseId}});
      await other.licenseInstallation.update({where:{licenseId},data:{status:'REVOKED'}});
      const keyId = `synthetic-status-${type}`;
      const payload = { type, keyId, licenseId, machineId, issuedAt:now.toISOString(),
        term:{kind:'MONTHS',months:1}, seats:{mode:'INCREASE',value:1},
        state:{issuedAt:now.toISOString(),startsAt:now.toISOString(),expiresAt:null,seatLimit:2,seatsUsed:0} };
      // A synthetic row is inserted inside the same transaction. The tested
      // operation must reject the stale row and roll it back; no key is signed.
      await assert.rejects(db.$transaction(async tx => {
        await tx.licenseKeyRecord.create({data:{keyId,licenseId,type,payloadJson:'{}'}});
        if (type === 'RENEWAL') await service.applyRenewal(tx,payload,stale,now);
        if (type === 'SEATS') await service.applySeats(tx,payload,stale,0);
        if (type === 'TRANSFER') await service.applyTransfer(tx,payload,0,stale);
      }));
      assert.equal(await db.licenseKeyRecord.count({where:{keyId}}),0);
      assert.equal((await db.licenseInstallation.findUnique({where:{licenseId}})).status,'REVOKED');
    }
    // Revoke from an independent client after confirmClock reads the row but
    // before the conditional database write; it must not turn it ACTIVE.
    await db.licenseInstallation.update({where:{licenseId},data:{status:'ACTIVE'}});
    const proxy = new Proxy(db, { get(target, property) {
      if (property === 'licenseInstallation') return new Proxy(target.licenseInstallation, {
        get(delegate, name) {
          if (name === 'updateMany') return async args => {
            await other.licenseInstallation.update({where:{licenseId},data:{status:'REVOKED'}});
            return delegate.updateMany(args);
          };
          return delegate[name];
        },
      });
      return target[property];
    }});
    service.prisma = proxy;
    await assert.rejects(service.confirmClock({}));
    assert.equal((await db.licenseInstallation.findUnique({where:{licenseId}})).status,'REVOKED');
    console.log('PASS: real Prisma/PostgreSQL licence status, protected identity mismatch, conditional revocation races and synthetic key-row rollback (no signing).');
  } finally { await other.$disconnect(); await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
