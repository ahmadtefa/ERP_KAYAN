import { ForbiddenException, Logger } from '@nestjs/common';

import { LicenseGuard } from './license.guard';
import { LicensingService } from './licensing.service';

// No key material or signing: the database and clock are synthetic.
const now = new Date('2026-11-04T12:00:00.000Z');
function setup(status = 'ACTIVE') {
  const row = {
    licenseId: 'synthetic-license', machineId: 'synthetic-machine',
    status, startsAt: new Date('2026-01-01T00:00:00Z'),
    issuedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: null as Date | null,
    seatLimit: 2, clockState: 'OK', clockNote: null, lastSeenAt: now,
  };
  const store: any = { current: { installId: 'synthetic-install', licenseId: row.licenseId,
    clockState: 'OK', clockSuspects: [], lastSeenAt: now.toISOString(),
    appliedKeys: [], maxSeatsUsed: 0, maxSeatLimit: 0, perpetual: false, licenseExpiresAt: null },
    update(fn: (s: any) => void) { fn(this.current); } };
  const db: any = {
    licenseInstallation: {
      findFirst: jest.fn(async () => row),
      update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const accepted = typeof where.status === 'string' ? row.status === where.status :
          where.status.in.includes(row.status);
        if (!accepted || row.licenseId !== where.licenseId || row.machineId !== where.machineId ||
          (where.seatLimit !== undefined && where.seatLimit !== row.seatLimit) ||
          (Object.hasOwn(where, 'expiresAt') && (where.expiresAt?.getTime() ?? null) !== (row.expiresAt?.getTime() ?? null))) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }),
      create: jest.fn(async () => ({})),
    },
    licenseEvent: { create: jest.fn(async () => ({})), findFirst: jest.fn(async () => null) },
    licenseKeyRecord: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})) },
    licenseSeatUsage: { count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({count:0})) },
    user: { findFirst: jest.fn(async () => null) },
  };
  db.$transaction = async (fn: any) => fn(db);
  const service = new LicensingService(db, {} as any, {
    installedDirectory: null, machineId: row.machineId, enforcement: 'enforce', clock: () => now,
  });
  const internals = service as any;
  internals.store = store;
  internals.ready = Promise.resolve();
  internals.requestCodeObject = () => ({ code: 'synthetic-request' });
  internals.verificationKeyAvailable = async () => true;
  internals.assertVerificationKey = async () => {};
  return { service, db, row, store, internals };
}

async function code(promise: Promise<unknown>) {
  try { await promise; return null; }
  catch (error) { return (error as ForbiddenException).getResponse() as { code: string }; }
}

describe('licence state safety without signing', () => {
  afterEach(() => jest.restoreAllMocks());
  it('does not log raw bootstrap or licence-read exceptions and still blocks', async () => {
    const marker = 'synthetic-private-marker';
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, internals } = setup();
    internals.ensureReady = jest.fn().mockRejectedValue(new Error(marker));
    await service.onModuleInit();
    jest.spyOn(service, 'status').mockRejectedValue(new Error(marker));
    expect(await service.isBlocked()).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  });
  it('does not log the machine identifier or licence-state directory at startup', async () => {
    const marker = 'synthetic-private-marker';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { internals } = setup();
    internals.directory = marker;
    internals.machineId = () => marker;
    internals.openStore = () => {};
    internals.loadKey = () => {};
    internals.resolveEnforcement = () => {};
    internals.reconcile = async () => {};
    internals.runClockCheck = async () => {};
    await internals.bootstrap();
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  });
  it.each([
    ['REVOKED', 'REVOKED'], ['UNKNOWN', 'INVALID_STATUS'], ['', 'INVALID_STATUS'],
    ['SUSPENDED', 'SUSPENDED'], ['ACTIVE', 'ACTIVE'],
  ])('maps database status %s to %s', async (dbStatus, expected) => {
    const { service } = setup(dbStatus);
    const result = await service.status({ fresh: true });
    expect(result.state).toBe(expected);
    expect(result.blocked).toBe(expected !== 'ACTIVE');
  });
  it('blocks a not-yet-started licence and an expired licence', async () => {
    const { service, row } = setup();
    row.startsAt = new Date('2027-01-01T00:00:00Z');
    expect(await service.status({ fresh: true })).toMatchObject({state:'NOT_YET_VALID',blocked:true});
    row.startsAt = new Date('2026-01-01T00:00:00Z');
    row.expiresAt = new Date('2026-01-02T00:00:00Z');
    expect(await service.status({ fresh: true })).toMatchObject({state:'EXPIRED',blocked:true});
  });
  it.each(['REVOKED','UNKNOWN'])('does not reconcile, check clock, or confirm clock for %s', async (status) => {
    const { service, row, db, store } = setup(status);
    await service.reconcile();
    await service.runClockCheck(true);
    expect(await code(service.confirmClock({}))).toMatchObject({code:'LICENSE_STATUS_INVALID'});
    expect(row.status).toBe(status);
    expect(db.licenseInstallation.update).not.toHaveBeenCalled();
    expect(db.licenseInstallation.updateMany).not.toHaveBeenCalled();
    expect(store.current.maxSeatLimit).toBe(0);
  });
  it('never applies foreign perpetual and seat watermarks to this row', async () => {
    const { service, db, row, store } = setup();
    store.current.licenseId = 'different-synthetic-license';
    store.current.perpetual = true;
    store.current.maxSeatLimit = 50;
    row.expiresAt = new Date('2026-01-02T00:00:00Z');
    const before = structuredClone(row);
    expect(await code(service.reconcile())).toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(row).toEqual(before);
    expect(store.current.licenseId).toBe('different-synthetic-license');
    expect(db.licenseInstallation.update).not.toHaveBeenCalled();
  });

  it.each([
    ['perpetual', {perpetual:true}],
    ['seat limit', {maxSeatLimit:50}],
    ['expiry', {licenseExpiresAt:'2027-01-01T00:00:00.000Z'}],
  ])('does not attach an unbound protected %s watermark to a database licence', async (_label, watermark) => {
    const { service, db, row, store } = setup();
    store.current.licenseId = null;
    Object.assign(store.current, watermark);
    row.expiresAt = new Date('2026-01-02T00:00:00Z');
    const beforeRow = structuredClone(row);
    const beforeStore = structuredClone(store.current);
    expect(await code(service.reconcile())).toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(await code(service.status({fresh:true}))).toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(row).toEqual(beforeRow);
    expect(store.current).toEqual(beforeStore);
    expect(db.licenseInstallation.update).not.toHaveBeenCalled();
  });

  it('reapplies both eligible protected watermarks in one guarded update', async () => {
    const { service, row, db, store } = setup();
    db.licenseInstallation.findFirst.mockImplementation(async () => ({...row}));
    row.expiresAt = new Date('2027-01-01T00:00:00Z');
    store.current.perpetual = true;
    store.current.maxSeatLimit = 50;
    await service.reconcile();
    expect(row).toMatchObject({status:'ACTIVE',seatLimit:50,expiresAt:null});
    expect(db.licenseInstallation.updateMany).toHaveBeenCalledTimes(1);
    expect(db.licenseEvent.create).toHaveBeenCalledTimes(1);
  });

  it('imports keys after a matching no-change snapshot without a repair event', async () => {
    const { service, db, store } = setup();
    db.licenseKeyRecord.findMany.mockResolvedValueOnce([{keyId:'synthetic-key'}]);
    await service.reconcile();
    expect(store.current.appliedKeys).toContain('synthetic-key');
    expect(db.licenseEvent.create).not.toHaveBeenCalled();
  });

  it('does not apply watermarks after a concurrent revocation', async () => {
    const { service, row, db, store } = setup();
    // Return a snapshot just like Prisma: a later write cannot mutate the
    // already-read JavaScript object.
    db.licenseInstallation.findFirst.mockImplementation(async () => ({...row}));
    row.expiresAt = new Date('2027-01-01T00:00:00Z');
    store.current.perpetual = true;
    store.current.maxSeatLimit = 50;
    const protectedBefore = structuredClone(store.current);
    db.licenseKeyRecord.findMany.mockImplementationOnce(async () => { row.status = 'REVOKED'; return []; });
    expect(await code(service.reconcile())).toMatchObject({code:'LICENSE_RECONCILE_STALE'});
    expect(row).toMatchObject({status:'REVOKED',seatLimit:2,expiresAt:new Date('2027-01-01T00:00:00Z')});
    expect(store.current).toEqual(protectedBefore);
    expect(db.licenseEvent.create).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent renewal or import a stale snapshot', async () => {
    const { service, row, db, store } = setup();
    db.licenseInstallation.findFirst.mockImplementation(async () => ({...row}));
    row.expiresAt = new Date('2027-01-01T00:00:00Z');
    store.current.licenseExpiresAt = '2027-06-01T00:00:00.000Z';
    store.current.maxSeatLimit = 50;
    const protectedBefore = structuredClone(store.current);
    db.licenseKeyRecord.findMany.mockImplementationOnce(async () => {
      row.expiresAt = new Date('2028-01-01T00:00:00Z'); return [];
    });
    expect(await code(service.reconcile())).toMatchObject({code:'LICENSE_RECONCILE_STALE'});
    expect(row).toMatchObject({seatLimit:2,expiresAt:new Date('2028-01-01T00:00:00Z')});
    expect(store.current).toEqual(protectedBefore);
    expect(db.licenseEvent.create).not.toHaveBeenCalled();
  });

  it('does not import keys from a snapshot revoked when no watermark repair was needed', async () => {
    const { service, row, db, store } = setup();
    db.licenseInstallation.findFirst.mockImplementation(async () => ({...row}));
    const protectedBefore = structuredClone(store.current);
    db.licenseKeyRecord.findMany.mockImplementationOnce(async () => {
      row.status = 'REVOKED'; return [{keyId:'synthetic-key'}];
    });
    expect(await code(service.reconcile())).toMatchObject({code:'LICENSE_RECONCILE_STALE'});
    expect(store.current).toEqual(protectedBefore);
    expect(db.licenseEvent.create).not.toHaveBeenCalled();
  });

  it('does not update protected state if the reconciliation audit fails', async () => {
    const { service, row, db, store } = setup();
    db.licenseInstallation.findFirst.mockImplementation(async () => ({...row}));
    store.current.maxSeatLimit = 50;
    const protectedBefore = structuredClone(store.current);
    db.licenseEvent.create.mockRejectedValueOnce(new Error('synthetic audit failure'));
    await expect(service.reconcile()).rejects.toThrow('synthetic audit failure');
    expect(store.current).toEqual(protectedBefore);
    // This fake transaction cannot prove rollback: real PostgreSQL is required.
  });

  it('blocks status and clock confirmation on a conflicting protected licence', async () => {
    const { service, row, store, db } = setup();
    store.current.licenseId = 'different-synthetic-license';
    const before = structuredClone(store.current);
    expect(await code(service.status({fresh:true}))).toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(await code(service.confirmClock({}))).toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(store.current).toEqual(before);
    expect(row.status).toBe('ACTIVE');
    expect(db.licenseInstallation.updateMany).not.toHaveBeenCalled();
  });

  it('does not reserve seats for a mismatched licence', async () => {
    const { service, db, store } = setup();
    store.current.licenseId = 'different-synthetic-license';
    db.$executeRawUnsafe = jest.fn().mockResolvedValue(0);
    db.licenseSeatUsage.findUnique = jest.fn();
    db.licenseSeatUsage.create = jest.fn();
    expect(await code(service.reserveSeat(db,{username:'synthetic',reason:'fixture'} as any)))
      .toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(db.licenseSeatUsage.create).not.toHaveBeenCalled();
    expect(db.licenseSeatUsage.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a key for a different protected licence before changing state or database', async () => {
    const { internals, row, db, store } = setup();
    store.current.licenseId = 'different-synthetic-license';
    const payload = {type:'RENEWAL',keyId:'synthetic-key',licenseId:row.licenseId,
      machineId:row.machineId,issuedAt:now.toISOString()};
    internals.verify = () => ({payload,payloadJson:'{}',signedText:'synthetic',signature:'synthetic'});
    expect(await code(internals.applyKey('synthetic','RENEWAL',{}))).toMatchObject({code:'LICENSE_STATE_ID_MISMATCH'});
    expect(db.licenseKeyRecord.create).not.toHaveBeenCalled();
    expect(db.licenseInstallation.update).not.toHaveBeenCalled();
    expect(store.current.appliedKeys).toEqual([]);
  });

  it('cannot confirm a clock if the row is revoked after it was read', async () => {
    const { service, row, db } = setup();
    db.licenseInstallation.updateMany.mockImplementationOnce(async () => { row.status = 'REVOKED'; return {count:0}; });
    expect(await code(service.confirmClock({}))).toMatchObject({code:'LICENSE_STATUS_INVALID'});
    expect(row.status).toBe('REVOKED');
    expect(db.licenseEvent.create).not.toHaveBeenCalled();
  });
  it('confirms a suspended clock without changing its machine or licence', async () => {
    const { service, row } = setup('SUSPENDED');
    expect(await service.confirmClock({})).toMatchObject({state:'ACTIVE',blocked:false});
    expect(row.machineId).toBe('synthetic-machine');
    expect(row.licenseId).toBe('synthetic-license');
  });
  it.each(['RENEWAL','SEATS','TRANSFER'])('applies a mock-verified %s to an eligible row', async (type) => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { internals, row } = setup();
    if (type === 'RENEWAL') row.expiresAt = new Date('2027-01-01T00:00:00Z');
    const payload = { type, keyId:'synthetic-key', licenseId:row.licenseId, machineId:row.machineId,
      issuedAt:now.toISOString(), term:{kind:'MONTHS',months:1}, seats:{mode:'INCREASE',value:1},
      state:{ issuedAt:now.toISOString(), startsAt:now.toISOString(), expiresAt:null, seatLimit:2, seatsUsed:0 }, note:null };
    internals.verify = () => ({payload,payloadJson:'{}',signedText:'synthetic',signature:'synthetic'});
    expect(await internals.applyKey('synthetic',type,{})).toMatchObject({state:'ACTIVE',blocked:false});
    expect(JSON.stringify(log.mock.calls)).not.toContain(row.licenseId);
    expect(JSON.stringify(log.mock.calls)).not.toContain(payload.keyId);
    if (type === 'SEATS') expect(row.seatLimit).toBe(3);
    if (type === 'RENEWAL') expect(row.expiresAt).not.toBeNull();
  });
  it.each(['RENEWAL','SEATS','TRANSFER'])('rejects %s if revoked after preflight', async (type) => {
    const { internals, row, db } = setup();
    const payload = { type, keyId:'synthetic-key', licenseId:row.licenseId, machineId:row.machineId,
      issuedAt:now.toISOString(), term:{kind:'MONTHS',months:1}, seats:{mode:'INCREASE',value:1},
      state:{ issuedAt:now.toISOString(), startsAt:now.toISOString(), expiresAt:null, seatLimit:2, seatsUsed:0 }, note:null };
    // Verification is mocked: no test key is generated or signed.
    internals.verify = () => ({payload,payloadJson:'{}',signedText:'synthetic',signature:'synthetic'});
    db.licenseInstallation.updateMany.mockImplementationOnce(async () => { row.status = 'REVOKED'; return {count:0}; });
    const result = await code(internals.applyKey('synthetic',type,{}));
    expect(result).toMatchObject({code:'LICENSE_STATUS_INVALID'});
    expect(row.status).toBe('REVOKED');
  });
  it.each(['REVOKED','INVALID_STATUS','NOT_YET_VALID'])('guard blocks %s and retains backup access', async (state) => {
    const service = {isEnforced:() => true,status:async () => ({blocked:true,state,configured:true,expiresAt:null,perpetual:false})};
    const guard = new LicenseGuard(service as any);
    const context = (path:string) => ({switchToHttp:() => ({getRequest:() => ({path})})}) as any;
    const result = await code(guard.canActivate(context('/sales')));
    expect(result?.code).toBe(state === 'REVOKED' ? 'LICENSE_REVOKED' : state === 'INVALID_STATUS' ? 'LICENSE_STATUS_INVALID' : 'LICENSE_NOT_YET_VALID');
    expect(await guard.canActivate(context('/backup'))).toBe(true);
  });
});
