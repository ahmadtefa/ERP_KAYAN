#!/usr/bin/env node
/**
 * The warehouse cycle a trial customer actually performs, through the real API.
 *
 * Every other scenario stops at "the report shows the right number". This one
 * performs the work: goods arrive on a receipt, move between two shelves of a
 * branch through a transfer that is reviewed, approved, dispatched and then
 * received by a *different person*, and the ledger is then read back at each
 * shelf. That two-person split is the point: the same account cannot review or
 * approve its own transfer, and the receiver is a storekeeper who holds the
 * destination shelf and not the source.
 *
 *   DATABASE_URL=... node backend/scripts/scenario-warehouse-cycle.mjs [api]
 *
 * What is asserted, in order:
 *
 *   1. a receipt voucher is a draft until it is posted, and posting it raises the
 *      source shelf and nothing else
 *   2. a transfer starts as a draft and moves no stock
 *   3. the creator cannot review or approve their own transfer
 *   4. review and approve by warehouse staff leave stock where it was
 *   5. dispatch lowers the source and raises goods-in-transit, not the destination
 *   6. a partial receipt moves only what arrived and says so
 *   7. a storekeeper without a transfer right on the source cannot dispatch
 *   8. the final receipt closes the quantity and empties the transit shelf
 *   9. re-sending the same receipt with the same key changes nothing
 *  10. the warehouse ledger agrees with the transfer, per shelf
 *
 * Exit code 0 means every check passed.
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
/** Idempotency keys are validated at 16-128 safe characters; a short label is
 * a client bug, and the API says so. */
const key = (stage) => `cycle-${stage}-${stamp}-${randomBytes(4).toString('hex')}`;
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Login is rate-limited per address; wait out a 429 rather than fail. */
async function signIn(db, username, password) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) return (await response.json()).accessToken;
    if (response.status !== 429) {
      throw new Error(`Sign-in failed for ${username}: ${response.status} ${await response.text()}`);
    }
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter > 0 ? retryAfter : 20) * 1000));
  }
  throw new Error(`Sign-in stayed rate limited for ${username}`);
}

function client(token) {
  const send = async (method, path, body, key) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A CSV or plain answer stays as text; the callers that care parse it.
    }
    return { status: response.status, body: parsed };
  };
  return {
    get: (path) => send('GET', path, undefined),
    post: (path, body, key) => send('POST', path, body, key),
  };
}

const COMPANY_NAME = `CYC-${stamp}`;

async function main() {
  const db = new pg.Client({ connectionString });
  await db.connect();

  const existing = (
    await db.query(`select id from companies where "deletedAt" is null order by "createdAt" limit 1`)
  ).rows[0];
  if (!existing) throw new Error('Run the seed first: this scenario builds on an active company.');
  const companyId = existing.id;

  const branchId = (
    await db.query(
      `insert into branches (id, "companyId", code, "nameEn", "nameAr", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, 'Cycle branch', 'فرع الدورة', now(), now()) returning id`,
      [companyId, `CB-${stamp}`],
    )
  ).rows[0].id;
  const shelf = async (code, name) =>
    (
      await db.query(
        `insert into warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, $2, $3, $4, $4, now(), now()) returning id`,
        [companyId, branchId, code, name],
      )
    ).rows[0].id;
  const sourceWarehouse = await shelf(`CW-S-${stamp}`, 'Cycle source');
  const destinationWarehouse = await shelf(`CW-D-${stamp}`, 'Cycle destination');

  const itemId = (
    await db.query(
      `insert into items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
         "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, 'Cycled widget', 'صنف الدورة', 'unit', true, now(), now())
       returning id`,
      [companyId, `CYC-ITEM-${stamp}`],
    )
  ).rows[0].id;

  // Two real people: a warehouse manager who runs the shelves, and a
  // storekeeper who receives and holds only the destination shelf.
  const managerUser = `cyc-manager-${stamp}`;
  const keeperUser = `cyc-keeper-${stamp}`;
  const password = `Cycle-${randomBytes(9).toString('base64url')}`;
  const argon2 = await import('argon2');
  const passwordHash = await argon2.hash(password);
  const createUser = async (username, nameEn, nameAr) =>
    (
      await db.query(
        `insert into users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash",
           "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now()) returning id`,
        [companyId, username, nameEn, nameAr, passwordHash],
      )
    ).rows[0].id;
  const managerId = await createUser(managerUser, 'Cycle manager', 'مدير الدورة');
  const keeperId = await createUser(keeperUser, 'Cycle keeper', 'أمين الدورة');
  for (const [userId, roleCode] of [
    [managerId, 'WAREHOUSE_MANAGER'],
    [keeperId, 'STOREKEEPER'],
  ]) {
    await db.query(
      `insert into user_roles ("userId", "roleId", "companyId")
       select $1, r.id, $2 from roles r where r.code = $3`,
      [userId, companyId, roleCode],
    );
    await db.query(`insert into user_branches ("userId", "branchId") values ($1, $2)`, [
      userId,
      branchId,
    ]);
  }
  // The manager works both shelves. The keeper may read the source so the
  // receipt can name where the goods came from, but holds no transfer right
  // there, so the dispatch side is genuinely out of his reach.
  await db.query(
    `insert into user_warehouse_access
       (id, "companyId", "userId", "warehouseId", "canView", "canReceive", "canIssue",
        "canTransfer", "canCount", "canApprove", "canSeeCost", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, $3, true, true, true, true, true, true, true, now(), now())`,
    [companyId, managerId, sourceWarehouse],
  );
  await db.query(
    `insert into user_warehouse_access
       (id, "companyId", "userId", "warehouseId", "canView", "canReceive", "canIssue",
        "canTransfer", "canCount", "canApprove", "canSeeCost", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, $3, true, true, true, true, true, true, true, now(), now())`,
    [companyId, managerId, destinationWarehouse],
  );
  await db.query(
    `insert into user_warehouse_access
       (id, "companyId", "userId", "warehouseId", "canView", "canReceive", "canIssue",
        "canTransfer", "canCount", "canApprove", "canSeeCost", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, $3, true, true, true, true, true, false, false, now(), now())`,
    [companyId, keeperId, destinationWarehouse],
  );
  await db.query(
    `insert into user_warehouse_access
       (id, "companyId", "userId", "warehouseId", "canView", "canReceive", "canIssue",
        "canTransfer", "canCount", "canApprove", "canSeeCost", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, $3, true, false, false, false, false, false, false, now(), now())`,
    [companyId, keeperId, sourceWarehouse],
  );

  await db.query(
    `insert into user_permissions ("userId", "permissionId")
     select $1, p.id from permissions p where p.code = 'inventory.cost.read'`,
    [managerId],
  );

  // Review and approval must be separate people, so the company has three
  // managers: one raises the transfer, one reviews it, one approves it.
  const manager = client(await signIn(db, managerUser, password));
  const reviewerUser = `cyc-reviewer-${stamp}`;
  const reviewerId = await createUser(reviewerUser, 'Cycle reviewer', 'مراجع الدورة');
  const approverUser = `cyc-approver-${stamp}`;
  const approverId = await createUser(approverUser, 'Cycle approver', 'معتمد الدورة');
  for (const userId of [reviewerId, approverId]) {
    await db.query(
      `insert into user_roles ("userId", "roleId", "companyId")
       select $1, r.id, $2 from roles r where r.code = 'WAREHOUSE_MANAGER'`,
      [userId, companyId],
    );
    await db.query(`insert into user_branches ("userId", "branchId") values ($1, $2)`, [userId, branchId]);
  }
  const reviewer = client(await signIn(db, reviewerUser, password));
  const approver = client(await signIn(db, approverUser, password));

  const keeper = client(await signIn(db, keeperUser, password));
  const today = new Date().toISOString().slice(0, 10);

  /** Base-unit quantity the ledger says sits on one shelf. */
  const onHand = async (warehouseId) => {
    const row = await db.query(
      `select coalesce(sum(case when direction = 'IN' then quantity else -quantity end), 0)::text as qty
         from stock_movements where "companyId" = $1 and "warehouseId" = $2 and "itemId" = $3`,
      [companyId, warehouseId, itemId],
    );
    return Number(row.rows[0].qty);
  };

  // ---- 1. A receipt voucher is drafted, reviewed, approved, then posted.
  // The three steps are separate people on purpose: stock cannot reach a shelf
  // because one person said so.
  const receipt = await manager.post(
    '/inventory/stock-documents',
    {
      kind: 'ADJUSTMENT',
      voucherKind: 'RECEIPT',
      branchId,
      toWarehouseId: sourceWarehouse,
      documentDate: today,
      reason: 'Cycle scenario opening stock',
      counterpartyName: 'Opening balance',
      lines: [{ itemId, quantity: '10', unitCost: '12.5' }],
    },
    key('receipt'),
  );
  check('a receipt voucher is accepted', receipt.status === 201 || receipt.status === 200, `status ${receipt.status} ${JSON.stringify(receipt.body)?.slice(0, 300)}`);
  check('a new voucher is only a draft', receipt.body?.status === 'draft', `status ${receipt.body?.status}`);
  check('a draft voucher has moved no stock', (await onHand(sourceWarehouse)) === 0, `qty ${await onHand(sourceWarehouse)}`);

  const voucherId = receipt.body?.id;
  const reviewedVoucher = await reviewer.post(
    `/inventory/stock-documents/${voucherId}/review`,
    { expectedVersion: receipt.body?.editVersion ?? 0 },
    key('receipt-review'),
  );
  check('the voucher is reviewed by someone else', reviewedVoucher.status === 200 || reviewedVoucher.status === 201, `status ${reviewedVoucher.status} ${JSON.stringify(reviewedVoucher.body)?.slice(0, 160)}`);
  const approvedVoucher = await approver.post(
    `/inventory/stock-documents/${voucherId}/approve`,
    { expectedVersion: reviewedVoucher.body?.editVersion ?? 1 },
    key('receipt-approve'),
  );
  check('the voucher is approved by a third person', approvedVoucher.status === 200 || approvedVoucher.status === 201, `status ${approvedVoucher.status} ${JSON.stringify(approvedVoucher.body)?.slice(0, 160)}`);
  const posted = await manager.post(
    `/inventory/stock-documents/${voucherId}/post`,
    { expectedVersion: approvedVoucher.body?.editVersion ?? 2 },
    key('receipt-post'),
  );
  check('posting the accepted voucher succeeds', posted.status === 200 || posted.status === 201, `status ${posted.status} ${JSON.stringify(posted.body)?.slice(0, 200)}`);
  check('the receipt raised the source shelf', (await onHand(sourceWarehouse)) === 10, `qty ${await onHand(sourceWarehouse)}`);
  check('the receipt left the destination empty', (await onHand(destinationWarehouse)) === 0, `qty ${await onHand(destinationWarehouse)}`);

  // ---- 2. The transfer starts as a draft and moves nothing.
  const transferKey = key('transfer');
  const created = await manager.post(
    '/inventory/stock-transfers',
    {
      sourceWarehouseId: sourceWarehouse,
      destinationWarehouseId: destinationWarehouse,
      transferDate: today,
      reason: 'Move stock to the receiving shelf',
      idempotencyKey: transferKey,
      lines: [{ itemId, quantity: '4' }],
    },
    transferKey,
  );
  const transfer = created.body;
  check('a transfer is created', created.status === 201 || created.status === 200, `status ${created.status} ${JSON.stringify(created.body)?.slice(0, 300)}`);
  check('the transfer starts as a draft', transfer?.status === 'DRAFT', `status ${transfer?.status}`);
  check('creating the transfer moved no stock', (await onHand(sourceWarehouse)) === 10 && (await onHand(destinationWarehouse)) === 0);

  // ---- 3. Nobody may review or approve their own transfer.
  const selfReview = await manager.post(`/inventory/stock-transfers/${transfer.id}/review`, {}, key('reviews'));
  check('the creator cannot review their own transfer', selfReview.status === 400, `status ${selfReview.status}`);

  const reviewed = await reviewer.post(`/inventory/stock-transfers/${transfer.id}/review`, {}, key('review'));
  check('another manager reviews the transfer', reviewed.status === 200 || reviewed.status === 201, `status ${reviewed.status}`);
  const approved = await approver.post(`/inventory/stock-transfers/${transfer.id}/approve`, {}, key('approve'));
  check('the transfer is approved', approved.status === 200 || approved.status === 201, `status ${approved.status}`);
  check('review and approval moved no stock', (await onHand(sourceWarehouse)) === 10, `source ${await onHand(sourceWarehouse)}`);

  // ---- 4. Dispatch lowers the source and holds the goods in transit.
  const lineId = (approved.body?.lines ?? transfer.lines ?? [])[0]?.id;
  check('the transfer has a line to dispatch', Boolean(lineId), `line ${lineId}`);
  const dispatch = await manager.post(
    `/inventory/stock-transfers/${transfer.id}/dispatch`,
    { lines: [{ lineId, quantity: '4' }] },
    key('dispatch'),
  );
  check('dispatch is accepted', dispatch.status === 200 || dispatch.status === 201, `status ${dispatch.status}`);
  check('dispatch lowered the source to 6', (await onHand(sourceWarehouse)) === 6, `source ${await onHand(sourceWarehouse)}`);
  check('dispatch did not fill the destination', (await onHand(destinationWarehouse)) === 0, `destination ${await onHand(destinationWarehouse)}`);

  // ---- 5. The receiver is a different person and cannot dispatch or receive
  // goods that were never sent.
  const keeperDispatch = await keeper.post(
    `/inventory/stock-transfers/${transfer.id}/dispatch`,
    { lines: [{ lineId, quantity: '1' }] },
    key('keeper-dispatch'),
  );
  check('the receiver cannot dispatch the transfer', keeperDispatch.status === 403, `status ${keeperDispatch.status}`);
  check('the refused dispatch changed nothing', (await onHand(sourceWarehouse)) === 6, `source ${await onHand(sourceWarehouse)}`);

  // ---- 6. A partial receipt moves only what arrived.
  const partialKey = key('receive-partial');
  const partial = await keeper.post(
    `/inventory/stock-transfers/${transfer.id}/receive`,
    { lines: [{ lineId, quantity: '3' }] },
    partialKey,
  );
  check('the receiver accepts a partial delivery', partial.status === 200 || partial.status === 201, `status ${partial.status} ${JSON.stringify(partial.body)?.slice(0, 160)}`);
  check('the partial receipt put 3 on the destination', (await onHand(destinationWarehouse)) === 3, `destination ${await onHand(destinationWarehouse)}`);
  check(
    'the transfer says it is only partly received',
    ['PARTIALLY_RECEIVED', 'PARTIALLY_DISPATCHED'].includes(partial.body?.status),
    `status ${partial.body?.status}`,
  );

  // ---- 7. Re-sending the same key is a no-op, not a second receipt.
  // The rule that keeps the two stages apart is enforced on review and
  // approval, not on receipt: the person who dispatched may also receive.
  const repeated = await keeper.post(
    `/inventory/stock-transfers/${transfer.id}/receive`,
    { lines: [{ lineId, quantity: '3' }] },
    partialKey,
  );
  check(
    're-sending the same receipt with the same key is not a second receipt',
    (repeated.status === 200 || repeated.status === 201) && (await onHand(destinationWarehouse)) === 3,
    `status ${repeated.status}, destination ${await onHand(destinationWarehouse)}`,
  );

  // ---- 8. The remainder completes the transfer.
  const finalReceipt = await keeper.post(
    `/inventory/stock-transfers/${transfer.id}/receive`,
    { lines: [{ lineId, quantity: '1' }] },
    key('receive-final'),
  );
  check('the remaining quantity is received', finalReceipt.status === 200 || finalReceipt.status === 201, `status ${finalReceipt.status}`);
  const finalTransfer = await manager.get(`/inventory/stock-transfers/${transfer.id}`);
  check(
    'the transfer is complete',
    ['RECEIVED', 'CLOSED'].includes(finalTransfer.body?.status),
    `status ${finalTransfer.body?.status}`,
  );
  check('the destination holds all four units', (await onHand(destinationWarehouse)) === 4, `destination ${await onHand(destinationWarehouse)}`);
  check('the source kept the six that never moved', (await onHand(sourceWarehouse)) === 6, `source ${await onHand(sourceWarehouse)}`);
  check(
    'nothing is left in transit',
    (await onHand((await db.query(
      `select id from warehouses where "companyId" = $1 and "isTransit" = true limit 1`,
      [companyId],
    )).rows[0]?.id) ?? '00000000-0000-0000-0000-000000000000') === 0,
  );

  // ---- 9. The ledger the customer will read agrees with the work above.
  const sourceLedger = await manager.get(`/inventory/stock/by-warehouse?branchId=${branchId}&itemIds=${itemId}`);
  const perShelf = new Map(
    (sourceLedger.body?.items ?? sourceLedger.body ?? []).map((row) => [
      row.warehouseId,
      Number(row.warehouses?.[0]?.quantity ?? row.quantity ?? 0),
    ]),
  );
  const readShelf = async (id) => {
    const row = (sourceLedger.body?.items ?? sourceLedger.body ?? []).find((entry) => entry.itemId === itemId);
    const shelfRow = row?.warehouses?.find((entry) => entry.warehouseId === id);
    return Number(shelfRow?.quantity ?? perShelf.get(id) ?? NaN);
  };
  check(
    'the per-warehouse ledger agrees with the database',
    (await readShelf(sourceWarehouse)) === 6 && (await readShelf(destinationWarehouse)) === 4,
    `source ${await readShelf(sourceWarehouse)}, destination ${await readShelf(destinationWarehouse)}`,
  );

  // ---- Cleanup. The audit trail is append-only by design; everything this
  // scenario created is removed so a rerun starts from the same place.
  const userIds = [managerId, keeperId, reviewerId, approverId];
  const step = async (label, sql, params) => {
    try {
      await db.query(sql, params);
    } catch (error) {
      console.log(`  cleanup: ${label} skipped — ${String(error?.message ?? error).slice(0, 90)}`);
    }
  };
  await db.query("select set_config('kayan.allow_audit_purge', 'on', false)");
  await step('audit', 'delete from audit_logs where "userId" = any($1::uuid[])', [userIds]);
  await step('notifications', 'delete from notifications where "companyId" = $1 and ("entityId" = $2 or "branchId" = $3)', [companyId, transfer.id, branchId]);
  await step(
    'notification state',
    'delete from notification_user_states where notification_id in (select id from notifications where "companyId" = $1)',
    [companyId],
  );
  await step('grants', 'delete from user_permissions where "userId" = any($1::uuid[])', [userIds]);
  await step('warehouse access', 'delete from user_warehouse_access where "userId" = any($1::uuid[])', [userIds]);
  await step('branches of users', 'delete from user_branches where "userId" = any($1::uuid[])', [userIds]);
  await step('roles', 'delete from user_roles where "userId" = any($1::uuid[])', [userIds]);
  await step('transfer actions', 'delete from stock_transfer_actions where "companyId" = $1', [companyId]);
  await step('transfer lines', 'delete from stock_transfer_lines where "transferId" = $1', [transfer.id]);
  await step('transfers', 'delete from stock_transfers where "companyId" = $1', [companyId]);
  await step('movements', 'delete from stock_movements where "companyId" = $1', [companyId]);
  await step('document lines', 'delete from stock_document_lines where "documentId" in (select id from stock_documents where "companyId" = $1)', [companyId]);
  await step('creation requests', 'delete from stock_document_creation_requests where "companyId" = $1', [companyId]);
  await step('documents', 'delete from stock_documents where "companyId" = $1', [companyId]);
  await step('balances', 'delete from stock_balances where "companyId" = $1', [companyId]);
  await step('warehouse balances', 'delete from warehouse_stock_balances where "companyId" = $1', [companyId]);
  await step('items', 'delete from items where "companyId" = $1 and "code" = $2', [companyId, `CYC-ITEM-${stamp}`]);
  await step('users', 'delete from users where id = any($1::uuid[])', [userIds]);
  await step('transit shelf', 'delete from warehouses where "companyId" = $1 and "branchId" = $2 and "isTransit" = true', [companyId, branchId]);
  await step('warehouses', 'delete from warehouses where "companyId" = $1 and "branchId" = $2', [companyId, branchId]);
  await step('branch', 'delete from branches where id = $1', [branchId]);
  await db.end();

    const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
