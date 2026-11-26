import { availableParallelism } from 'node:os';

/// How many API worker processes to run. One Node process runs JavaScript on
/// one core, so a server with several cores runs one worker per core.
/// KAYAN_WORKERS: unset or 1 = a single process (today's behaviour);
/// a number = that many workers (1 to 32); "auto" = one per CPU core.
export function workerCount(env: NodeJS.ProcessEnv = process.env, cores: number = availableParallelism()): number {
  const raw = (env.KAYAN_WORKERS ?? '').trim().toLowerCase();
  if (raw === '' || raw === '1') return 1;
  if (raw === 'auto') return Math.max(1, Math.min(32, cores));
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 32 ? n : 1;
}

/// PostgreSQL's default is 100 connections for the whole server. Each worker
/// keeps a query pool and a maintenance-lock pool, so with several workers the
/// per-worker sizes are cut to keep the total at 80 or less. An operator who
/// sets PG_POOL_MAX / BARRIER_POOL_MAX keeps their own numbers.
export function perWorkerPools(workers: number, env: NodeJS.ProcessEnv = process.env): { PG_POOL_MAX?: string; BARRIER_POOL_MAX?: string } {
  if (workers <= 1) return {};
  const share = Math.max(2, Math.floor(40 / workers));
  const out: { PG_POOL_MAX?: string; BARRIER_POOL_MAX?: string } = {};
  if (!env.PG_POOL_MAX) out.PG_POOL_MAX = String(Math.min(10, share));
  if (!env.BARRIER_POOL_MAX) out.BARRIER_POOL_MAX = String(Math.min(32, share));
  return out;
}

export function isClusterWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KAYAN_CLUSTER_WORKER === '1' && typeof process.send === 'function';
}
