import { fork, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { RESTORE_TOOL_LOCK_KEY } from '../../../common/maintenance/lock-keys';

interface ToolInput { command: string; args: string[]; timeout: number; env: NodeJS.ProcessEnv }
interface ToolMessage { type: 'ready' | 'done'; ok?: boolean }

/** A separate IPC supervisor outlives a killed API long enough to stop the
 * tool and its server queries. It releases its own PG lock only afterwards.
 * The child may not start until the owner acknowledges readiness over IPC.
 */
export function runRestoreTool(input: ToolInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const supervisor = fork(__filename, [], {
      execArgv: __filename.endsWith('.ts') ? ['-r', 'ts-node/register/transpile-only'] : [],
      env: input.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let done = false;
    const fail = () => { if (!done) { done = true; reject(new Error('The supervised restore tool did not complete safely.')); } };
    supervisor.on('error', fail);
    supervisor.on('exit', fail);
    supervisor.on('message', (message: ToolMessage) => {
      if (message.type === 'ready' && supervisor.connected) supervisor.send({ type: 'start', input });
      if (message.type === 'done' && !done) {
        done = true;
        if (message.ok) resolve(); else reject(new Error('The supervised restore tool failed.'));
        if (supervisor.connected) supervisor.disconnect();
      }
    });
  });
}

async function supervise(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Missing database connection');
  const url = new URL(raw);
  url.searchParams.delete('schema');
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  let tool: ChildProcess | null = null;
  let disconnected = false;
  let controlLost = false;
  let timer: NodeJS.Timeout | undefined;
  process.once('disconnect', () => {
    disconnected = true;
    tool?.kill('SIGKILL');
  });
  client.on('error', () => { controlLost = true; tool?.kill('SIGKILL'); });
  try {
    await client.connect();
    await client.query("SET lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_lock($1)', [RESTORE_TOOL_LOCK_KEY]);
    if (disconnected || !process.connected) return;
    // Install the listener BEFORE announcing readiness.
    const input = await new Promise<ToolInput | null>((resolve) => {
      const deadline = setTimeout(() => resolve(null), 15_000);
      process.once('message', (message: { type: string; input: ToolInput }) => {
        clearTimeout(deadline);
        resolve(message.type === 'start' ? message.input : null);
      });
      process.once('disconnect', () => { clearTimeout(deadline); resolve(null); });
      process.send?.({ type: 'ready' });
    });
    if (!input || disconnected) return;
    const appName = `kayan-restore-${randomUUID()}`;
    let timedOut = false;
    const ok = await new Promise<boolean>((resolve) => {
      tool = spawn(input.command, input.args, {
        env: { ...input.env, PGAPPNAME: appName }, stdio: 'ignore', windowsHide: true,
      });
      timer = setTimeout(() => { timedOut = true; tool?.kill('SIGKILL'); }, input.timeout);
      tool.once('error', () => resolve(false));
      tool.once('close', (code) => resolve(code === 0));
    });
    clearTimeout(timer);
    // Killing the client does not itself prove a long PostgreSQL statement
    // has stopped. Terminate only sessions tagged by this invocation and wait
    // for their removal before releasing the coordination lock.
    const deadline = Date.now() + 30_000;
    while (true) {
      const active = await client.query<{ pid: number }>(
        'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1', [appName],
      );
      if (!active.rowCount) break;
      for (const row of active.rows) await client.query('SELECT pg_terminate_backend($1)', [row.pid]);
      if (Date.now() > deadline) throw new Error('Restore database sessions did not stop');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (process.connected) process.send?.({ type: 'done', ok: ok && !timedOut && !disconnected && !controlLost });
  } finally {
    clearTimeout(timer);
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  void supervise().then(() => process.exit(0), () => process.exit(1));
}
