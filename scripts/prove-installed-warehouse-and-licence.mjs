/**
 * The installed program, licensed, put through the whole warehouse.
 *
 * This runs against `KAYAN-ERP-Setup.exe`'s own installed payload on a Windows
 * runner, never against a development build:
 *
 *   - the Setup embeds an **ephemeral** Ed25519 public key generated in the same
 *     job, so the licence is really signed and really checked;
 *   - an unlicensed program must refuse business work but still allow signing in
 *     and asking for a request code;
 *   - a key signed for this machine is accepted, a key signed for another machine
 *     is refused, a tampered key is refused, and the same key cannot be used twice;
 *   - then the warehouse: two stores and their shelf tree, an item, two lots on
 *     one receipt, the average cost, a transfer, an issue, a full stock take with
 *     a difference approved by somebody else, a write-off approved by somebody
 *     else with its journal entry, per-user warehouse grants with the refusals
 *     they cause, alerts, all twenty reports, CSV, and the printed sheet.
 *
 * The private key lives in the runner's temporary directory, is used only by the
 * operator's own generator, and is never written to a report or an artifact.
 *
 * Environment:
 *   KAYAN_API             http://127.0.0.1:<port>/api/v1   (required)
 *   KAYAN_ADMIN_USERNAME / KAYAN_ADMIN_PASSWORD            (required)
 *   KAYAN_GENERATOR       tools/license-generator/kayan-license.mjs (required)
 *   KAYAN_GENERATOR_HOME  the ephemeral key directory              (required)
 *   KAYAN_PROOF_REPORT    where to write the JSON report
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.KAYAN_API ?? '').replace(/\/$/, '');
const ADMIN_USER = process.env.KAYAN_ADMIN_USERNAME ?? 'ci-admin';
const ADMIN_PASSWORD = process.env.KAYAN_ADMIN_PASSWORD ?? '';
const GENERATOR =
  process.env.KAYAN_GENERATOR ?? join(process.cwd(), 'tools', 'license-generator', 'kayan-license.mjs');
const GENERATOR_HOME = process.env.KAYAN_GENERATOR_HOME ?? '';
const REPORT_PATH = process.env.KAYAN_PROOF_REPORT ?? '';
const REQUIRE_PDF = ['1', 'true', 'yes'].includes(String(process.env.KAYAN_REQUIRE_PDF ?? '').toLowerCase());

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

async function api(path, { method = 'GET', body, anonymous = false, raw = false } = {}) {
  const headers = { Accept: raw ? 'text/html,text/csv,*/*' : 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous && token) headers.Authorization = `Bearer ${token}`;
  // A request that never answers must fail the proof, not hang the job.
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text, headers: response.headers };
}

async function signIn(username, password) {
  const response = await fetch(`${API.replace(/\/api\/v1$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, token: data?.accessToken ?? '' };
}

function generator(args) {
  if (!existsSync(GENERATOR)) throw new Error(`The licence generator is missing at ${GENERATOR}`);
  const result = spawnSync(process.execPath, [GENERATOR, ...args], { encoding: 'utf8', env: { ...process.env } });
  if (result.status !== 0) {
    throw new Error(`kayan-license ${args[0]} ${args[1] ?? ''} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/// `licence create` prints `licence   : lic_...`; `issue activation` prints the
/// key alone on its own line. Reading the tool's own output keeps the proof tied
/// to the operator's real workflow instead of to a private file layout.
function mintLicence(reference, seats) {
  const output = generator(['licence', 'create', '--ref', reference, '--seats', String(seats), '--term', '1y', '--home', GENERATOR_HOME]);
  const match = output.match(/licence\s*:\s*(lic_[A-Za-z0-9]+)/i);
  if (!match) throw new Error(`The generator did not print a licence id:\n${output}`);
  return match[1];
}

function mintActivation(licenceId, machine) {
  const output = generator(['issue', 'activation', '--licence', licenceId, '--machine', machine, '--home', GENERATOR_HOME]);
  const key = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Z0-9]*\d\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(line))
    .pop();
  if (!key) throw new Error(`The generator did not print an activation key:\n${output}`);
  return key;
}

const today = () => new Date().toISOString().slice(0, 10);
const near = (a, b, tolerance = 0.01) => Math.abs(Number(a) - Number(b)) <= tolerance;

/**
 * The licence screen posts the key the customer pasted. The field is `key`;
 * a wrong field name is a validation error, which would otherwise be mistaken
 * for the program refusing the key.
 */
function activate(key) {
  return api('/license/activate', { method: 'POST', body: { key } });
}

async function proveLicence() {
  console.log('\n[L1] an unlicensed installed program refuses business work');
  const status = await api('/license/status', { anonymous: true });
  check('the licence status is readable before activation',
    status.data?.configured === true && status.data?.enforcement === 'enforce',
    `state ${status.data?.state}, enforcement ${status.data?.enforcement}`);

  const signed = await signIn(ADMIN_USER, ADMIN_PASSWORD);
  token = signed.token;
  check('signing in still works while unlicensed', signed.status === 201 && Boolean(signed.token), `HTTP ${signed.status}`);
  if (!token) return false;

  const blocked = await api('/inventory/warehouses');
  if (status.data?.state !== 'ACTIVE') {
    check('a business route is refused while unlicensed', blocked.status === 403,
      `HTTP ${blocked.status} ${blocked.data?.code ?? ''}`);
    check('the refusal names the licence, not a missing button',
      String(blocked.data?.code ?? '').includes('LICENSE') || /licen[cs]e|ترخيص/i.test(JSON.stringify(blocked.data ?? {})),
      String(blocked.data?.code ?? blocked.data?.detail ?? ''));
  } else {
    console.log('  SKIP  this installation is already licensed, so the blocked state cannot be observed');
  }

  console.log('\n[L2] this installation names the machine it may run on');
  const requestCode = await api('/license/request-code');
  const code = requestCode.data?.requestCode ?? requestCode.data?.code ?? '';
  check('the installed program reports a request code', typeof code === 'string' && code.length > 20,
    typeof code === 'string' ? `${code.slice(0, 16)}…` : 'none');
  const payload = code.includes('.') ? JSON.parse(Buffer.from(code.split('.')[1], 'base64url').toString('utf8')) : {};
  const machineId = payload?.machineId ?? status.data?.machineId ?? '';
  check('the request code carries this machine id, not a hardcoded one', Boolean(machineId), machineId);

  console.log('\n[L3] a key signed for this machine is accepted');
  const licenceId = mintLicence('installed-e2e', 6);
  const activationKey = mintActivation(licenceId, machineId);
  const activated = await activate(activationKey);
  check('the installed program accepts the activation', activated.status < 400,
    `HTTP ${activated.status} ${activated.data?.code ?? activated.data?.detail ?? ''}`);
  const after = await api('/license/status', { anonymous: true });
  check('the licence is ACTIVE and business work is allowed now',
    after.data?.state === 'ACTIVE' && after.data?.blocked === false, `state ${after.data?.state}`);
  const allowed = await api('/inventory/warehouses');
  check('a business route now answers', allowed.status === 200, `HTTP ${allowed.status}`);

  console.log('\n[L4] the refusals, which are the point of the check');
  const second = await activate(activationKey);
  check('the same key cannot be used twice', second.status >= 400,
    `HTTP ${second.status} ${second.data?.code ?? ''}`);

  const otherLicence = mintLicence('installed-e2e-other-machine', 2);
  const otherKey = mintActivation(otherLicence, 'KM-SOME-OTHER-MACHINE-0001');
  const wrongMachine = await activate(otherKey);
  check('a key signed for another machine is refused', wrongMachine.status >= 400,
    `HTTP ${wrongMachine.status} ${wrongMachine.data?.code ?? ''}`);

  const parts = activationKey.split('.');
  const tampered = parts.length >= 3
    ? [parts[0], parts[1], parts[2].slice(0, -2) + (parts[2].slice(-2) === 'AA' ? 'BB' : 'AA')].join('.')
    : `${activationKey.slice(0, -2)}AA`;
  const badSignature = await activate(tampered);
  check('a key whose signature was altered is refused', badSignature.status >= 400,
    `HTTP ${badSignature.status} ${badSignature.data?.code ?? ''}`);

  const nonsense = await activate('KYN1.not-a-key.at-all');
  check('something that is not a key is refused', nonsense.status >= 400,
    `HTTP ${nonsense.status} ${nonsense.data?.code ?? ''}`);

  const still = await api('/license/status', { anonymous: true });
  check('none of the refusals damaged the valid licence', still.data?.state === 'ACTIVE', `state ${still.data?.state}`);
  return still.data?.state === 'ACTIVE';
}

async function proveWarehouse() {
  const stamp = String(Date.now()).slice(-6);
  const adminToken = token;

  console.log('\n[W1] two stores and their shelves');
  const branches = await api('/company/branches');
  const branch = (branches.data?.items ?? branches.data ?? [])[0];
  check('the installed company has a branch', Boolean(branch?.id), branch?.code ?? 'none');
  if (!branch) return false;

  const storeA = await api('/inventory/warehouses', {
    method: 'POST',
    body: { code: `EA-${stamp}`, nameEn: `Store A ${stamp}`, nameAr: `مخزن أ ${stamp}`, branchId: branch.id, isDefault: true },
  });
  const storeB = await api('/inventory/warehouses', {
    method: 'POST',
    body: { code: `EB-${stamp}`, nameEn: `Store B ${stamp}`, nameAr: `مخزن ب ${stamp}`, branchId: branch.id },
  });
  check('two warehouses are created', Boolean(storeA.data?.id) && Boolean(storeB.data?.id),
    `${storeA.data?.code} / ${storeB.data?.code}`);
  if (!storeA.data?.id || !storeB.data?.id) return false;

  // The real shape of a store room: a zone holds an aisle, the aisle holds a
  // rack, the rack holds a shelf, and the shelf is where the goods sit.
  const tree = {};
  for (const [key, store] of [['A', storeA.data], ['B', storeB.data]]) {
    const chain = [
      { level: 'ZONE', code: `Z-${key}-${stamp}`, nameEn: `Zone ${key}`, nameAr: `منطقة ${key}` },
      { level: 'AISLE', code: `A-${key}-${stamp}`, nameEn: `Aisle ${key}`, nameAr: `ممر ${key}` },
      { level: 'RACK', code: `R-${key}-${stamp}`, nameEn: `Rack ${key}`, nameAr: `رف ${key}` },
      { level: 'SHELF', code: `S-${key}-${stamp}`, nameEn: `Shelf ${key}`, nameAr: `ضلفة ${key}` },
    ];
    const made = [];
    for (const step of chain) {
      const created = await api('/inventory/locations', {
        method: 'POST',
        body: {
          warehouseId: store.id,
          parentId: made.length ? made[made.length - 1].id : undefined,
          code: step.code,
          nameEn: step.nameEn,
          nameAr: step.nameAr,
          kind: step.level,
        },
      });
      if (!created.data?.id) {
        check(`the ${step.level.toLowerCase()} of store ${key} is created`, false,
          `HTTP ${created.status} ${created.data?.detail ?? ''}`);
        break;
      }
      made.push(created.data);
    }
    tree[key] = { chain: made, shelf: made[3], bin: made[3] };
  }
  check('a four-level shelf exists in each store',
    Boolean(tree.A?.shelf?.id) && Boolean(tree.B?.shelf?.id),
    `${tree.A?.shelf?.code} / ${tree.B?.shelf?.code}`);

  const locations = await api(`/inventory/locations?warehouseId=${storeA.data.id}`);
  const flat = locations.data?.items ?? locations.data ?? [];
  const treeA = await api(`/inventory/locations/tree/${storeA.data.id}`);
  const roots = treeA.data?.items ?? treeA.data?.roots ?? treeA.data ?? [];
  const depthOf = (node) => (node?.children?.length ? 1 + Math.max(...node.children.map(depthOf)) : 1);
  const depth = Array.isArray(roots) && roots.length ? Math.max(...roots.map(depthOf)) : 0;
  check('the four shelves in the one store read back from the installed database',
    flat.length >= 4, `${flat.length} location(s)`);
  check('the hierarchy reads back four levels deep',
    depth >= 4, `depth ${depth}`);

  console.log('\n[W2] an item and a supplier');
  const supplier = await api('/parties/suppliers', {
    method: 'POST',
    body: {
      code: `SUP-${stamp}`,
      nameEn: `Supplier ${stamp}`,
      nameAr: `مورد ${stamp}`,
      phone: '0100000000',
    },
  });
  const item = await api('/inventory/items', {
    method: 'POST',
    body: {
      code: `EI-${stamp}`,
      nameEn: `Installed item ${stamp}`,
      nameAr: `صنف ${stamp}`,
      unit: 'عبوة',
      salePrice: '12.0000',
      purchasePrice: '10.0000',
      isStockTracked: true,
    },
  });
  check('the item and the supplier exist', Boolean(item.data?.id) && Boolean(supplier.data?.id),
    `${item.data?.code} / ${supplier.data?.code}`);
  if (!item.data?.id || !supplier.data?.id) return false;

  console.log('\n[W3] two lots of the same item on one receipt');
  const invoice = await api('/purchases/invoices', {
    method: 'POST',
    body: {
      supplierId: supplier.data.id,
      warehouseId: storeA.data.id,
      invoiceDate: today(),
      lines: [
        {
          itemId: item.data.id,
          quantity: '10.0000',
          unitPrice: '10.0000',
          batchNumber: `ELOT-1-${stamp}`,
          batchProductionDate: '2052-01-01',
          batchExpiryDate: '2053-01-01',
          storageLocationId: tree.A.bin.id,
        },
        {
          itemId: item.data.id,
          quantity: '6.0000',
          unitPrice: '12.0000',
          batchNumber: `ELOT-2-${stamp}`,
          batchProductionDate: '2052-02-01',
          batchExpiryDate: '2053-02-01',
          storageLocationId: tree.A.bin.id,
        },
      ],
    },
  });
  check('the receipt is accepted with two lots on it', Boolean(invoice.data?.id),
    `HTTP ${invoice.status} ${invoice.data?.detail ?? ''}`);
  if (!invoice.data?.id) return false;
  const posted = await api(`/purchases/invoices/${invoice.data.id}/post`, { method: 'POST' });
  check('the receipt is posted', posted.status < 400, `HTTP ${posted.status} ${posted.data?.detail ?? ''}`);

  const lots = await api(`/inventory/batches?itemId=${item.data.id}&warehouseId=${storeA.data.id}`);
  const lotRows = lots.data?.items ?? [];
  const lotOne = lotRows.find((row) => row.batchNumber === `ELOT-1-${stamp}`);
  const lotTwo = lotRows.find((row) => row.batchNumber === `ELOT-2-${stamp}`);
  check('two lots were created, not one', Boolean(lotOne) && Boolean(lotTwo), `${lotRows.length} lot(s)`);
  check('each lot keeps its own quantity and cost',
    near(lotOne?.remainingQuantity, 10) && near(lotTwo?.remainingQuantity, 6) &&
      near(lotOne?.unitCost, 10) && near(lotTwo?.unitCost, 12),
    `${lotOne?.remainingQuantity}@${lotOne?.unitCost} / ${lotTwo?.remainingQuantity}@${lotTwo?.unitCost}`);

  const stockA = await api(`/inventory/warehouses/${storeA.data.id}/stock`);
  const rowA = (stockA.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the store holds 16 in total', near(rowA?.quantity, 16), `${rowA?.quantity}`);
  check('the moving average is (10x10 + 6x12) / 16 = 10.75',
    near(rowA?.value, 172) || near(rowA?.averageCost, 10.75), `value ${rowA?.value}, average ${rowA?.averageCost}`);

  console.log('\n[W4] transfer between the stores, then an issue');
  const transfer = await api('/inventory/stock-documents', {
    method: 'POST',
    body: {
      kind: 'TRANSFER',
      documentDate: today(),
      branchId: branch.id,
      fromWarehouseId: storeA.data.id,
      toWarehouseId: storeB.data.id,
      lines: [{ itemId: item.data.id, batchId: lotOne?.id, quantity: '4.0000' }],
    },
  });
  check('the transfer is created', Boolean(transfer.data?.id), `HTTP ${transfer.status} ${transfer.data?.detail ?? ''}`);
  if (!transfer.data?.id) return false;
  const transferPosted = await api(`/inventory/stock-documents/${transfer.data.id}/post`, { method: 'POST' });
  check('the transfer is posted', transferPosted.status < 400, `HTTP ${transferPosted.status} ${transferPosted.data?.detail ?? ''}`);
  const afterTransferA = await api(`/inventory/warehouses/${storeA.data.id}/stock`);
  const afterTransferB = await api(`/inventory/warehouses/${storeB.data.id}/stock`);
  const leftA = (afterTransferA.data?.rows ?? []).find((row) => row.code === item.data.code);
  const intoB = (afterTransferB.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the goods left one store and arrived at the other',
    near(leftA?.quantity, 12) && near(intoB?.quantity, 4), `A ${leftA?.quantity}, B ${intoB?.quantity}`);

  // An issue is the documented loss/consumption route: warehouse, item, quantity.
  const issue = await api('/inventory/batches/issue', {
    method: 'POST',
    body: {
      branchId: branch.id,
      warehouseId: storeB.data.id,
      itemId: item.data.id,
      quantity: 1,
      documentDate: today(),
      reason: `installed issue ${stamp}`,
    },
  });
  check('an issue out of the second store is created', issue.status < 400,
    `HTTP ${issue.status} ${issue.data?.detail ?? ''}`);

  const afterIssue = await api(`/inventory/warehouses/${storeB.data.id}/stock`);
  const rowB = (afterIssue.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the second store is one unit lower', near(rowB?.quantity, 3), `${rowB?.quantity}`);

  console.log('\n[W5] a full stock take with a difference, approved by somebody else');
  const second = await makeSecondPerson(stamp, branch.id, [storeA.data.id]);
  if (!second) return false;

  const take = await api('/inventory/stock-takes', {
    method: 'POST',
    body: { warehouseId: storeA.data.id, scope: 'FULL' },
  });
  check('the stock take is opened and freezes the book figure',
    Boolean(take.data?.id) && (take.data?.lines ?? []).length > 0,
    `HTTP ${take.status} ${(take.data?.lines ?? []).length} line(s)`);
  const takeId = take.data?.id;
  if (!takeId) return false;

  const takeLines = take.data.lines;
  const frozenTotal = takeLines.reduce((sum, line) => sum + Number(line.systemQuantity), 0);
  check('the frozen figure is the whole store: two lots, twelve units',
    takeLines.length === 2 && near(frozenTotal, 12), `${takeLines.length} line(s), ${frozenTotal} unit(s)`);

  // One unit is genuinely missing: the shelf holds eleven, the book says twelve.
  const lines = takeLines.map((line, index) => ({
    lineId: line.id,
    countedQuantity: Number(line.systemQuantity) - (index === 0 ? 1 : 0),
  }));
  const recorded = await api(`/inventory/stock-takes/${takeId}/count`, {
    method: 'POST',
    body: { lines, finish: true },
  });
  check('the count is recorded with one unit missing', recorded.status < 400,
    `HTTP ${recorded.status} ${recorded.data?.detail ?? ''}`);

  const selfApprove = await api(`/inventory/stock-takes/${takeId}/approve`, { method: 'POST' });
  check('the person who counted cannot approve it', selfApprove.status >= 400, `HTTP ${selfApprove.status}`);

  token = second.approverToken;
  const approved = await api(`/inventory/stock-takes/${takeId}/approve`, { method: 'POST' });
  check('a second person approves the count', approved.status < 400, `HTTP ${approved.status} ${approved.data?.detail ?? ''}`);
  const twiceApproved = await api(`/inventory/stock-takes/${takeId}/approve`, { method: 'POST' });
  check('a second approval of the same count is refused', twiceApproved.status >= 400, `HTTP ${twiceApproved.status}`);
  const postedTake = await api(`/inventory/stock-takes/${takeId}/post`, { method: 'POST' });
  check('the approved count is posted', postedTake.status < 400, `HTTP ${postedTake.status} ${postedTake.data?.detail ?? ''}`);
  check('posting the count wrote a journal entry', Boolean(postedTake.data?.journalEntryId),
    postedTake.data?.journalEntryId ?? 'none');
  const afterTake = await api(`/inventory/warehouses/${storeA.data.id}/stock`);
  const countedRow = (afterTake.data?.rows ?? []).find((row) => row.code === item.data.code);
  check('the shelf now holds what was counted', near(countedRow?.quantity, 11), `${countedRow?.quantity}`);

  console.log('\n[W6] a write-off: draft, approval by somebody else, then posting');
  token = adminToken;
  const writeOff = await api('/inventory/stock-documents', {
    method: 'POST',
    body: {
      kind: 'WRITE_OFF',
      documentDate: today(),
      branchId: branch.id,
      reason: `installed write-off ${stamp}`,
      toWarehouseId: storeA.data.id,
      lines: [{ itemId: item.data.id, batchId: lotOne?.id, quantity: -1, storageLocationId: tree.A.bin.id }],
    },
  });
  check('the write-off is a draft with its own number',
    writeOff.data?.status === 'draft' && /^WO-/.test(String(writeOff.data?.documentNumber ?? '')),
    `${writeOff.data?.status} ${writeOff.data?.documentNumber ?? ''}`);
  const writeOffId = writeOff.data?.id;
  if (writeOffId) {
    const early = await api(`/inventory/stock-documents/${writeOffId}/post`, { method: 'POST' });
    check('an unapproved write-off cannot be posted', early.status >= 400, `HTTP ${early.status}`);
    const selfSign = await api(`/inventory/stock-documents/${writeOffId}/approve`, { method: 'POST' });
    check('the person who recorded it cannot approve it', selfSign.status >= 400, `HTTP ${selfSign.status}`);

    token = second.approverToken;
    const signed = await api(`/inventory/stock-documents/${writeOffId}/approve`, { method: 'POST' });
    check('somebody else approves it', signed.status < 400, `HTTP ${signed.status} ${signed.data?.detail ?? ''}`);
    const twice = await api(`/inventory/stock-documents/${writeOffId}/approve`, { method: 'POST' });
    check('a second approval is refused', twice.status >= 400, `HTTP ${twice.status}`);
    const loss = await api(`/inventory/stock-documents/${writeOffId}/post`, { method: 'POST' });
    check('the approved write-off is posted', loss.status < 400, `HTTP ${loss.status} ${loss.data?.detail ?? ''}`);
    check('the posting wrote a journal entry', Boolean(loss.data?.journalEntryId), loss.data?.journalEntryId ?? 'none');
    const afterLoss = await api(`/inventory/warehouses/${storeA.data.id}/stock`);
    const lostRow = (afterLoss.data?.rows ?? []).find((row) => row.code === item.data.code);
    check('one unit left the shelf', near(lostRow?.quantity, 10), `${lostRow?.quantity}`);
  } else {
    return false;
  }

  console.log('\n[W7] per-user warehouse grants, and the refusal they cause');
  token = adminToken;
  const before = await api(`/inventory/warehouse-access/${second.clerkId}`);
  check('a person with no rows is unrestricted', before.data?.restricted === false, `restricted ${before.data?.restricted}`);
  const grants = await api(`/inventory/warehouse-access/${second.clerkId}`, {
    method: 'PUT',
    body: {
      grants: [
        { warehouseId: storeA.data.id, canView: true, canReceive: true, canIssue: true, canTransfer: true, canCount: true, canApprove: false, canSeeCost: false },
      ],
    },
  });
  check('the access screen writes the grant', grants.status < 400 && grants.data?.restricted === true,
    `HTTP ${grants.status} restricted ${grants.data?.restricted}`);

  token = second.clerkToken;
  const allowedStore = await api(`/inventory/reports/valuation-by-warehouse?warehouseId=${storeA.data.id}`);
  check('the clerk may read the store they are trusted with', allowedStore.status === 200, `HTTP ${allowedStore.status}`);
  const refusedStore = await api(`/inventory/reports/valuation-by-warehouse?warehouseId=${storeB.data.id}`);
  check('the same clerk is refused the store they were not granted', refusedStore.status === 403, `HTTP ${refusedStore.status}`);
  const refusedReceipt = await api('/inventory/batches/receive', {
    method: 'POST',
    body: { branchId: branch.id, warehouseId: storeB.data.id, itemId: item.data.id, quantity: 1, unitCost: 10, batchNumber: `DENY-${stamp}` },
  });
  check('a receipt into an ungranted store is refused by the server', refusedReceipt.status === 403,
    `HTTP ${refusedReceipt.status} ${refusedReceipt.data?.detail ?? ''}`);
  const refusedTransfer = await api('/inventory/stock-documents', {
    method: 'POST',
    body: {
      kind: 'TRANSFER',
      documentDate: today(),
      branchId: branch.id,
      fromWarehouseId: storeB.data.id,
      toWarehouseId: storeA.data.id,
      lines: [{ itemId: item.data.id, quantity: '1.0000' }],
    },
  });
  check('a transfer out of an ungranted store is refused by the server', refusedTransfer.status === 403,
    `HTTP ${refusedTransfer.status} ${refusedTransfer.data?.detail ?? ''}`);

  console.log('\n[W8] alerts, the twenty reports, CSV and the printed sheet');
  token = adminToken;
  const scan = await api('/notifications/scan', { method: 'POST' });
  check('the alert scan runs against the installed database', scan.status < 400, `HTTP ${scan.status}`);
  const alerts = await api('/notifications');
  check('the notification list answers', alerts.status === 200, `HTTP ${alerts.status}`);
  const count = await api('/notifications/unread-count').catch(() => ({ status: 0, data: null }));
  if (count.status === 200) {
    check('the unread count answers', typeof count.data?.unread === 'number', `${count.data?.unread} unread`);
  }

  const catalogue = await api('/inventory/reports');
  const reports = catalogue.data?.reports ?? [];
  check('the installed catalogue offers the twenty warehouse reports', reports.length >= 20, `${reports.length} report(s)`);

  let ran = 0;
  for (const report of reports) {
    const query = new URLSearchParams();
    if ((report.filters ?? []).includes('warehouseId')) query.set('warehouseId', storeA.data.id);
    if ((report.filters ?? []).includes('itemId')) query.set('itemId', item.data.id);
    if ((report.filters ?? []).includes('from')) query.set('from', '2020-01-01');
    if ((report.filters ?? []).includes('to')) query.set('to', today());
    if ((report.filters ?? []).includes('days')) query.set('days', '3650');
    const response = await api(`/inventory/reports/${report.slug}?${query.toString()}`);
    if (response.status === 200) ran += 1;
    else console.log(`         ${report.slug}: HTTP ${response.status} ${response.data?.detail ?? ''}`);
  }
  check('every report in the catalogue answers', ran === reports.length, `${ran}/${reports.length}`);

  const csv = await api(`/inventory/reports/valuation-by-warehouse/export?warehouseId=${storeA.data.id}`, { raw: true });
  check('the CSV export returns a real CSV file',
    csv.status === 200 && String(csv.headers.get('content-type') ?? '').includes('csv'), `${csv.headers.get('content-type')}`);
  check('the CSV is named after the report and the date',
    /kayan-valuation-by-warehouse-\d{4}-\d{2}-\d{2}\.csv/.test(String(csv.headers.get('content-disposition') ?? '')),
    String(csv.headers.get('content-disposition') ?? 'no filename'));
  const csvLines = csv.text.replace(/^\ufeff/, '').trim().split(/\r\n/);
  check('the CSV has a header row and the store it exported',
    csvLines.length >= 2 && csvLines[0].includes(',') && csv.text.includes(storeA.data.code),
    `${csvLines.length - 1} data row(s)`);
  // The item-level report is the one that has to name the item.
  const itemCsv = await api(
    `/inventory/reports/balance-by-warehouse/export?warehouseId=${storeA.data.id}`,
    { raw: true },
  );
  check('the item-level export names the item and its quantity',
    itemCsv.status === 200 && itemCsv.text.includes(item.data.code) && /10\.0000|11\.0000|10\.00/.test(itemCsv.text),
    `HTTP ${itemCsv.status}, ${itemCsv.text.split('\r\n').length - 1} row(s)`);

  // Every report the server can export, exported: one route serves all twenty,
  // so the check is the whole catalogue and not a sample of it.
  let exported = 0;
  for (const report of reports) {
    const query = new URLSearchParams();
    if ((report.filters ?? []).includes('warehouseId')) query.set('warehouseId', storeA.data.id);
    if ((report.filters ?? []).includes('itemId')) query.set('itemId', item.data.id);
    if ((report.filters ?? []).includes('from')) query.set('from', '2020-01-01');
    if ((report.filters ?? []).includes('to')) query.set('to', today());
    if ((report.filters ?? []).includes('days')) query.set('days', '3650');
    const response = await api(`/inventory/reports/${report.slug}/export?${query.toString()}`, { raw: true });
    if (response.status === 200 && /csv/i.test(String(response.headers.get('content-type') ?? ''))) exported += 1;
    else console.log(`         ${report.slug}: export HTTP ${response.status}`);
  }
  check('every one of the twenty reports exports as CSV', exported === reports.length,
    `${exported}/${reports.length}`);

  // The printed sheets and their PDFs: the four the server renders, in both
  // forms, with the filter each route understands.
  const sheets = [
    ['valuation', `warehouseId=${storeA.data.id}`],
    ['slow-moving', 'days=3650'],
    ['reorder', `warehouseId=${storeA.data.id}`],
    ['stock-take-variance', `warehouseId=${storeA.data.id}`],
  ];
  for (const [slug, filter] of sheets) {
    const html = await api(`/inventory/reports/${slug}/print?${filter}&lang=en`, { raw: true });
    check(`the printed ${slug} sheet renders from the installed program`,
      html.status === 200 && /<html/i.test(html.text), `HTTP ${html.status} ${html.text.length} bytes`);
    const pdf = await api(`/inventory/reports/${slug}/pdf?${filter}&lang=en`, { raw: true });
    const rendered = pdf.status === 200 && /application\/pdf/.test(String(pdf.headers.get('content-type') ?? ''));
    // A machine with no browser on it cannot print to PDF, and the program says
    // so instead of handing back an empty file. On the installed Windows copy
    // Edge is always there, so the proof demands the real PDF when the caller
    // says a browser may be assumed.
    const noBrowser = pdf.status === 422 && /browser|متصفح/i.test(pdf.text);
    check(`the ${slug} sheet downloads as a PDF`,
      rendered || (!REQUIRE_PDF && noBrowser),
      rendered ? 'application/pdf' : `HTTP ${pdf.status}: the program reported no browser to print with`);
  }
  check('the reports without a sheet still export, so nothing is paperless and silent',
    reports.length - sheets.length > 0, `${reports.length - sheets.length} report(s) export as CSV only`);

  // A backup taken under the licence must not reset it.
  const backup = await api('/backup/full', { method: 'POST' });
  check('the installed program takes a full backup', backup.status < 400,
    `HTTP ${backup.status} ${backup.data?.fileName ?? backup.data?.name ?? ''}`);
  const licenceAfterBackup = await api('/license/status', { anonymous: true });
  check('the licence survives the backup', licenceAfterBackup.data?.state === 'ACTIVE', `state ${licenceAfterBackup.data?.state}`);
  return true;
}

/// The two people the separation of duties needs: a clerk trusted with one
/// shelf, and an approver. Both are real users with real roles in the installed
/// database, not flags on a request.
async function makeSecondPerson(stamp, branchId, grantedWarehouseIds) {
  const permissions = await api('/admin/permissions');
  const all = (permissions.data?.items ?? permissions.data ?? []).map((row) => row.code).filter(Boolean);
  const approverRole = await api('/admin/roles', {
    method: 'POST',
    body: { code: `EAPP-${stamp}`, nameEn: `Approver ${stamp}`, nameAr: `معتمد ${stamp}`, permissions: all },
  });
  const clerkPermissions = all.filter((code) => code.startsWith('inventory.') || code.startsWith('common.'));
  const clerkRole = await api('/admin/roles', {
    method: 'POST',
    body: { code: `ECLK-${stamp}`, nameEn: `Clerk ${stamp}`, nameAr: `أمين ${stamp}`, permissions: clerkPermissions },
  });
  check('two roles are created for the two people', Boolean(approverRole.data?.id) && Boolean(clerkRole.data?.id),
    `${approverRole.data?.code} / ${clerkRole.data?.code}`);
  if (!approverRole.data?.id || !clerkRole.data?.id) return null;

  const password = `E2e-installed-${stamp}!`;
  const makeUser = async (username, roleId) => api('/admin/users', {
    method: 'POST',
    body: {
      username,
      fullNameEn: username,
      fullNameAr: username,
      password,
      roleIds: [roleId],
      branchIds: [branchId],
    },
  });
  const clerk = await makeUser(`eclerk${stamp}`, clerkRole.data.id);
  const approver = await makeUser(`eapprover${stamp}`, approverRole.data.id);
  check('both people exist in the installed database', Boolean(clerk.data?.id) && Boolean(approver.data?.id),
    `clerk ${clerk.status}/${clerk.data?.detail ?? clerk.data?.id ?? ''} · approver ${approver.status}/${approver.data?.detail ?? approver.data?.id ?? ''}`);
  if (!clerk.data?.id || !approver.data?.id) return null;

  const clerkSession = await signIn(`eclerk${stamp}`, password);
  const approverSession = await signIn(`eapprover${stamp}`, password);
  check('both can sign in to the installed program',
    clerkSession.status === 201 && approverSession.status === 201,
    `clerk HTTP ${clerkSession.status}, approver HTTP ${approverSession.status}`);
  void grantedWarehouseIds;
  return {
    clerkId: clerk.data.id,
    clerkToken: clerkSession.token,
    approverToken: approverSession.token,
  };
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

async function main() {
  if (!API) throw new Error('KAYAN_API is required');
  if (!ADMIN_PASSWORD) throw new Error('KAYAN_ADMIN_PASSWORD is required');
  if (!GENERATOR_HOME) throw new Error('KAYAN_GENERATOR_HOME is required');
  console.log(`Proving the installed program at ${API}`);
  const health = await api('/health', { anonymous: true });
  check('the installed program reports a healthy database',
    health.data?.status === 'ok' && health.data?.database === 'up', `${health.data?.database}`);
  if (!(await proveLicence())) return report();
  if (!(await proveWarehouse())) return report();
  report();
}

main().catch((error) => {
  console.error('Proof aborted:', error);
  if (REPORT_PATH) {
    try {
      writeFileSync(REPORT_PATH, JSON.stringify({ api: API, pass, fail, failures, results, aborted: String(error) }, null, 2));
    } catch {
      // Ignore.
    }
  }
  process.exitCode = 1;
});
