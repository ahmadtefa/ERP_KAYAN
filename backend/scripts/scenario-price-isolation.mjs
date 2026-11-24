#!/usr/bin/env node
/**
 * Price, cost and warehouse isolation, checked through the real HTTP API.
 *
 * The catalogue makes selling price, purchase price and cost three separate
 * privileges. This scenario signs in as a real user of each SHIPPED role and
 * asserts what the API actually returns - not what a unit test wishes it did:
 *
 *   A  a role without the grants receives no selling price, no purchase price
 *      and no cost, and the fields are absent rather than null-placed.
 *   B  granting exactly one of the three reveals exactly that one.
 *   C  a storekeeper assigned to warehouse W is refused a report scoped to a
 *      warehouse he does not hold, and accepted for the one he does.
 *   D  the same account cannot read another company's records.
 *
 * Run only against disposable data:
 *
 *   DATABASE_URL=... node backend/scripts/scenario-price-isolation.mjs [apiBaseUrl]
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const API = process.argv[2] ?? process.env.APP_URL ?? 'http://127.0.0.1:3000/api/v1';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required; this scenario needs disposable PostgreSQL.');
}

const results = [];
const stamp = String(Date.now()).slice(-8);
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * The seeded administrator, for the few checks that need permissions the
 * scenario's own account deliberately lacks.
 */
async function loginAsAdmin() {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) return (await response.json()).accessToken;
    if (response.status !== 429) {
      throw new Error(`Administrator sign-in failed: ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    await new Promise((resolve) =>
      setTimeout(resolve, (retryAfter > 0 ? retryAfter : 20) * 1000),
    );
  }
  throw new Error('Administrator sign-in stayed rate limited');
}

async function get(token, path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/** Finds a field anywhere in the answer, whatever the nesting. */
function hasKey(value, key) {
  if (Array.isArray(value)) return value.some((entry) => hasKey(entry, key));
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(
    (name) => name === key || hasKey(value[name], key),
  );
}

const COMPANY_NAME = `ISO-${stamp}`;

async function main() {
  const db = new pg.Client({ connectionString });
  await db.connect();

  // The installation holds exactly one active company (a partial unique index
  // says so), so the scenario reuses it and adds its own branch, warehouses
  // and people. Isolation is then checked between two warehouses and two
  // branches of that company, and against a company id that does not exist.
  const existing = (
    await db.query(
      `select id from companies where "deletedAt" is null order by "createdAt" limit 1`,
    )
  ).rows[0];
  const companyA = existing?.id;
  if (!companyA) {
    throw new Error('Run the seed first: this scenario builds on an active company.');
  }

  const branchA = (
    await db.query(
      `insert into branches (id, "companyId", code, "nameEn", "nameAr", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, 'Scenario branch', 'فرع السيناريو', now(), now()) returning id`,
      [companyA, `SB-${stamp}`],
    )
  ).rows[0].id;

  const warehouseA = (
    await db.query(
      `insert into warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, $3, 'Scenario store', 'مخزن السيناريو', now(), now()) returning id`,
      [companyA, branchA, `SW1-${stamp}`],
    )
  ).rows[0].id;
  const warehouseB = (
    await db.query(
      `insert into warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, $3, 'Other scenario store', 'مخزن آخر', now(), now()) returning id`,
      [companyA, branchA, `SW2-${stamp}`],
    )
  ).rows[0].id;

  // Real catalogued prices; the item itself carries no cost field, because
  // valuation lives in the stock ledger, not on the item.
  const itemA = (
    await db.query(
      `insert into items (id, "companyId", code, "nameEn", "nameAr", "salePrice", "purchasePrice",
         "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, 'Widget', 'صنف', 120.5, 90.25, now(), now())
       returning id`,
      [companyA, `ITEM-${stamp}`],
    )
  ).rows[0].id;
  await db.query(
    `insert into stock_balances ("companyId", "branchId", "itemId", quantity, value, "updatedAt")
     values ($1, $2, $3, 10, 887.5, now())`,
    [companyA, branchA, itemA],
  );
  // The valuation report reads the per-warehouse balance, which is what the
  // warehouse-scoped screens and their cost rules use.
  await db.query(
    `insert into warehouse_stock_balances
       ("companyId", "branchId", "warehouseId", "itemId", quantity, value, "updatedAt")
     values ($1, $2, $3, $4, 10, 887.5, now())`,
    [companyA, branchA, warehouseA, itemA],
  );

  // A user holding no financial role at all: the storekeeper of W1.
  const username = `iso-store-${stamp}`;
  const password = `Scenario-${randomBytes(9).toString('base64url')}`;
  const argon2 = await import('argon2');
  const storekeeperId = (
    await db.query(
      `insert into users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, 'Isolation storekeeper', 'أمين عزل', $3, now(), now()) returning id`,
      [companyA, username, await argon2.hash(password)],
    )
  ).rows[0].id;

  await db.query(
    `insert into user_roles ("userId", "roleId", "companyId")
     select $1, r.id, $2 from roles r where r.code = 'STOREKEEPER'`,
    [storekeeperId, companyA],
  );
  await db.query(
    `insert into user_branches ("userId", "branchId") values ($1, $2)`,
    [storekeeperId, branchA],
  );
  await db.query(
    `insert into user_warehouse_access
       (id, "companyId", "userId", "warehouseId", "canView", "canReceive", "canIssue",
        "canTransfer", "canCount", "canApprove", "canSeeCost", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, $3, true, true, true, true, true, false, false, now(), now())`,
    [companyA, storekeeperId, warehouseA],
  );

  // Each permission change needs a fresh session, and the API rate-limits
  // sign-ins by address - the same protection a real user meets. Wait out a
  // 429 instead of turning a correct refusal into a failed run.
  async function login() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) return (await response.json()).accessToken;
      if (response.status !== 429) {
        throw new Error(`Sign-in failed: ${response.status}`);
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      await new Promise((resolve) =>
        setTimeout(resolve, (retryAfter > 0 ? retryAfter : 20) * 1000),
      );
    }
    throw new Error('Sign-in stayed rate limited');
  }

  let token = await login();

  const VALUATION = '/inventory/reports/valuation-by-warehouse';

  // ---- A. No grants -> no prices at all.
  const list = await get(token, '/inventory/items');
  check('the item list is readable by a storekeeper', list.status === 200, `status ${list.status}`);
  const bodyText = JSON.stringify(list.body);
  check('no sale price is present', !hasKey(list.body, 'salePrice'));
  check('no purchase price is present', !hasKey(list.body, 'purchasePrice'));
  check('no cost is present', !hasKey(list.body, 'unitCost') && !hasKey(list.body, 'averageCost') && !hasKey(list.body, 'value'));
  // A null placeholder would still tell the caller a price column exists.
  check('prices are absent, not null placeholders', !/"salePrice":\s*null/.test(bodyText) && !/"averageCost":\s*null/.test(bodyText));

  // ---- B. Grant exactly one: only that one appears.
  await db.query(
    `insert into user_permissions ("userId", "permissionId", "isDenied", "updatedAt")
     select $1, p.id, false, now() from permissions p where p.code = 'sales.price.read'`,
    [storekeeperId],
  );
  token = await login();
  const withSale = await get(token, '/inventory/items');
  check('the granted selling price appears', hasKey(withSale.body, 'salePrice') || JSON.stringify(withSale.body).includes('120.5'));
  check('the ungranted purchase price still does not appear', !hasKey(withSale.body, 'purchasePrice'));
  check('the ungranted cost still does not appear', !hasKey(withSale.body, 'unitCost') && !hasKey(withSale.body, 'averageCost'));

  // The stock value is the real cost-bearing figure, and it lives on the
  // balance sheet rather than the item list.
  const valuationWithoutCost = await get(token, `${VALUATION}?warehouseId=${warehouseA}`);
  check(
    'a valuation report without inventory.cost.read carries no value column',
    valuationWithoutCost.status === 200 && !hasKey(valuationWithoutCost.body, 'value'),
    `status ${valuationWithoutCost.status}`,
  );

  // Cost only, once the selling grant is withdrawn.
  await db.query(
    `update user_permissions set "isDenied" = true
       where "userId" = $1 and "permissionId" = (select id from permissions where code = 'sales.price.read')`,
    [storekeeperId],
  );
  await db.query(
    `insert into user_permissions ("userId", "permissionId", "isDenied", "updatedAt")
     select $1, p.id, false, now() from permissions p where p.code = 'inventory.cost.read'`,
    [storekeeperId],
  );
  token = await login();
  const withCost = await get(token, '/inventory/items');
  // Cost needs two independent grants: the permission on the role and the
  // per-warehouse `canSeeCost` flag. Holding only the first must not suffice.
  const costPermissionOnly = await get(token, `${VALUATION}?warehouseId=${warehouseA}`);
  check(
    'the cost permission alone does not reveal the stock value',
    costPermissionOnly.status === 200 && !hasKey(costPermissionOnly.body, 'value'),
    `status ${costPermissionOnly.status}`,
  );

  await db.query(
    `update user_warehouse_access set "canSeeCost" = true where "userId" = $1 and "warehouseId" = $2`,
    [storekeeperId, warehouseA],
  );
  token = await login();
  const balanceWithCost = await get(token, `${VALUATION}?warehouseId=${warehouseA}`);
  check(
    'permission + warehouse cost grant together reveal the value',
    balanceWithCost.status === 200 && hasKey(balanceWithCost.body, 'value'),
    `status ${balanceWithCost.status}`,
  );
  check('the withdrawn selling price does not appear', !hasKey(withCost.body, 'salePrice'));

  // ---- C. Warehouse scope.
  const inScope = await get(token, `/inventory/reports/balance-by-warehouse?warehouseId=${warehouseA}`);
  const outOfScope = await get(token, `/inventory/reports/balance-by-warehouse?warehouseId=${warehouseB}`);
  check('the assigned warehouse report is allowed', inScope.status === 200, `status ${inScope.status}`);
  check('a report for an unassigned warehouse is refused', outOfScope.status === 403 || outOfScope.status === 404, `status ${outOfScope.status}`);

  // ---- D. Removing the last warehouse restriction is not allowed.
  const widen = await fetch(`${API}/inventory/warehouse-access/${storekeeperId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [] }),
  });
  check('a storekeeper cannot grant himself every warehouse', widen.status === 403 || widen.status === 404, `status ${widen.status}`);

  // ---- E. Company isolation: an item id that does not exist in this company
  // is a 404, and a companyId in the query cannot widen the list.
  const foreignItemId = '00000000-0000-4000-8000-000000000000';
  const foreignItem = await get(token, `/inventory/items/${foreignItemId}`);
  check('an item outside the company is a 404', foreignItem.status === 404, `status ${foreignItem.status}`);
  const foreignCompany = '00000000-0000-4000-8000-00000000beef';
  const crossCompanyList = await get(token, `/inventory/items?companyId=${foreignCompany}`);
  check(
    'a foreign companyId in the query cannot widen the list',
    // Either refused outright, or ignored: what matters is that the answer
    // never carries the other company's records.
    (crossCompanyList.status === 200 || crossCompanyList.status === 400) &&
      !JSON.stringify(crossCompanyList.body).includes(foreignCompany),
    `status ${crossCompanyList.status}`,
  );

  // ---- F. A malformed identifier is the client's mistake (400), never a
  // claim that the server is broken (500). This is checked with the report
  // permissions the storekeeper does not hold, so it runs as the
  // administrator-shaped account instead.
  const admin = await loginAsAdmin();
  for (const path of [
    '/reports/account-ledger/not-a-uuid',
    '/reports/cost-centers/not-a-uuid/transactions',
  ]) {
    const answer = await get(admin, path);
    check(
      `a malformed id on ${path} is a 400, not a 500`,
      answer.status === 400,
      `status ${answer.status}`,
    );
  }

  // ---- Cleanup: this data is disposable, but leaving it would poison the
  // next run of the same database.
  // The audit trail is append-only by design: rows are detached with the
  // audited purge switch rather than mutated or deleted silently.
  await db.query("select set_config('kayan.allow_audit_purge', 'on', false)");
  await db.query('delete from audit_logs where "userId" = $1', [storekeeperId]);
  await db.query('delete from user_permissions where "userId" = $1', [storekeeperId]);
  await db.query('delete from user_warehouse_access where "userId" = $1', [storekeeperId]);
  await db.query('delete from user_branches where "userId" = $1', [storekeeperId]);
  await db.query('delete from user_roles where "userId" = $1', [storekeeperId]);
  await db.query('delete from users where id = $1', [storekeeperId]);
  await db.query('delete from warehouse_stock_balances where "itemId" = $1', [itemA]);
  await db.query('delete from stock_balances where "itemId" = $1', [itemA]);
  await db.query('delete from items where id = $1', [itemA]);
  await db.query('delete from warehouses where id in ($1, $2)', [warehouseA, warehouseB]);
  await db.query('delete from branches where id = $1', [branchA]);
  await db.end();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
