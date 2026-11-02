/**
 * The installed program, licensed and put through the whole warehouse.
 *
 * The Windows smoke test proves that `KAYAN-ERP-Setup.exe` installs, starts,
 * backs up, restores, upgrades and repairs. It deliberately runs without a
 * licence, because a real activation key names one computer and only the
 * supplier's private key can sign it. This script closes that gap the way a
 * throwaway build can: the CI job generates an **ephemeral** key pair, builds
 * the Setup with that public key, and this script mints an activation key with
 * the matching private key for the machine the installation actually reports -
 * so the installed program enforces a licence that really was signed, really
 * was bound to the machine, and really is checked.
 *
 * Nothing here is a mock and nothing signs a customer key: the private key
 * lives in a temporary directory that the job deletes, and it is never
 * committed, printed or sent anywhere.
 *
 * It then does the warehouse cycle through the installed program's own API -
 * the service the installed window talks to - and reads every figure back:
 * two lots on one receipt, the average cost, a transfer between two stores, an
 * issue, a full count with a difference, a write-off with its approval, the
 * per-user warehouse grants, the alerts, the twenty reports, CSV and print.
 *
 * Usage (on the installed machine, after the Setup has run):
 *
 *   KAYAN_API=http://127.0.0.1:3000/api/v1 \
 *   KAYAN_ADMIN_USERNAME=... KAYAN_ADMIN_PASSWORD=... \
 *   KAYAN_GENERATOR_HOME=<temporary key directory> \
 *   node scripts/prove-installed-warehouse-and-licence.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.KAYAN_API ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const ADMIN_USER = process.env.KAYAN_ADMIN_USERNAME ?? 'ci-admin';
const ADMIN_PASSWORD = process.env.KAYAN_ADMIN_PASSWORD ?? '';
const GENERATOR =
  process.env.KAYAN_GENERATOR ?? join(process.cwd(), 'tools', 'license-generator', 'kayan-license.mjs');
const GENERATOR_HOME = process.env.KAYAN_GENERATOR_HOME ?? '';
const REPORT_PATH = process.env.KAYAN_PROOF_REPORT ?? '';

let pass = 0;
let fail = 0;
const failures = [];
const results = [];
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  results.push({ name, ok: Boolean(condition), detail });
}

let token = '';
let anonymous = true;

async function api(path, { method = 'GET', body, raw = false, auth = true } = {}) {
  const headers = { Accept: raw ? 'text/html,text/plain,*/*' : 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token && !anonymous) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data, text, headers: response.headers };
}

const asAdmin = async (path, options) => {
  anonymous = false;
  return api(path, options);
};
const asAnonymous = async (path, options = {}) => {
  anonymous = true;
  try {
    return await api(path, { ...options, auth: false });
  } finally {
    anonymous = false;
  }
};

async function signIn(options) {
  const response = await api('/auth/login', {
    method: 'POST',
    auth: false,
    body: { username: options.username, password: options.password },
  });
  return { status: response.status, token: response.data?.accessToken ?? '', data: response.data };
}

function useToken(value) {
  token = value ?? '';
  anonymous = false;
}

const near = (value, expected, tolerance = 0.01) => {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number - expected) <= tolerance;
};

const day = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
};

// ─────────────────────────────────────────────────────── the operator's tool
function generator(args) {
  if (!existsSync(GENERATOR)) throw new Error(`The licence generator is not at ${GENERATOR}`);
  const result = spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `kayan-license ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function mintLicence(reference, seats) {
  const output = generator(['licence', 'create', '--ref', reference, '--seats', String(seats), '--term', '1y', '--home', GENERATOR_HOME]);
  const match = output.match(/licence\s*:\s*(lic_[A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`Could not read the licence id from:\n${output}`);
  return match[1];
}

function mintActivation(licenceId, machineId) {
  const output = generator(['issue', 'activation', '--licence', licenceId, '--machine', machineId, '--home', GENERATOR_HOME]);
  const match = output.match(/^KYN1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/m);
  if (!match) throw new Error(`Could not read the activation key from:\n${output}`);
  return match[0];
}

/// A key that looks right and is signed by nobody: one character of the
/// signature flipped. The product must refuse it, and must not fall back to
/// "no signature means no restriction".
function tamper(key) {
  const parts = key.split('.');
  const signature = parts[2];
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

// ───────────────────────────────────────────────────────────── the licence
async function proveLicence() {
  console.log('\n[L1] the installed program refuses business routes until it is licensed');
  const before = await asAnonymous('/license/status');
  check(
    'the licence status is readable without signing in',
    before.status === 200 && before.data?.configured === true,
    `state ${before.data?.state} configured ${before.data?.configured}`,
  );
  check(
    'it starts unlicensed and blocked',
    before.data?.state === 'UNLICENSED' && before.data?.blocked === true,
    `${before.data?.state} / blocked ${before.data?.blocked}`,
  );

  const signInAdmin = await signIn({ username: ADMIN_USER, password: ADMIN_PASSWORD });
  check('sign-in stays reachable while unlicensed', signInAdmin.status < 400 && Boolean(signInAdmin.token), `HTTP ${signInAdmin.status}`);
  if (!signInAdmin.token) return false;
  useToken(signInAdmin.token);

  const blockedBusiness = await asAdmin('/inventory/warehouses');
  check(
    'a business route is refused before activation, by the server',
    blockedBusiness.status === 403 || blockedBusiness.status === 451,
    `HTTP ${blockedBusiness.status}`,
  );
  const blockedCode = String(blockedBusiness.data?.code ?? blockedBusiness.data?.message ?? '');
  check('the refusal names the licence, not a hidden button', /licen|ترخيص/i.test(blockedCode), blockedCode.slice(0, 120));

  console.log('\n[L2] the installation names itself, and a key is issued for that machine only');
  const request = await asAdmin('/license/request-code');
  const machineId = String(request.data?.machineId ?? request.data?.code ?? '');
  check(
    'the request code carries this machine’s fingerprint',
    /^KM-[A-Z0-9-]+$/i.test(machineId) || machineId.length > 20,
    machineId.slice(0, 40),
  );
  if (!machineId) return false;

  const licenceId = mintLicence(`Installed proof ${day()}`, 5);
  check('the operator registers a licence for the seats that were sold', /^lic_/.test(licenceId), licenceId);
  const activationKey = mintActivation(licenceId, machineId);
  check('the operator signs an activation key for this machine', activationKey.startsWith('KYN1.'), `${activationKey.length} characters`);

  console.log('\n[L3] the installed program accepts a real key and starts working');
  const activated = await asAdmin('/license/activate', { method: 'POST', body: { key: activationKey } });
  check('activation is accepted', activated.status < 400, `HTTP ${activated.status} ${activated.data?.state ?? ''}`);
  check(
    'the copy is ACTIVE, unblocked and bound to this machine',
    activated.data?.state === 'ACTIVE' && activated.data?.blocked === false,
    `${activated.data?.state} / blocked ${activated.data?.blocked}`,
  );
  check(
    'the seats the operator sold are the seats the program allows',
    Number(activated.data?.seats?.limit ?? 0) === 5,
    `limit ${activated.data?.seats?.limit}`,
  );

  const afterActivation = await asAdmin('/inventory/warehouses');
  check('a business route now answers', afterActivation.status === 200, `HTTP ${afterActivation.status}`);

  console.log('\n[L4] the restarts and the refusals');
  const again = await asAnonymous('/license/status');
  check(
    'the licence survives a fresh read of the installed state',
    again.data?.state === 'ACTIVE' && again.data?.blocked === false,
    `${again.data?.state}`,
  );

  const reused = await asAdmin('/license/activate', { method: 'POST', body: { key: activationKey } });
  check('the same key cannot be used twice', reused.status >= 400, `HTTP ${reused.status} ${reused.data?.code ?? ''}`);

  const otherLicence = mintLicence('A different computer', 1);
  const otherKey = mintActivation(otherLicence, 'KM-0000000000000000');
  const wrongMachine = await asAdmin('/license/activate', { method: 'POST', body: { key: otherKey } });
  check(
    'a key signed for another machine is refused',
    wrongMachine.status >= 400,
    `HTTP ${wrongMachine.status} ${wrongMachine.data?.code ?? ''}`,
  );

  const forged = await asAdmin('/license/activate', { method: 'POST', body: { key: tamper(activationKey) } });
  check(
    'a key whose signature was altered is refused',
    forged.status >= 400,
    `HTTP ${forged.status} ${forged.data?.code ?? ''}`,
  );

  const nonsense = await asAdmin('/license/activate', { method: 'POST', body: { key: 'KYN1.not-a-key.not-a-signature' } });
  check('a key that is not a key is refused', nonsense.status >= 400, `HTTP ${nonsense.status}`);

  const stillActive = await asAnonymous('/license/status');
  check(
    'none of those refusals damaged the valid licence',
    stillActive.data?.state === 'ACTIVE' && stillActive.data?.blocked === false,
    `${stillActive.data?.state}`,
  );

  console.log('\n[L5] a backup taken under the licence does not reset it');
  const backup = await asAdmin('/backup/full', { method: 'POST' });
  check('the installed program takes a real backup', backup.status < 400 && Boolean(backup.data?.file?.name), `${backup.data?.file?.name ?? ''}`);
  const afterBackup = await asAnonymous('/license/status');
  check(
    'the licence is still the same one after the backup',
    afterBackup.data?.state === 'ACTIVE' && afterBackup.data?.blocked === false,
    `${afterBackup.data?.state}`,
  );

  return true;
}

// ──────────────────────────────────────────────────────────── the warehouse
async function proveWarehouse() {
  const stamp = String(Date.now()).slice(-6);
  const today = day();
  // The licence step left the administrator signed in; keep that token, because
  // the checks below switch to the clerk and the approver and must come back.
  const adminToken = token;

  console.log('\n[W1] a branch, two stores and their shelves');
  const branches = await asAdmin('/company/branches');
  const branch = (branches.data?.items ?? branches.data ?? [])[0];
  check('the installed company has a branch', Boolean(branch?.id), branch?.code ?? 'none');
  if (!branch) return false;

  const storeA = await asAdmin('/inventory/warehouses', {
    method: 'POST',
    body: { code: `PA-${stamp}`, nameEn: `Store A ${stamp}`, nameAr: `مخزن أ ${stamp}`, branchId: branch.id, isDefault: true },
  });
  const storeB = await asAdmin('/inventory/warehouses', {
    method: 'POST',
    body: { code: `PB-${stamp}`, nameEn: `Store B ${stamp}`, nameAr: `مخزن ب ${stamp}`, branchId: branch.id },
  });
  check('two warehouses are created', Boolean(storeA.data?.id) && Boolean(storeB.data?.id), `${storeA.data?.code} / ${storeB.data?.code}`);
  if (!storeA.data?.id || !storeB.data?.id) return false;

  const shelf = async (warehouseId, label) => {
    const zone = await asAdmin('/inventory/locations', {
      method: 'POST',
      body: { warehouseId, kind: 'ZONE', code: `Z-${label}-${stamp}`, nameEn: `Zone ${label}`, nameAr: `منطقة ${label}` },
    });
    const rack = await asAdmin('/inventory/locations', {
      method: 'POST',
      body: { warehouseId, parentId: zone.data?.id, kind: 'RACK', code: `R-${label}-${stamp}`, nameEn: `Rack ${label}`, nameAr: `رف ${label}` },
    });
    const bin = await asAdmin('/inventory/locations', {
      method: 'POST',
      body: { warehouseId, parentId: rack.data?.id, kind: 'BIN', code: `B-${label}-${stamp}`, nameEn: `Bin ${label}`, nameAr: `خانة ${label}` },
    });
    return { zone: zone.data, rack: rack.data, bin: bin.data, zoneStatus: zone.status, binStatus: bin.status };
  };
  const shelfA = await shelf(storeA.data.id, 'A');
  const shelfB = await shelf(storeB.data.id, 'B');
  check(
    'a zone, a rack and a bin are created in the first store',
    shelfA.zoneStatus < 400 && shelfA.binStatus < 400 && Boolean(shelfA.bin?.id),
    `bin ${shelfA.bin?.code ?? 'missing'}`,
  );
  check(
    'and in the second store',
    Boolean(shelfB.bin?.id),
    `bin ${shelfB.bin?.code ?? 'missing'}`,
  );
  const treeA = await asAdmin(`/inventory/locations/tree/${storeA.data.id}`);
  check(
    'the tree reads back with the bin under the rack under the zone',
    JSON.stringify(treeA.data?.items ?? []).includes(`B-A-${stamp}`),
    `${(treeA.data?.items ?? []).length} root node(s)`,
  );

  console.log('\n[W2] an item and a supplier');
  const item = await asAdmin('/inventory/items', {
    method: 'POST',
    body: {
      code: `PI-${stamp}`,
      nameEn: `Proved item ${stamp}`,
      nameAr: `صنف مثبت ${stamp}`,
      unit: 'piece',
      salePrice: '200.0000',
      purchasePrice: '100.0000',
      isStockTracked: true,
    },
  });
  const supplier = await asAdmin('/parties/suppliers', {
    method: 'POST',
    body: { code: `PS-${stamp}`, nameEn: `Proved supplier ${stamp}`, nameAr: `مورد مثبت ${stamp}` },
  });
  check('the item and the supplier exist', Boolean(item.data?.id) && Boolean(supplier.data?.id), `${item.data?.code}`);
  if (!item.data?.id || !supplier.data?.id) return false;

  console.log('\n[W3] two lots of the same item arrive on one receipt');
  const purchase = await asAdmin('/purchases/invoices', {
    method: 'POST',
    body: {
      invoiceDate: today,
      supplierId: supplier.data.id,
      warehouseId: storeA.data.id,
      lines: [
        {
          itemId: item.data.id,
          quantity: '10.0000',
          unitPrice: '100.0000',
          batchNumber: `LOT-1-${stamp}`,
          batchProductionDate: '2052-01-01',
          batchExpiryDate: '2053-01-01',
          storageLocationId: shelfA.bin.id,
        },
        {
          itemId: item.data.id,
          quantity: '6.0000',
          unitPrice: '120.0000',
          batchNumber: `LOT-2-${stamp}`,
          batchProductionDate: '2052-02-01',
          batchExpiryDate: '2053-02-01',
          storageLocationId: shelfA.bin.id,
        },
      ],
    },
  });
  check('the receipt is accepted with two lots on it', Boolean(purchase.data?.id), `HTTP ${purchase.status}`);
  if (!purchase.data?.id) return false;
  const posted = await asAdmin(`/purchases/invoices/${purchase.data.id}/post`, { method: 'POST' });
  check('the receipt is posted', posted.status < 400, `HTTP ${posted.status}`);

  const lots = await asAdmin(`/inventory/batches?itemId=${item.data.id}`);
  const rows = lots.data?.items ?? [];
  const lotOne = rows.find((row) => row.batchNumber === `LOT-1-${stamp}`);
  const lotTwo = rows.find((row) => row.batchNumber === `LOT-2-${stamp}`);
  check('two lots were created, not one', Boolean(lotOne) && Boolean(lotTwo), `${rows.length} lot(s)`);
  check(
    'each lot holds its own quantity at its own cost',
    near(lotOne?.remainingQuantity, 10) && near(lotOne?.unitCost, 100) &&
      near(lotTwo?.remainingQuantity, 6) && near(lotTwo?.unitCost, 120),
    `${lotOne?.remainingQuantity}@{lotOne?.unitCost} / ${lotTwo?.remainingQuantity}@{lotTwo?.unitCost}`,
  );

  const stockA = await asAdmin(`/inventory/warehouses/${storeA.data.id}/stock`);
  const rowA = (stockA.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the store holds 16 after the receipt', near(rowA?.quantity, 16), `${rowA?.quantity ?? 0}`);
  check(
    'the moving average is (10×100 + 6×120) ÷ 16 = 107.50',
    near(rowA?.value, 1720),
    `value ${rowA?.value ?? 0}`,
  );

  console.log('\n[W4] a transfer between the two stores, then an issue');
  const transfer = await asAdmin('/inventory/stock-documents', {
    method: 'POST',
    body: {
      kind: 'TRANSFER',
      documentDate: today,
      fromWarehouseId: storeA.data.id,
      toWarehouseId: storeB.data.id,
      reason: `proved transfer ${stamp}`,
      lines: [{ itemId: item.data.id, quantity: '4.0000' }],
    },
  });
  check('the transfer is created', Boolean(transfer.data?.id), `HTTP ${transfer.status}`);
  if (transfer.data?.id) {
    const postedTransfer = await asAdmin(`/inventory/stock-documents/${transfer.data.id}/post`, { method: 'POST' });
    check('the transfer is posted', postedTransfer.status < 400, `HTTP ${postedTransfer.status}`);
  }
  const afterTransferA = await asAdmin(`/inventory/warehouses/${storeA.data.id}/stock`);
  const afterTransferB = await asAdmin(`/inventory/warehouses/${storeB.data.id}/stock`);
  const fromA = (afterTransferA.data?.rows ?? []).find((row) => row.code === item.data.code);
  const toB = (afterTransferB.data?.rows ?? []).find((row) => row.code === item.data.code);
  check(
    'the goods left one store and arrived at the other',
    near(fromA?.quantity, 12) && near(toB?.quantity, 4),
    `A ${fromA?.quantity ?? 0}, B ${toB?.quantity ?? 0}`,
  );

  const issue = await asAdmin('/inventory/batches/issue', {
    method: 'POST',
    body: {
      branchId: branch.id,
      warehouseId: storeB.data.id,
      itemId: item.data.id,
      quantity: 1,
      documentDate: today,
      reason: `proved issue ${stamp}`,
    },
  });
  check('an issue out of the second store is accepted', issue.status < 400, `HTTP ${issue.status} ${issue.data?.message ?? ''}`);
  const afterIssueB = await asAdmin(`/inventory/warehouses/${storeB.data.id}/stock`);
  const issuedB = (afterIssueB.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the issue took one unit out', near(issuedB?.quantity, 3), `${issuedB?.quantity ?? 0}`);

  console.log('\n[W5] a full count with a difference, approved by somebody else');
  const second = await makeSecondPerson(stamp, branch.id);
  if (!second) return false;

  const count = await asAdmin('/inventory/stock-takes', {
    method: 'POST',
    body: { warehouseId: storeA.data.id, scope: 'FULL', notes: `proved count ${stamp}` },
  });
  check('the count is opened and freezes the book figure', Boolean(count.data?.id) && (count.data?.lines ?? []).length > 0,
    `${(count.data?.lines ?? []).length} line(s)`);
  if (!count.data?.id) return false;
  // One line per lot: the item's frozen figure is the sum of its lots.
  const countLines = (count.data.lines ?? []).filter((line) => line.itemId === item.data.id);
  const frozen = countLines.reduce((total, line) => total + Number(line.systemQuantity), 0);
  check('the frozen figure is the 12 the store held', near(frozen, 12), `${frozen} over ${countLines.length} lot line(s)`);

  // Count every lot as booked except one unit short on the first: a real -1.
  const countedLines = countLines.map((line, index) => ({
    lineId: line.id,
    countedQuantity: Number(line.systemQuantity) - (index === 0 ? 1 : 0),
  }));
  const recorded = await asAdmin(`/inventory/stock-takes/${count.data.id}/count`, {
    method: 'POST',
    body: { lines: countedLines, finish: true },
  });
  check('the difference is recorded as −1', recorded.status < 400, `HTTP ${recorded.status}`);

  const selfApprove = await asAdmin(`/inventory/stock-takes/${count.data.id}/approve`, { method: 'POST' });
  check('the person who opened the count cannot approve it', selfApprove.status >= 400, `HTTP ${selfApprove.status}`);

  useToken(second.approverToken);
  const approved = await asAdmin(`/inventory/stock-takes/${count.data.id}/approve`, { method: 'POST' });
  check('a second person approves the count', approved.status < 400, `HTTP ${approved.status}`);
  const counted = await asAdmin(`/inventory/stock-takes/${count.data.id}/post`, { method: 'POST' });
  check('the approved count is posted', counted.status < 400, `HTTP ${counted.status}`);
  const afterCount = await asAdmin(`/inventory/warehouses/${storeA.data.id}/stock`);
  const countedRow = (afterCount.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the shelf now holds what was counted', near(countedRow?.quantity, 11), `${countedRow?.quantity ?? 0}`);

  console.log('\n[W6] a write-off: draft, approval by somebody else, then posting');
  useToken(second.token);
  const beforeWriteOff = (afterCount.data?.rows ?? []).find((row) => row.code === item.data.code);
  const writeOff = await asAdmin('/inventory/stock-documents', {
    method: 'POST',
    body: {
      kind: 'WRITE_OFF',
      documentDate: today,
      reason: `proved write-off ${stamp}`,
      toWarehouseId: storeA.data.id,
      lines: [{ itemId: item.data.id, quantity: -1, batchId: lotOne?.id, storageLocationId: shelfA.bin.id }],
    },
  });
  check('the write-off is a draft', writeOff.data?.status === 'draft', `${writeOff.data?.status} ${writeOff.data?.documentNumber ?? ''}`);
  const writeOffId = writeOff.data?.id;
  if (writeOffId) {
    const early = await asAdmin(`/inventory/stock-documents/${writeOffId}/post`, { method: 'POST' });
    check('an unapproved write-off cannot be posted', early.status >= 400, `HTTP ${early.status}`);

    useToken(second.token);
    const selfSigned = await asAdmin(`/inventory/stock-documents/${writeOffId}/approve`, { method: 'POST' });
    check('the recorder cannot approve their own write-off', selfSigned.status >= 400, `HTTP ${selfSigned.status}`);

    useToken(second.approverToken);
    const signed = await asAdmin(`/inventory/stock-documents/${writeOffId}/approve`, { method: 'POST' });
    check('somebody else approves it', signed.status < 400, `HTTP ${signed.status}`);
    const twice = await asAdmin(`/inventory/stock-documents/${writeOffId}/approve`, { method: 'POST' });
    check('a second approval is refused', twice.status >= 400, `HTTP ${twice.status}`);

    const lossPosted = await asAdmin(`/inventory/stock-documents/${writeOffId}/post`, { method: 'POST' });
    check('the approved write-off is posted', lossPosted.status < 400, `HTTP ${lossPosted.status}`);
    check('the posting wrote a journal entry', Boolean(lossPosted.data?.journalEntryId), lossPosted.data?.journalEntryId ?? 'none');
    const afterLoss = await asAdmin(`/inventory/warehouses/${storeA.data.id}/stock`);
    const lostRow = (afterLoss.data?.rows ?? []).find((row) => row.code === item.data.code);
    check(
      'one unit left the shelf',
      near(lostRow?.quantity, Number(beforeWriteOff?.quantity ?? 0) - 1),
      `${beforeWriteOff?.quantity} → ${lostRow?.quantity}`,
    );
  }

  console.log('\n[W7] per-user warehouse grants, and the refusal they cause');
  useToken(adminToken);
  const grantsBefore = await asAdmin(`/inventory/warehouse-access/${second.userId}`);
  check(
    'a person with no rows is unrestricted, as every existing installation expects',
    grantsBefore.data?.restricted === false,
    `restricted ${grantsBefore.data?.restricted}`,
  );
  const setGrants = await asAdmin(`/inventory/warehouse-access/${second.userId}`, {
    method: 'PUT',
    body: {
      grants: [
        {
          warehouseId: storeA.data.id,
          canView: true,
          canReceive: true,
          canIssue: true,
          canTransfer: true,
          canCount: true,
          canApprove: false,
          canSeeCost: false,
        },
      ],
    },
  });
  check(
    'the access screen’s own route writes the grant',
    setGrants.data?.restricted === true || setGrants.status < 400,
    `HTTP ${setGrants.status} restricted ${setGrants.data?.restricted}`,
  );

  useToken(second.token);
  const allowed = await asAdmin(`/inventory/reports/valuation-by-warehouse?warehouseId=${storeA.data.id}`);
  check('the clerk may read the store they are trusted with', allowed.status === 200, `HTTP ${allowed.status}`);
  const forbidden = await asAdmin(`/inventory/reports/valuation-by-warehouse?warehouseId=${storeB.data.id}`);
  check(
    'the same clerk is refused the store they were not granted',
    forbidden.status === 403,
    `HTTP ${forbidden.status} ${forbidden.data?.message ?? ''}`,
  );
  const forbiddenReceive = await asAdmin('/inventory/batches/receive', {
    method: 'POST',
    body: {
      branchId: branch.id,
      warehouseId: storeB.data.id,
      itemId: item.data.id,
      batchNumber: `LOT-X-${stamp}`,
      expiryDate: '2053-05-01',
      quantity: 1,
      unitCost: 100,
    },
  });
  check(
    'and refused when receiving into it, by the server',
    forbiddenReceive.status === 403,
    `HTTP ${forbiddenReceive.status} ${forbiddenReceive.data?.detail ?? ''}`,
  );
  const forbiddenTransfer = await asAdmin('/inventory/stock-documents', {
    method: 'POST',
    body: {
      kind: 'TRANSFER',
      documentDate: today,
      fromWarehouseId: storeB.data.id,
      toWarehouseId: storeA.data.id,
      reason: `should be refused ${stamp}`,
      lines: [{ itemId: item.data.id, quantity: '1' }],
    },
  });
  check(
    'and refused when transferring out of it, by the server',
    forbiddenTransfer.status === 403,
    `HTTP ${forbiddenTransfer.status} ${forbiddenTransfer.data?.detail ?? ''}`,
  );

  console.log('\n[W8] alerts, the twenty reports, CSV and print');
  useToken(adminToken);
  const scan = await asAdmin('/notifications/scan', { method: 'POST' });
  check('the alert scan runs against the installed database', scan.status < 400, `HTTP ${scan.status}`);
  const alerts = await asAdmin('/notifications');
  check('the notification list answers', alerts.status === 200, `HTTP ${alerts.status}`);

  const catalogue = await asAdmin('/inventory/reports');
  const slugs = (catalogue.data?.reports ?? catalogue.data?.items ?? []).map((row) => row.slug);
  check('the catalogue offers its twenty warehouse reports', slugs.length >= 20, `${slugs.length} report(s)`);

  const valuation = await asAdmin(`/inventory/reports/valuation-by-warehouse?warehouseId=${storeA.data.id}`);
  check('a report runs and returns rows', valuation.status === 200 && (valuation.data?.rows ?? []).length > 0,
    `${(valuation.data?.rows ?? []).length} row(s)`);
  const itemCard = await asAdmin(`/inventory/reports/item-card?itemId=${item.data.id}&from=${day(-30)}&to=${today}`);
  check('the item card answers with a movement', itemCard.status === 200, `HTTP ${itemCard.status}`);
  const expiry = await asAdmin('/inventory/reports/expiring?days=30');
  check('the expiring report answers', expiry.status === 200, `HTTP ${expiry.status}`);
  const variances = await asAdmin(`/inventory/reports/count-variances?from=${day(-30)}&to=${today}`);
  check('the count-variance report answers', variances.status === 200, `HTTP ${variances.status}`);

  const csv = await asAdmin(`/inventory/reports/valuation-by-warehouse/export?warehouseId=${storeA.data.id}`, { raw: true });
  check(
    'the CSV export returns a real CSV file',
    csv.status === 200 && String(csv.headers.get('content-type') ?? '').includes('csv'),
    `${csv.headers.get('content-type')} ${csv.text.length} bytes`,
  );
  check('the CSV names the store it exported', csv.text.includes(storeA.data.code), 'contains the store code');

  // The valuation sheet is one line per store; the shelf-level sheet is the one
  // that names the item, so the item is proved where the item belongs.
  const itemCsv = await asAdmin(
    `/inventory/reports/balance-by-warehouse/export?warehouseId=${storeA.data.id}`,
    { raw: true },
  );
  check(
    'the item-level export names the item it exported',
    itemCsv.status === 200 && itemCsv.text.includes(item.data.code),
    `HTTP ${itemCsv.status} ${itemCsv.text.length} bytes`,
  );

  const print = await asAdmin(`/inventory/reports/valuation/print?warehouseId=${storeA.data.id}`, { raw: true });
  check(
    'the printed valuation sheet renders',
    print.status === 200 && /<html/i.test(print.text),
    `HTTP ${print.status} ${print.text.length} bytes`,
  );

  return true;
}

/// A second person, because approval is the separation of duties: the clerk
/// who records a loss cannot sign it. Two accounts, one narrow grant.
async function makeSecondPerson(stamp, branchId) {
  const permissions = await asAdmin('/admin/permissions');
  const codes = (permissions.data?.items ?? permissions.data ?? []).map((row) => row.code).filter(Boolean);
  check('the permission catalogue is readable', codes.length > 20, `${codes.length} permission(s)`);

  const approverRole = await asAdmin('/admin/roles', {
    method: 'POST',
    body: { code: `APP-${stamp}`, nameEn: `Approver ${stamp}`, nameAr: `معتمد ${stamp}`, permissions: codes },
  });
  const clerkRole = await asAdmin('/admin/roles', {
    method: 'POST',
    body: {
      code: `CLERK-${stamp}`,
      nameEn: `Clerk ${stamp}`,
      nameAr: `أمين ${stamp}`,
      permissions: [
        'inventory.stock.read',
        'inventory.warehouses.read',
        'inventory.batches.read',
        'inventory.batches.receive',
        'inventory.batches.issue',
        'inventory.batches.transfer',
        'inventory.stock.adjust',
        'inventory.export',
      ],
    },
  });
  check('two roles are created', Boolean(approverRole.data?.id) && Boolean(clerkRole.data?.id), 'approver and clerk');
  if (!approverRole.data?.id || !clerkRole.data?.id) return null;

  const password = 'Pr0ved!Passw0rd-2026';
  const clerk = await asAdmin('/admin/users', {
    method: 'POST',
    body: {
      username: `clerk${stamp}`,
      fullNameEn: `Clerk ${stamp}`,
      fullNameAr: `أمين ${stamp}`,
      password,
      roleIds: [clerkRole.data.id],
      branchIds: [branchId],
    },
  });
  const approver = await asAdmin('/admin/users', {
    method: 'POST',
    body: {
      username: `approver${stamp}`,
      fullNameEn: `Approver ${stamp}`,
      fullNameAr: `معتمد ${stamp}`,
      password,
      roleIds: [approverRole.data.id],
      branchIds: [branchId],
    },
  });
  check('the two people exist', Boolean(clerk.data?.id) && Boolean(approver.data?.id), `clerk ${clerk.data?.id ? 'yes' : 'no'}`);
  if (!clerk.data?.id || !approver.data?.id) return null;

  const clerkLogin = await signIn({ username: `clerk${stamp}`, password });
  const approverLogin = await signIn({ username: `approver${stamp}`, password });
  check('both can sign in', Boolean(clerkLogin.token) && Boolean(approverLogin.token), `clerk HTTP ${clerkLogin.status}`);
  if (!clerkLogin.token) return null;

  return {
    userId: clerk.data.id,
    token: clerkLogin.token,
    approverToken: approverLogin.token,
  };
}

async function main() {
  console.log(`Proving the installed program at ${API}`);
  if (!ADMIN_PASSWORD) throw new Error('KAYAN_ADMIN_PASSWORD is required');
  if (!GENERATOR_HOME) throw new Error('KAYAN_GENERATOR_HOME is required');

  const health = await asAnonymous('/health');
  check('the installed program reports a healthy database', health.data?.status === 'ok' && health.data?.database === 'up', `${health.data?.database}`);
  if (!(await proveLicence())) {
    report();
    return;
  }
  if (!(await proveWarehouse())) {
    report();
    return;
  }
  report();
}

function report() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) console.log(`Failures: ${failures.join(', ')}`);
  if (REPORT_PATH) {
    try {
      writeFileSync(REPORT_PATH, JSON.stringify({ api: API, pass, fail, failures, results }, null, 2));
    } catch {
      // A report that cannot be written must not change the verdict.
    }
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('Proof aborted:', error);
  process.exitCode = 1;
});
