#!/usr/bin/env node
/**
 * Load and performance check against a running API and a throwaway PostgreSQL.
 * Synthetic data only. No production, no real company data.
 *
 *   node backend/scripts/load-check.mjs [apiBaseUrl]
 *
 * Phase 1 (single user): seeds ITEMS items and INVOICES posted sales invoices,
 *   then times the main read screens and the main write operations one at a time.
 * Phase 2 (concurrency): N simultaneous signed-in sessions run a mixed workload
 *   (reads, sales invoices, purchase invoices) for STEP_SECONDS at each level in
 *   LEVELS, with sampled PostgreSQL activity (active, lock waits, idle in
 *   transaction, deadlocks) and server CPU/memory.
 * Phase 3 (contention): every session sells the SAME item at once. Afterwards the
 *   API's stock figure must equal bought minus sold, and no sale may be accepted
 *   beyond the stock.
 *
 * It prints a JSON result block (between LOADRESULT markers) and writes it to
 * LOAD_RESULT_FILE. It measures one machine; it does not predict another.
 */
import pg from 'pg';
import fs from 'node:fs';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const DATABASE_URL = process.env.DATABASE_URL;
const ITEMS = Number(process.env.LOAD_ITEMS ?? 1500);
const INVOICES = Number(process.env.LOAD_INVOICES ?? 1500);
const LEVELS = (process.env.LOAD_LEVELS ?? '1,10,25,50,100,200').split(',').map(Number);
const STEP_SECONDS = Number(process.env.LOAD_STEP_SECONDS ?? 20);
const LABEL = process.env.LOAD_LABEL ?? 'run';
const SERVER_PID = process.env.SERVER_PID ?? '';
const RESULT_FILE = process.env.LOAD_RESULT_FILE ?? '/tmp/load-result.json';
const today = new Date().toISOString().slice(0, 10);
const stamp = String(Date.now()).slice(-6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const round = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

async function call(token, path, { method = 'GET', json } = {}) {
  const started = performance.now();
  let status = 0;
  let data = null;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch (error) {
    status = error?.name === 'TimeoutError' ? -2 : -1; // -2 timeout, -1 network
  }
  return { status, data, ms: performance.now() - started };
}

async function login() {
  for (let i = 0; i < 5; i++) {
    const r = await call('', '/auth/login', { method: 'POST', json: { username: USERNAME, password: PASSWORD } });
    if (r.status < 300 && r.data?.accessToken) return r.data.accessToken;
    await sleep(500 * (i + 1));
  }
  throw new Error('login failed');
}

class Stats {
  constructor() { this.byOp = new Map(); }
  add(op, r) {
    let o = this.byOp.get(op);
    if (!o) { o = { ms: [], ok: 0, c4: 0, c429: 0, c5: 0, net: 0, timeout: 0 }; this.byOp.set(op, o); }
    o.ms.push(r.ms);
    if (r.status >= 200 && r.status < 300) o.ok++;
    else if (r.status === 429) o.c429++;
    else if (r.status >= 400 && r.status < 500) o.c4++;
    else if (r.status >= 500) o.c5++;
    else if (r.status === -2) o.timeout++;
    else o.net++;
  }
  summary() {
    const out = {};
    for (const [op, o] of this.byOp) {
      const s = [...o.ms].sort((a, b) => a - b);
      out[op] = { n: s.length, ok: o.ok, http4xx: o.c4, http429: o.c429, http5xx: o.c5, timeouts: o.timeout, network: o.net,
        p50: round(pct(s, 50)), p95: round(pct(s, 95)), p99: round(pct(s, 99)), max: round(s[s.length - 1]) };
    }
    return out;
  }
}

let lastCpu = null;
function serverSample() {
  if (!SERVER_PID) return null;
  try {
    const stat = fs.readFileSync(`/proc/${SERVER_PID}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(f[11]) + Number(f[12]); // utime + stime, clock ticks (100/s)
    const now = performance.now();
    let cpu = null; // percent of ONE core since the previous sample
    if (lastCpu) cpu = ((ticks - lastCpu.ticks) / 100) / ((now - lastCpu.now) / 1000) * 100;
    lastCpu = { ticks, now };
    const rss = Number(fs.readFileSync(`/proc/${SERVER_PID}/statm`, 'utf8').split(' ')[1]) * 4096 / 1048576;
    return { cpu, rssMb: Math.round(rss) };
  } catch { return null; }
}

async function startSampler() {
  const client = DATABASE_URL ? new pg.Client({ connectionString: DATABASE_URL, application_name: 'load-sampler' }) : null;
  if (client) await client.connect();
  const samples = [];
  const waiters = new Map();
  let stop = false;
  const base = client ? (await client.query("select deadlocks, xact_commit, xact_rollback from pg_stat_database where datname=current_database()")).rows[0] : null;
  const loop = (async () => {
    while (!stop) {
      const s = { t: Date.now(), server: serverSample() };
      if (client) {
        try {
          const r = await client.query(`select
            count(*) filter (where state='active' and application_name not like 'load-%') as active,
            count(*) filter (where wait_event_type='Lock') as lock_waiters,
            count(*) filter (where state like 'idle in transaction%') as idle_in_tx,
            count(*) filter (where application_name not like 'load-%') as connections
            from pg_stat_activity where datname=current_database()`);
          Object.assign(s, r.rows[0]);
          const w = await client.query(`select left(regexp_replace(query, '\\s+', ' ', 'g'), 110) as q, count(*)::int as n
            from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and application_name not like 'load-%' group by 1`);
          for (const row of w.rows) waiters.set(row.q, (waiters.get(row.q) ?? 0) + row.n);
        } catch { /* sampler must never disturb the run */ }
      }
      samples.push(s);
      await sleep(1000);
    }
  })();
  return {
    async finish() {
      stop = true; await loop;
      let deadlocks = null;
      if (client) {
        const now = (await client.query("select deadlocks from pg_stat_database where datname=current_database()")).rows[0];
        deadlocks = Number(now.deadlocks) - Number(base.deadlocks);
        await client.end();
      }
      const n = (k) => samples.map((s) => Number(s[k])).filter((x) => Number.isFinite(x));
      const max = (a) => (a.length ? Math.max(...a) : null);
      const avg = (a) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : null);
      const cpu = samples.map((s) => s.server?.cpu).filter((x) => Number.isFinite(x));
      const rss = samples.map((s) => s.server?.rssMb).filter((x) => Number.isFinite(x));
      return {
        pgConnectionsMax: max(n('connections')), pgActiveMax: max(n('active')), pgActiveAvg: avg(n('active')),
        pgLockWaitersMax: max(n('lock_waiters')), pgIdleInTxMax: max(n('idle_in_tx')), pgDeadlocks: deadlocks,
        serverCpuPctOfOneCoreAvg: avg(cpu), serverCpuPctOfOneCoreMax: round(max(cpu)), serverRssMbMax: max(rss),
        lockWaitStatements: [...waiters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([q, n]) => ({ statement: q, waiterSamples: n })),
      };
    },
  };
}

const must = async (token, path, opts) => {
  const r = await call(token, path, opts);
  if (r.status < 200 || r.status >= 300) throw new Error(`${opts?.method ?? 'GET'} ${path} -> ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`);
  return r.data;
};

async function pool(count, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) { const i = next++; if (i >= ITEMS * 10) return; const done = await worker(i); if (done === false) return; }
  }));
}

const qtyOf = (data, itemId) => {
  const rows = Array.isArray(data) ? data : data?.items ?? data?.balances ?? [];
  const row = rows.find((e) => e.itemId === itemId || e.item?.id === itemId);
  return Number(row?.quantity ?? 0);
};

async function main() {
  const result = { label: LABEL, startedAt: new Date().toISOString(), config: { ITEMS, INVOICES, LEVELS, STEP_SECONDS, node: process.version } };
  const admin = await login();

  // ---- seed (synthetic) -------------------------------------------------------
  const seedStarted = performance.now();
  const customer = await must(admin, '/parties/customers', { method: 'POST', json: { code: `LD-C-${stamp}`, nameEn: `Load customer ${stamp}`, nameAr: `عميل حمل ${stamp}`, creditLimit: '999999999', paymentTermDays: 30 } });
  const supplier = await must(admin, '/parties/suppliers', { method: 'POST', json: { code: `LD-S-${stamp}`, nameEn: `Load supplier ${stamp}`, nameAr: `مورد حمل ${stamp}`, paymentTermDays: 30 } });
  const category = await must(admin, '/inventory/categories', { method: 'POST', json: { code: `LD-CAT-${stamp}`, nameEn: `Load category ${stamp}`, nameAr: `تصنيف حمل ${stamp}` } });
  const items = [];
  let created = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (created < ITEMS) {
      const i = created++;
      const it = await must(admin, '/inventory/items', { method: 'POST', json: { code: `LD-I-${stamp}-${i}`, nameEn: `Load item ${i}`, nameAr: `صنف حمل ${i}`, unit: 'PCS', isStockTracked: true, salePrice: '150', purchasePrice: '100', categoryId: category.id } });
      items.push(it);
    }
  }));
  // stock: purchase invoices of 25 lines each, 1000 units per item
  const purchaseDoc = async (lines) => {
    const p = await must(admin, '/purchases/invoices', { method: 'POST', json: { invoiceDate: today, supplierId: supplier.id, lines } });
    await must(admin, `/purchases/invoices/${p.id}/post`, { method: 'POST' });
  };
  const chunks = [];
  for (let i = 0; i < items.length; i += 25) chunks.push(items.slice(i, i + 25));
  let ci = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (ci < chunks.length) { const c = chunks[ci++]; await purchaseDoc(c.map((it) => ({ itemId: it.id, quantity: '1000', unitPrice: '100', taxRate: '14' }))); }
  }));
  const sold = new Map(items.map((it) => [it.id, 0]));
  const bought = new Map(items.map((it) => [it.id, 1000]));
  let invCount = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (invCount < INVOICES) {
      const n = invCount++;
      const it = items[n % items.length];
      const s = await must(admin, '/sales/invoices', { method: 'POST', json: { invoiceDate: today, dueDate: today, customerId: customer.id, lines: [{ itemId: it.id, quantity: '1', unitPrice: '150', taxRate: '14' }] } });
      await must(admin, `/sales/invoices/${s.id}/post`, { method: 'POST' });
      sold.set(it.id, sold.get(it.id) + 1);
    }
  }));
  result.seed = { items: items.length, postedSalesInvoices: INVOICES, purchaseInvoices: chunks.length, seconds: round((performance.now() - seedStarted) / 1000) };
  console.log('seed done', JSON.stringify(result.seed));

  // ---- phase 1: single user ---------------------------------------------------
  const single = new Stats();
  const reads = [
    ['items list', '/inventory/items'],
    ['item search', `/inventory/items?q=Load%20item%20${Math.floor(ITEMS / 2)}`],
    ['stock balances', '/inventory/stock'],
    ['stock of one item', `/inventory/stock?itemId=${items[0].id}`],
    ['item stock ledger', `/inventory/stock/${items[0].id}/ledger`],
    ['sales invoices list', '/sales/invoices'],
    ['customers list', '/parties/customers'],
    ['dashboard', `/dashboard/summary?from=${today.slice(0, 4)}-01-01&to=${today}`],
    ['trial balance', `/reports/trial-balance?from=${today.slice(0, 4)}-01-01&to=${today}`],
    ['general journal', `/reports/general-journal?from=${today.slice(0, 4)}-01-01&to=${today}`],
    ['stock valuation', '/inventory/reports/valuation'],
    ['receivables aging', `/reports/receivables-aging?asOf=${today}`],
    ['stock documents list', '/inventory/stock-documents'],
  ];
  for (const [name, path] of reads) {
    await call(admin, path); // warm
    for (let i = 0; i < 15; i++) single.add(name, await call(admin, path));
  }
  for (let i = 0; i < 15; i++) {
    const it = items[(i * 7) % items.length];
    const c = await call(admin, '/sales/invoices', { method: 'POST', json: { invoiceDate: today, dueDate: today, customerId: customer.id, lines: [{ itemId: it.id, quantity: '1', unitPrice: '150', taxRate: '14' }] } });
    single.add('sales invoice create', c);
    if (c.data?.id) {
      const p = await call(admin, `/sales/invoices/${c.data.id}/post`, { method: 'POST' });
      single.add('sales invoice post', p);
      if (p.status < 300) sold.set(it.id, sold.get(it.id) + 1);
    }
  }
  result.singleUser = single.summary();
  console.log('single user done');

  // ---- phase 2: concurrent mixed workload -------------------------------------
  const readOps = reads.filter(([n]) => ['items list', 'item search', 'stock of one item', 'sales invoices list', 'customers list', 'dashboard', 'trial balance', 'stock documents list'].includes(n));
  result.levels = [];
  for (const level of LEVELS) {
    const tokens = [];
    for (let i = 0; i < level; i++) tokens.push(await login());
    const stats = new Stats();
    const sampler = await startSampler();
    const endAt = Date.now() + STEP_SECONDS * 1000;
    const startedAt = performance.now();
    let total = 0;
    await Promise.all(tokens.map(async (token, u) => {
      let k = u;
      while (Date.now() < endAt) {
        k++;
        const roll = (k * 7919) % 100;
        if (roll < 70) {
          const [name, path] = readOps[k % readOps.length];
          const r = await call(token, path); stats.add(`read: ${name}`, r); total++;
        } else if (roll < 90) {
          const it = items[(u * 31 + k) % items.length];
          const c = await call(token, '/sales/invoices', { method: 'POST', json: { invoiceDate: today, dueDate: today, customerId: customer.id, lines: [{ itemId: it.id, quantity: '1', unitPrice: '150', taxRate: '14' }] } });
          stats.add('write: sales invoice create', c); total++;
          if (c.data?.id) {
            const p = await call(token, `/sales/invoices/${c.data.id}/post`, { method: 'POST' });
            stats.add('write: sales invoice post', p); total++;
            if (p.status < 300) sold.set(it.id, sold.get(it.id) + 1);
          }
        } else {
          const it = items[(u * 17 + k) % items.length];
          const c = await call(token, '/purchases/invoices', { method: 'POST', json: { invoiceDate: today, supplierId: supplier.id, lines: [{ itemId: it.id, quantity: '5', unitPrice: '100', taxRate: '14' }] } });
          stats.add('write: purchase invoice create', c); total++;
          if (c.data?.id) {
            const p = await call(token, `/purchases/invoices/${c.data.id}/post`, { method: 'POST' });
            stats.add('write: purchase invoice post', p); total++;
            if (p.status < 300) bought.set(it.id, bought.get(it.id) + 5);
          }
        }
      }
    }));
    const seconds = (performance.now() - startedAt) / 1000;
    const sys = await sampler.finish();
    const ops = stats.summary();
    const all = [...stats.byOp.values()];
    const sum = (k) => all.reduce((a, o) => a + o[k], 0);
    const allMs = all.flatMap((o) => o.ms).sort((a, b) => a - b);
    result.levels.push({ sessions: level, seconds: round(seconds), requests: total, requestsPerSecond: round(total / seconds),
      ok: sum('ok'), http429: sum('c429'), http4xx: sum('c4'), http5xx: sum('c5'), timeouts: sum('timeout'), network: sum('net'),
      overall: { p50: round(pct(allMs, 50)), p95: round(pct(allMs, 95)), p99: round(pct(allMs, 99)) }, system: sys, ops });
    console.log(`level ${level}: ${round(total / seconds)} req/s, p95 ${round(pct(allMs, 95))} ms, 5xx ${sum('c5')}, 429 ${sum('c429')}`);
  }

  // ---- phase 3: contention on one item ----------------------------------------
  const hot = await must(admin, '/inventory/items', { method: 'POST', json: { code: `LD-HOT-${stamp}`, nameEn: 'Hot item', nameAr: 'صنف ساخن', unit: 'PCS', isStockTracked: true, salePrice: '150', purchasePrice: '100', categoryId: category.id } });
  const HOT_STOCK = 50;
  await purchaseDoc([{ itemId: hot.id, quantity: String(HOT_STOCK), unitPrice: '100', taxRate: '14' }]);
  const contentionSessions = Math.max(...LEVELS.filter((l) => l <= 100));
  const tokens = [];
  for (let i = 0; i < contentionSessions; i++) tokens.push(await login());
  const cstats = new Stats();
  const sampler = await startSampler();
  let accepted = 0, refused = 0, errors = 0;
  const startedAt = performance.now();
  await Promise.all(tokens.map(async (token) => {
    for (let n = 0; n < 3; n++) {
      const c = await call(token, '/sales/invoices', { method: 'POST', json: { invoiceDate: today, dueDate: today, customerId: customer.id, lines: [{ itemId: hot.id, quantity: '1', unitPrice: '150', taxRate: '14' }] } });
      cstats.add('contention: create', c);
      if (!c.data?.id) continue;
      const p = await call(token, `/sales/invoices/${c.data.id}/post`, { method: 'POST' });
      cstats.add('contention: post', p);
      if (p.status >= 200 && p.status < 300) accepted++; else if (p.status >= 400 && p.status < 500) refused++; else errors++;
    }
  }));
  const csys = await sampler.finish();
  const hotStock = qtyOf(await must(admin, `/inventory/stock?itemId=${hot.id}`), hot.id);
  result.contention = { sessions: contentionSessions, attemptedPosts: contentionSessions * 3, startedWith: HOT_STOCK, accepted, refused, serverErrors: errors,
    stockAfter: hotStock, expectedStockAfter: HOT_STOCK - accepted, noOversell: hotStock >= 0 && accepted <= HOT_STOCK, stockMatchesAccepted: hotStock === HOT_STOCK - accepted,
    seconds: round((performance.now() - startedAt) / 1000), system: csys, ops: cstats.summary() };
  console.log('contention', JSON.stringify({ accepted, refused, errors, hotStock }));

  // ---- consistency: stock per item == bought - sold ---------------------------
  const sample = items.filter((_, i) => i % 5 === 0);
  let mismatches = 0; const wrong = [];
  for (const it of sample) {
    const q = qtyOf(await call(admin, `/inventory/stock?itemId=${it.id}`).then((r) => r.data), it.id);
    const want = bought.get(it.id) - sold.get(it.id);
    if (q !== want) { mismatches++; if (wrong.length < 5) wrong.push({ code: it.code, api: q, expected: want }); }
  }
  result.consistency = { itemsChecked: sample.length, mismatches, examples: wrong };

  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
  console.log('LOADRESULT-BEGIN');
  console.log(JSON.stringify(result));
  console.log('LOADRESULT-END');
}

main().catch((error) => { console.error('LOAD CHECK FAILED TO RUN:', error?.stack ?? error); process.exit(2); });
