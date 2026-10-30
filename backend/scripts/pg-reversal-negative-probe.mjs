/**
 * Read-only BEHAVIOUR PROBE (not a committed guard): can a transfer REVERSAL
 * drive a specific warehouse card below zero while allowNegativeStock=false?
 *
 * Sequence on a real PostgreSQL 18 server:
 *   1. transfer A -> B of 5 (A:10 -> 5, B:0 -> 5)
 *   2. the 5 units leave B through an ADJUSTMENT OUT (B:5 -> 0)
 *   3. reverse the original transfer: its OUT leg targets B
 * Result measured independently from stock_movements.
 *
 * Usage: DATABASE_URL=... node scripts/pg-reversal-negative-probe.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuditService } from '../dist/src/common/audit/audit.service.js';
import { CompanySettingsService } from '../dist/src/common/settings/company-settings.module.js';
import { WarehouseService } from '../dist/src/common/warehouse/warehouse.service.js';
import { AccountMapService } from '../dist/src/modules/accounting/account-map.service.js';
import { CostCentersService } from '../dist/src/modules/accounting/cost-centers.service.js';
import { DocumentNumberService } from '../dist/src/modules/accounting/document-number.service.js';
import { FiscalPeriodsService } from '../dist/src/modules/accounting/fiscal-periods.service.js';
import { PostingService } from '../dist/src/modules/accounting/posting.service.js';
import { StockDocumentsService } from '../dist/src/modules/inventory/stock-documents.service.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const dec = (v) => new Prisma.Decimal(v);

let company = await prisma.company.findFirst({ where: { isActive: true } });
if (!company) {
  company = await prisma.company.create({
    data: { id: randomUUID(), code: 'CREV', nameEn: 'Reversal Probe Co', nameAr: 'شركة فحص العكس' },
  });
}
const companyId = company.id;
const suffix = randomUUID().slice(0, 8);
const user = await prisma.user.create({
  data: {
    companyId,
    username: `rev-probe-${suffix}`,
    fullNameEn: 'reversal probe',
    fullNameAr: 'مسبار العكس',
    passwordHash: 'x',
  },
});
await prisma.companySetting.upsert({
  where: { companyId },
  create: { companyId, allowNegativeStock: false },
  update: { allowNegativeStock: false },
});
const audit = new AuditService(prisma);
const numbers = new DocumentNumberService();
const periods = new FiscalPeriodsService(prisma, audit);
const costCenters = new CostCentersService(prisma, audit);
const posting = new PostingService(numbers, periods, costCenters);
const settings = new CompanySettingsService(prisma, audit);
const warehouses = new WarehouseService(prisma, audit);
const stock = new StockDocumentsService(
  prisma, numbers, posting, new AccountMapService(), audit, settings, warehouses, costCenters,
);

const branch = await prisma.branch.create({
  data: { companyId, code: `RPB-${suffix}`, nameEn: 'RP', nameAr: 'فرع', kind: 'HEADQUARTERS' },
});
const wA = await prisma.warehouse.create({ data: { companyId, branchId: branch.id, code: `RPA-${suffix}`, nameEn: 'A', nameAr: 'أ', isDefault: true } });
const wB = await prisma.warehouse.create({ data: { companyId, branchId: branch.id, code: `RPB-${suffix}`, nameEn: 'B', nameAr: 'ب' } });
const item = await prisma.item.create({ data: { companyId, code: `RPI-${suffix}`, nameEn: 'item', nameAr: 'صنف', unit: 'piece' } });
await prisma.fiscalPeriod.create({
  data: {
    companyId, code: `RP2051-${suffix}`, nameEn: '2051', nameAr: '2051',
    startDate: new Date('2051-01-01'), endDate: new Date('2051-12-31'), status: 'OPEN',
  },
});
for (const [code, type] of [['1104', 'ASSET'], ['5107', 'EXPENSE']]) {
  await prisma.account.create({
    data: { companyId, code, nameEn: code, nameAr: code, type, isPostable: true, isActive: true },
  }).catch((e) => {
    if (e.code !== 'P2002') throw e;
  });
}
await prisma.stockMovement.create({
  data: {
    companyId, branchId: branch.id, warehouseId: wA.id, itemId: item.id,
    movementDate: new Date('2051-01-05'), direction: 'IN', quantity: dec(10),
    unitCost: dec(7.5), totalCost: dec(75), referenceType: 'SEED',
  },
});
await prisma.stockBalance.create({
  data: { companyId, branchId: branch.id, itemId: item.id, quantity: dec(10), value: dec(75) },
});
const card = async (wId) => {
  const r = await prisma.$queryRaw`
    select coalesce(sum(case when direction='IN' then quantity else -quantity end),0)::text q
      from stock_movements where "companyId"=${companyId}::uuid and "warehouseId"=${wId}::uuid and "itemId"=${item.id}::uuid`;
  return Number(r[0].q);
};
const makeDoc = async (kind, qty, extra) =>
  prisma.stockDocument.create({
    data: {
      companyId, branchId: branch.id, kind, documentNumber: `RP-${randomUUID().slice(0, 8)}`,
      documentDate: new Date('2051-06-01'), status: 'DRAFT', ...extra,
      lines: { create: { id: randomUUID(), itemId: item.id, lineNumber: 1, quantity: dec(qty), unitCost: dec(7.5) } },
    },
  });

// 1) transfer A -> B, 5
const transfer = await makeDoc('TRANSFER', 5, {
  fromBranchId: branch.id, toBranchId: branch.id, fromWarehouseId: wA.id, toWarehouseId: wB.id,
});
await stock.post(companyId, user.id, transfer.id);
console.log('after transfer: A=%s B=%s', await card(wA.id), await card(wB.id));

// 2) adjustment OUT of 5 from B (the goods physically leave)
const adjustment = await makeDoc('ADJUSTMENT', -5, { toWarehouseId: wB.id });
await stock.post(companyId, user.id, adjustment.id);
console.log('after adjustment OUT: A=%s B=%s', await card(wA.id), await card(wB.id));

// 3) reverse the transfer
await stock.reverse(companyId, user.id, transfer.id);
const cardA = await card(wA.id);
const cardB = await card(wB.id);
const branchBalance = await prisma.stockBalance.findUnique({
  where: { companyId_branchId_itemId: { companyId, branchId: branch.id, itemId: item.id } },
});
console.log('after reversal: A=%s B=%s branchBalance=%s', cardA, cardB, Number(branchBalance.quantity));
console.log(cardB < 0
  ? 'FINDING: reversal produced a negative per-warehouse card despite allowNegativeStock=false (branch row stays nonnegative)'
  : 'no negative warehouse card from reversal');
await prisma.$disconnect();
