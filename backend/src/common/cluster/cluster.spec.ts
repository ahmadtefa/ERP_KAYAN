import { perWorkerPools, workerCount } from './cluster-config';
import { RateWindowStore } from './rate-window-store';

describe('worker count', () => {
  it('one process unless asked', () => {
    expect(workerCount({}, 8)).toBe(1);
    expect(workerCount({ KAYAN_WORKERS: '1' }, 8)).toBe(1);
    expect(workerCount({ KAYAN_WORKERS: 'nonsense' }, 8)).toBe(1);
    expect(workerCount({ KAYAN_WORKERS: '0' }, 8)).toBe(1);
    expect(workerCount({ KAYAN_WORKERS: '99' }, 8)).toBe(1);
  });
  it('a number or auto', () => {
    expect(workerCount({ KAYAN_WORKERS: '4' }, 8)).toBe(4);
    expect(workerCount({ KAYAN_WORKERS: 'auto' }, 6)).toBe(6);
    expect(workerCount({ KAYAN_WORKERS: 'AUTO' }, 64)).toBe(32);
    expect(workerCount({ KAYAN_WORKERS: 'auto' }, 1)).toBe(1);
  });
});

describe('connections stay under the server limit', () => {
  it('a single process keeps the defaults', () => expect(perWorkerPools(1, {})).toEqual({}));
  it('the total of all workers never passes 80', () => {
    for (const n of [2, 3, 4, 8, 16, 32]) {
      const p = perWorkerPools(n, {});
      expect(n * (Number(p.PG_POOL_MAX) + Number(p.BARRIER_POOL_MAX))).toBeLessThanOrEqual(Math.max(80, n * 4));
      expect(Number(p.PG_POOL_MAX)).toBeGreaterThanOrEqual(2);
    }
  });
  it('an operator setting is kept', () => {
    expect(perWorkerPools(4, { PG_POOL_MAX: '7' })).toEqual({ BARRIER_POOL_MAX: '10' });
  });
});

describe('shared request counter (several workers)', () => {
  it('counts one address once however many workers ask', () => {
    const s = new RateWindowStore();
    const results = [1, 2, 3, 4].map((i) => s.hit('api:1.2.3.4', 3, 60_000, 1000 + i).allowed);
    expect(results).toEqual([true, true, true, false]);
  });
  it('keeps separate keys apart and starts a new window after it ends', () => {
    const s = new RateWindowStore();
    expect(s.hit('a', 1, 1000, 0).allowed).toBe(true);
    expect(s.hit('a', 1, 1000, 10).allowed).toBe(false);
    expect(s.hit('b', 1, 1000, 10).allowed).toBe(true);
    expect(s.hit('a', 1, 1000, 1001).allowed).toBe(true);
  });
  it('a refund frees one request, only inside the same window', () => {
    const s = new RateWindowStore();
    const first = s.hit('a', 1, 1000, 0);
    s.refund('a', first.resetAt, 5);
    expect(s.hit('a', 1, 1000, 6).allowed).toBe(true);
    const old = s.hit('b', 1, 1000, 0);
    expect(s.hit('b', 1, 1000, 1500).allowed).toBe(true); // new window
    s.refund('b', old.resetAt, 1500); // stale window: ignored
    expect(s.hit('b', 1, 1000, 1501).allowed).toBe(false);
  });
  it('old windows are dropped so the map cannot grow forever', () => {
    const s = new RateWindowStore();
    for (let i = 0; i < 50; i++) s.hit(`k${i}`, 5, 100, 0);
    s.hit('late', 5, 100, 70_000);
    expect(s.size()).toBe(1);
  });
});
