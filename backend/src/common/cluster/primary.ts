import cluster, { Worker } from 'node:cluster';
import { Logger } from '@nestjs/common';
import { perWorkerPools, workerCount } from './cluster-config';
import { RateReplyMessage, RateRequestMessage, RateWindowStore } from './rate-window-store';

/// The supervisor process when KAYAN_WORKERS asks for more than one worker.
/// It runs no business code: it starts the workers, keeps them alive, counts
/// requests for the rate limiter, and passes a stop signal on.
///
/// The first worker (the leader) starts alone and is the only one that runs
/// the timed jobs (backup schedule, expiry alerts) and start-up writes, so
/// they run once, not once per worker. The others start after it is listening.
export function runPrimary(): void {
  const logger = new Logger('Cluster');
  const workers = workerCount();
  const pools = perWorkerPools(workers);
  const store = new RateWindowStore();
  let stopping = false;
  const restarts: number[] = [];
  const roles = new Map<number, 'leader' | 'follower'>();

  const fork = (role: 'leader' | 'follower'): Worker => {
    const env: NodeJS.ProcessEnv = { ...pools, KAYAN_CLUSTER_WORKER: '1', KAYAN_WORKER_ROLE: role };
    if (role === 'follower') {
      env.KAYAN_DISABLE_EXPIRY_SCHEDULE = 'on';
      env.KAYAN_DISABLE_BACKUP_SCHEDULE = 'on';
    }
    const w = cluster.fork(env);
    roles.set(w.id, role);
    w.on('message', (m: RateRequestMessage) => {
      if (!m || m.kroot !== 'kayan-rate') return;
      if (m.op === 'refund') {
        store.refund(m.key, m.resetAt ?? 0);
        return;
      }
      const r = store.hit(m.key, m.limit ?? 300, m.windowMs ?? 60_000);
      const reply: RateReplyMessage = { kroot: 'kayan-rate', id: m.id, ...r };
      if (w.isConnected()) w.send(reply);
    });
    return w;
  };

  cluster.on('exit', (w, code, signal) => {
    const role = roles.get(w.id) ?? 'follower';
    roles.delete(w.id);
    if (stopping) return;
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && restarts[0] < now - 60_000) restarts.shift();
    if (restarts.length > 5 * workers) {
      logger.error('Workers keep stopping right after they start. Giving up so the problem is visible.');
      process.exit(1);
    }
    logger.warn(`A ${role} worker stopped (${signal ?? code}); starting another.`);
    setTimeout(() => { if (!stopping) fork(role); }, 1000).unref();
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill('SIGTERM');
    const hard = setTimeout(() => process.exit(0), 20_000);
    hard.unref();
    const wait = setInterval(() => {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
    }, 200);
    wait.unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  logger.log(`Starting ${workers} API workers (one per core). The leader goes first.`);
  const leader = fork('leader');
  let followersStarted = false;
  const startFollowers = () => {
    if (followersStarted) return;
    followersStarted = true;
    for (let i = 1; i < workers; i++) fork('follower');
  };
  leader.once('listening', startFollowers);
  // A leader that never reports listening must not keep the rest down forever.
  setTimeout(startFollowers, 120_000).unref();
}
