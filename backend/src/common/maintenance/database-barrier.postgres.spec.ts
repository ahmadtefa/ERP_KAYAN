import { ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'pg';
import { BARRIER_BUSY_MESSAGE, DatabaseMaintenanceBarrier } from './database-barrier';
import { BUSINESS_BARRIER_KEY } from './lock-keys';

// Needs a scratch PostgreSQL: KAYAN_BARRIER_PG=1 DATABASE_URL=<scratch db>.
const run = process.env.KAYAN_BARRIER_PG === '1';
(run ? describe : describe.skip)('database barrier lease pool', () => {
  const saved = { ...process.env };
  let barrier: DatabaseMaintenanceBarrier;
  let probe: Client;

  beforeEach(async () => {
    process.env.BARRIER_POOL_MAX = '2';
    process.env.BARRIER_WAIT_MS = '1000';
    barrier = new DatabaseMaintenanceBarrier();
    probe = new Client({ connectionString: process.env.DATABASE_URL });
    await probe.connect();
  });
  afterEach(async () => {
    await barrier.onModuleDestroy();
    await probe.end();
    process.env = { ...saved };
  });

  const exclusiveFree = async () =>
    (await probe.query('SELECT pg_try_advisory_lock($1) AS ok', [BUSINESS_BARRIER_KEY])).rows[0].ok as boolean;
  const exclusiveUnlock = () => probe.query('SELECT pg_advisory_unlock($1)', [BUSINESS_BARRIER_KEY]);

  it('holds the shared lock until release, then lets a restore take it', async () => {
    const release = await barrier.admit();
    expect(await exclusiveFree()).toBe(false);
    await release();
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });

  it('refuses admission while an exclusive restore lock is held', async () => {
    expect(await exclusiveFree()).toBe(true);
    await expect(barrier.admit()).rejects.toThrow(ServiceUnavailableException);
    await exclusiveUnlock();
    await (await barrier.admit())();
  });

  it('queues beyond the pool size and answers busy, not maintenance', async () => {
    const a = await barrier.admit();
    const b = await barrier.admit();
    const started = Date.now();
    await expect(barrier.admit()).rejects.toThrow(BARRIER_BUSY_MESSAGE);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const queued = barrier.admit();
    await a();
    const c = await queued;
    await b();
    await c();
  });

  it('survives a double release without freeing another lease', async () => {
    const a = await barrier.admit();
    const b = await barrier.admit();
    await a();
    await a();
    expect(await exclusiveFree()).toBe(false); // b still holds it
    await b();
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });

  it('destroys the connection when unlock does not confirm', async () => {
    const a = await barrier.admit();
    const pool = (barrier as any).pool;
    const client = pool._clients[0];
    const original = client.query.bind(client);
    client.query = async (sql: string, ...rest: unknown[]) => {
      if (String(sql).includes('pg_advisory_unlock_shared')) throw new Error('boom');
      return original(sql, ...rest);
    };
    await a();
    // The session was closed, so PostgreSQL dropped the lock anyway.
    await new Promise((r) => setTimeout(r, 200));
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });

  it('drains admitted handlers on shutdown without dropping their lock', async () => {
    const release = await barrier.admit();
    let closed = false;
    const closing = barrier.onModuleDestroy().then(() => { closed = true; });
    await new Promise((r) => setTimeout(r, 300));
    expect(closed).toBe(false);
    expect(await exclusiveFree()).toBe(false); // handler still holds its lock
    await expect(barrier.admit()).rejects.toThrow(ServiceUnavailableException); // closing refuses new work
    await release();
    await closing;
    expect(closed).toBe(true);
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });

  it('terminates the whole process, never frees locks under running handlers, when the drain bound passes', async () => {
    process.env.BARRIER_SHUTDOWN_MS = '300';
    const terminate = jest.fn();
    (barrier as any).terminate = terminate;
    await barrier.admit();
    await barrier.onModuleDestroy();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(await exclusiveFree()).toBe(false); // lock untouched by the barrier
    // Test cleanup only: the process would have exited here.
    (barrier as any).closing = false;
    for (const destroy of [...(barrier as any).leases]) destroy();
    await new Promise((r) => setTimeout(r, 200));
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });

  it('refuses an admission that was in flight when shutdown began', async () => {
    const a = barrier.admit();
    const closing = barrier.onModuleDestroy();
    const outcome = await a.then((r) => r, (e) => e);
    if (typeof outcome === 'function') await outcome(); // admitted before closing: drains normally
    else expect(outcome).toBeInstanceOf(ServiceUnavailableException);
    await closing;
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });

  it('fail-stops the process when an admitted connection is lost', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const release = await barrier.admit();
    await probe.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'kayan-api-%-barrier' AND pid <> pg_backend_pid()",
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
    await release();
  });

  it('waits for a delayed connect during shutdown and refuses it without holding a lock', async () => {
    const pool = (barrier as any).getPool();
    const realConnect = pool.connect.bind(pool);
    let letGo: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { letGo = resolve; });
    pool.connect = async () => { await gate; return realConnect(); };
    const admission = barrier.admit().then((r) => r, (e) => e);
    await new Promise((r) => setTimeout(r, 50));
    let closed = false;
    const closing = barrier.onModuleDestroy().then(() => { closed = true; });
    await new Promise((r) => setTimeout(r, 200));
    expect(closed).toBe(false); // the unfinished connect is tracked, so the pool is not ended under it
    letGo();
    const outcome = await admission;
    expect(outcome).toBeInstanceOf(ServiceUnavailableException);
    await closing;
    expect(closed).toBe(true);
    expect(await exclusiveFree()).toBe(true);
    await exclusiveUnlock();
  });
  it('bounds pool.end as part of the same shutdown and shares re-entrant callers', async () => {
    process.env.BARRIER_SHUTDOWN_MS = '100';
    const terminate = jest.fn();
    (barrier as any).terminate = terminate;
    let finish: () => void = () => undefined;
    const end = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    (barrier as any).pool = { end };
    const first = barrier.onModuleDestroy();
    const second = barrier.onModuleDestroy();
    expect(second).toBe(first);
    await first;
    expect(end).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect((barrier as any).drained).toBeNull();
    finish();
    await Promise.resolve();
  });

  it('terminates once and clears lifecycle state when pool.end fails', async () => {
    const terminate = jest.fn();
    (barrier as any).terminate = terminate;
    (barrier as any).pool = { end: jest.fn(async () => { throw new Error('fixture'); }) };
    await Promise.all([barrier.onModuleDestroy(), barrier.onModuleDestroy()]);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect((barrier as any).drained).toBeNull();
  });

  it('bounds a never-completing acquisition without destroying an admitted session', async () => {
    process.env.BARRIER_SHUTDOWN_MS = '100';
    const terminate = jest.fn();
    (barrier as any).terminate = terminate;
    let rejectConnect: (error: Error) => void = () => undefined;
    const end = jest.fn(async () => undefined);
    (barrier as any).pool = { connect: () => new Promise((_resolve, reject) => { rejectConnect = reject; }), end };
    const admission = barrier.admit().catch((error) => error);
    await barrier.onModuleDestroy();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    rejectConnect(new Error('fixture'));
    expect(await admission).toBeInstanceOf(ServiceUnavailableException);
    expect((barrier as any).pending).toBe(0);
  });

});
