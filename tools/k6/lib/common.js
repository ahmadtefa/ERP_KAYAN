// Shared helpers for the KAYAN k6 scripts.
// Endpoints below were read from backend/src/modules/*/ *.controller.ts
// in ERP_KAYAN (global prefix api/v1, bearer JWT from POST /auth/login).
import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
export const USERNAME = __ENV.ADMIN_USERNAME || 'admin';
export const PASSWORD = __ENV.ADMIN_PASSWORD || ''; // set it; no default is baked in
export const WRITES = __ENV.WRITES === '1'; // opt-in: creates synthetic K6- customers
export const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;

export const rateLimited = new Counter('kayan_http_429');
export const unauthorized = new Counter('kayan_http_401');
export const serverErrors = new Counter('kayan_http_5xx');
export const okRate = new Rate('kayan_checks_ok');
export const reportTime = new Trend('kayan_report_duration', true);

export function login() {
  if (!PASSWORD) fail('Set ADMIN_PASSWORD (a test-environment account only).');
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } },
  );
  const token = res.status === 201 || res.status === 200 ? res.json('accessToken') : '';
  if (!token) fail(`login failed, status ${res.status} (429 = rate limit, see README)`);
  return token;
}

export function headers(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

// GET with a stable `name` tag so URLs with ids/queries do not explode metric cardinality.
export function get(token, path, name, extra = {}) {
  const res = http.get(`${BASE_URL}${path}`, { ...headers(token), tags: { name: `GET ${name}` }, ...extra });
  track(res);
  return res;
}

export function post(token, path, body, name) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), { ...headers(token), tags: { name: `POST ${name}` } });
  track(res);
  return res;
}

export function track(res) {
  if (res.status === 429) rateLimited.add(1);
  if (res.status === 401) unauthorized.add(1);
  if (res.status >= 500) serverErrors.add(1);
}

export function expect2xx(res, label) {
  const ok = check(res, { [`${label} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  okRate.add(ok);
  return ok;
}

export function pick(arr) {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

export function firstIds(res) {
  // List endpoints may return an array or {data|items:[...]}; accept both.
  let body;
  try { body = res.json(); } catch (e) { return []; }
  const rows = Array.isArray(body) ? body : (body && (body.data || body.items || body.rows)) || [];
  return rows.map((r) => r.id).filter(Boolean);
}

// One "user session": what an accountant does after sign-in. Read-only by default.
// Uses only GET routes (plus optional synthetic customer create when WRITES=1).
export function userSession(token) {
  expect2xx(get(token, '/auth/me', '/auth/me'), 'me');
  expect2xx(get(token, '/dashboard/summary', '/dashboard/summary'), 'dashboard summary');
  expect2xx(get(token, '/dashboard/monthly?months=6', '/dashboard/monthly'), 'dashboard monthly');

  const cust = get(token, '/parties/customers?page=1&pageSize=25', '/parties/customers');
  expect2xx(cust, 'customers list');
  const custId = pick(firstIds(cust));
  if (custId) expect2xx(get(token, `/parties/customers/${custId}`, '/parties/customers/:id'), 'customer detail');

  const items = get(token, '/inventory/items?page=1&pageSize=25', '/inventory/items');
  expect2xx(items, 'items list');
  const itemId = pick(firstIds(items));
  if (itemId) expect2xx(get(token, `/inventory/items/${itemId}`, '/inventory/items/:id'), 'item detail');

  expect2xx(get(token, '/inventory/stock?page=1&pageSize=25', '/inventory/stock'), 'stock');
  expect2xx(get(token, '/inventory/warehouses', '/inventory/warehouses'), 'warehouses');
  expect2xx(get(token, '/sales/invoices?page=1&pageSize=25', '/sales/invoices'), 'sales invoices list');
  expect2xx(get(token, '/sales/quotations', '/sales/quotations'), 'quotations list');
  expect2xx(get(token, '/search?q=a&limit=8', '/search'), 'global search');
}

// Heavier, report-style reads (aggregation queries).
export function reportSession(token) {
  for (const [p, label] of [
    ['/reports/trial-balance', 'trial balance'],
    ['/reports/profit-and-loss', 'profit and loss'],
    ['/reports/balance-sheet', 'balance sheet'],
    ['/reports/receivables-aging', 'receivables aging'],
    ['/reports/customer-balances', 'customer balances'],
    ['/inventory/reports/valuation', 'inventory valuation'],
  ]) {
    const r = get(token, p, p);
    reportTime.add(r.timings.duration);
    expect2xx(r, label);
  }
}

// Optional write: a synthetic customer (code K6-<run>-<vu>-<iter>), then deactivated.
export function syntheticCustomer(token, vu, iter) {
  const code = `K6-${RUN_ID}-${vu}-${iter}`.slice(0, 30);
  const res = post(token, '/parties/customers', {
    code,
    nameEn: `K6 Synthetic ${code}`,
    nameAr: `عميل اختبار ${code}`,
    phone: '0000000000',
    email: `${code.toLowerCase()}@example.invalid`,
    paymentTermDays: 30,
  }, '/parties/customers');
  if (expect2xx(res, 'synthetic customer create')) {
    const id = res.json('id');
    if (id) expect2xx(post(token, `/parties/customers/${id}/deactivate`, {}, '/parties/customers/:id/deactivate'), 'synthetic customer deactivate');
  }
}

export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'GET /health' } });
  track(res);
  return res;
}

export function standardThresholds(p95 = 1500) {
  return {
    http_req_failed: ['rate<0.02'],
    http_req_duration: [`p(95)<${p95}`],
    kayan_checks_ok: ['rate>0.98'],
    kayan_http_5xx: ['count==0'],
  };
}
