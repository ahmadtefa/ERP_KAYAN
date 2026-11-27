#!/usr/bin/env node
// Synthetic data generator for KAYAN load tests. Node 18+. No dependencies.
// Everything is fake: names, phones (000...), emails (@example.invalid), prices.
//
//   node gen-data.mjs                      -> writes ./data/*.json and *.csv (offline, touches nothing)
//   SEED=1 ADMIN_PASSWORD=... node gen-data.mjs
//        -> ALSO creates the customers, items and DRAFT sales invoices on a TEST server via the API
//           and writes data/seeded-ids.json
//   CLEANUP=1 ADMIN_PASSWORD=... node gen-data.mjs
//        -> deactivates the customers and items listed in data/seeded-ids.json
//
// Env: CUSTOMERS=200 ITEMS=300 INVOICES=100 SEED_NUMBER=42 PREFIX=SYN
//      BASE_URL=http://127.0.0.1:3000/api/v1  ADMIN_USERNAME=admin  ADMIN_PASSWORD=...
//      DELAY_MS=250 (pause between API writes; the default API limit is 300 requests/min per IP,
//      raise RATE_LIMIT_MAX on the test server or keep DELAY_MS >= 250)
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const N_CUST = Number(process.env.CUSTOMERS || 200);
const N_ITEM = Number(process.env.ITEMS || 300);
const N_INV = Number(process.env.INVOICES || 100);
const PREFIX = process.env.PREFIX || 'SYN';
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const DELAY = Number(process.env.DELAY_MS || 250);
const OUT = 'data';

// small deterministic PRNG (mulberry32) so the same SEED_NUMBER gives the same data
let s = Number(process.env.SEED_NUMBER || 42) >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n, w = 5) => String(n).padStart(w, '0');
const money = (n) => n.toFixed(2);

const firstAr = ['محمد', 'أحمد', 'محمود', 'علي', 'حسن', 'إبراهيم', 'مصطفى', 'خالد'];
const lastAr = ['السيد', 'عبد الله', 'فؤاد', 'النجار', 'صبري', 'عمر', 'زكي', 'منصور'];
const firstEn = ['Mohamed', 'Ahmed', 'Mahmoud', 'Ali', 'Hassan', 'Ibrahim', 'Mostafa', 'Khaled'];
const lastEn = ['ElSayed', 'AbdAllah', 'Fouad', 'ElNaggar', 'Sabry', 'Omar', 'Zaki', 'Mansour'];
const kinds = [['شركة', 'Co.'], ['مؤسسة', 'Est.'], ['مكتب', 'Office']];
const itemKinds = [['كابل نحاس', 'Copper cable'], ['لوح طوب عازل', 'Insulating block'], ['مفتاح قاطع', 'Circuit breaker'], ['مواسير', 'Pipes'], ['مصباح LED', 'LED lamp'], ['علبة توصيل', 'Junction box']];
const units = ['PCS', 'BOX', 'M', 'KG'];

const customers = Array.from({ length: N_CUST }, (_, i) => {
  const k = pick(kinds), a = int(0, 7), b = int(0, 7);
  const code = `${PREFIX}-C-${pad(i + 1)}`;
  return {
    code,
    nameAr: `${k[0]} ${firstAr[a]} ${lastAr[b]} (اختبار)`,
    nameEn: `${firstEn[a]} ${lastEn[b]} ${k[1]} TEST ${i + 1}`,
    phone: `000${pad(int(0, 9999999), 7)}`,
    email: `${code.toLowerCase()}@example.invalid`,
    address: `Synthetic address ${i + 1}`,
    notes: 'synthetic load-test record',
    paymentTermDays: pick([0, 15, 30, 45, 60]),
    creditLimit: money(int(1, 50) * 10000),
  };
});

const items = Array.from({ length: N_ITEM }, (_, i) => {
  const k = pick(itemKinds), cost = int(5, 2000);
  const code = `${PREFIX}-I-${pad(i + 1)}`;
  return {
    code,
    nameAr: `${k[0]} نوع ${i + 1} (اختبار)`,
    nameEn: `${k[1]} model ${i + 1} TEST`,
    unit: pick(units),
    barcode: `99${pad(i + 1, 10)}`,
    purchasePrice: money(cost),
    salePrice: money(cost * (1.1 + rnd() * 0.4)),
    reorderLevel: String(int(0, 20)),
    isStockTracked: false, // no stock movement => no accounting side effects for drafts
    notes: 'synthetic load-test record',
  };
});

mkdirSync(OUT, { recursive: true });
const csv = (rows) => { const h = Object.keys(rows[0]); return [h.join(','), ...rows.map((r) => h.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n'); };
writeFileSync(`${OUT}/customers.json`, JSON.stringify(customers, null, 2));
writeFileSync(`${OUT}/items.json`, JSON.stringify(items, null, 2));
writeFileSync(`${OUT}/customers.csv`, '\uFEFF' + csv(customers));
writeFileSync(`${OUT}/items.csv`, '\uFEFF' + csv(items));

// Invoice templates reference customers/items by CODE; real UUIDs are filled in when SEED=1.
const invoices = Array.from({ length: N_INV }, () => {
  const d = new Date(Date.UTC(2026, int(0, 10), int(1, 28)));
  return {
    invoiceDate: d.toISOString().slice(0, 10),
    customerCode: pick(customers).code,
    notes: 'synthetic load-test invoice',
    lines: Array.from({ length: int(1, 6) }, () => { const it = pick(items); return { itemCode: it.code, quantity: String(int(1, 20)), unitPrice: it.salePrice }; }),
  };
});
writeFileSync(`${OUT}/invoice-templates.json`, JSON.stringify(invoices, null, 2));
console.log(`wrote ${OUT}/: ${customers.length} customers, ${items.length} items, ${invoices.length} invoice templates`);

// ---------------------------------------------------------------- API seeding / cleanup
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
async function api(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429) { await sleep(Math.min(Number(r.headers.get('retry-after') || 5), 70) * 1000); continue; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  }
  return { status: 429, json: null, text: 'rate limited' };
}
async function signIn() {
  if (!process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD (test environment only).');
  const r = await api('POST', '/auth/login', { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD });
  token = r.json?.accessToken; if (!token) throw new Error(`login failed: ${r.status}`);
}

if (process.env.SEED === '1') {
  await signIn();
  const ids = { customers: {}, items: {}, invoices: [] };
  const fails = [];
  for (const c of customers) {
    const { creditLimit, ...rest } = c;
    const r = await api('POST', '/parties/customers', { ...rest, creditLimit });
    if (r.json?.id) ids.customers[c.code] = r.json.id; else fails.push(['customer', c.code, r.status, r.text.slice(0, 160)]);
    await sleep(DELAY);
  }
  for (const it of items) {
    const r = await api('POST', '/inventory/items', it);
    if (r.json?.id) ids.items[it.code] = r.json.id; else fails.push(['item', it.code, r.status, r.text.slice(0, 160)]);
    await sleep(DELAY);
  }
  for (const inv of invoices) {
    const customerId = ids.customers[inv.customerCode];
    const lines = inv.lines.map((l) => ({ itemId: ids.items[l.itemCode], quantity: l.quantity, unitPrice: l.unitPrice })).filter((l) => l.itemId);
    if (!customerId || !lines.length) continue;
    const r = await api('POST', '/sales/invoices', { invoiceDate: inv.invoiceDate, customerId, notes: inv.notes, lines }); // draft only, never /post
    if (r.json?.id) ids.invoices.push(r.json.id); else fails.push(['invoice', inv.customerCode, r.status, r.text.slice(0, 160)]);
    await sleep(DELAY);
  }
  writeFileSync(`${OUT}/seeded-ids.json`, JSON.stringify(ids, null, 2));
  console.log(`seeded: ${Object.keys(ids.customers).length} customers, ${Object.keys(ids.items).length} items, ${ids.invoices.length} draft invoices; ${fails.length} failures`);
  if (fails.length) { writeFileSync(`${OUT}/seed-failures.json`, JSON.stringify(fails, null, 2)); console.log(`see ${OUT}/seed-failures.json`); }
}

if (process.env.CLEANUP === '1') {
  if (!existsSync(`${OUT}/seeded-ids.json`)) throw new Error('no data/seeded-ids.json');
  await signIn();
  const ids = JSON.parse(readFileSync(`${OUT}/seeded-ids.json`, 'utf8'));
  let n = 0;
  for (const id of Object.values(ids.customers)) { await api('POST', `/parties/customers/${id}/deactivate`, {}); n++; await sleep(DELAY); }
  for (const id of Object.values(ids.items)) { await api('POST', `/inventory/items/${id}/deactivate`, {}); n++; await sleep(DELAY); }
  console.log(`deactivated ${n} synthetic records. Draft invoices (${ids.invoices.length}) have no delete route in the API reads; remove them by resetting the TEST database.`);
}
