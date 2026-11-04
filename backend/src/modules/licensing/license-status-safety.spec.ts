import { ForbiddenException } from '@nestjs/common';

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
        if (!accepted || row.licenseId !== where.licenseId || row.machineId !== where.machineId) return { count: 0 };
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
    const { internals, row } = setup();
    if (type === 'RENEWAL') row.expiresAt = new Date('2027-01-01T00:00:00Z');
    const payload = { type, keyId:'synthetic-key', licenseId:row.licenseId, machineId:row.machineId,
      issuedAt:now.toISOString(), term:{kind:'MONTHS',months:1}, seats:{mode:'INCREASE',value:1},
      state:{ issuedAt:now.toISOString(), startsAt:now.toISOString(), expiresAt:null, seatLimit:2, seatsUsed:0 }, note:null };
    internals.verify = () => ({payload,payloadJson:'{}',signedText:'synthetic',signature:'synthetic'});
    expect(await internals.applyKey('synthetic',type,{})).toMatchObject({state:'ACTIVE',blocked:false});
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
