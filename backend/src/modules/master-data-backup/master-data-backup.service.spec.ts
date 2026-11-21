import { ForbiddenException } from '@nestjs/common';
import { MasterDataBackupService, MasterDataKind, MasterDataPermissions } from './master-data-backup.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const FULL: MasterDataPermissions = {
  salePrice: true,
  purchasePrice: true,
  manageSalePrice: true,
  managePurchasePrice: true,
};

function row(kind: MasterDataKind, code: string, id: string): Record<string, unknown> {
  const shared = {
    id,
    companyId: COMPANY,
    code,
    nameEn: `${kind} ${code}`,
    nameAr: `${kind} ${code} ar`,
    phone: null,
    email: null,
    taxNumber: null,
    address: null,
    isActive: true,
    notes: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    deletedAt: null,
    createdBy: 'creator-kept',
    updatedBy: 'editor-kept',
    historyRelation: `history-${code}`,
  };
  if (kind === 'items') return {
    ...shared,
    unit: 'box',
    barcode: null,
    salePrice: '12.5000',
    purchasePrice: '8.2500',
    reorderLevel: '2.0000',
    taxRate: '14.0000',
    isStockTracked: true,
    countryOfOrigin: null,
    requiresBatch: false,
    requiresProductionDate: false,
    requiresExpiryDate: false,
    useFefo: true,
    allowExpiredIssue: false,
    expiredIssueNeedsApproval: false,
  };
  if (kind === 'customers') return {
    ...shared,
    creditLimit: '1000.0000',
    paymentTermDays: 30,
    priceListId: 'price-list-kept',
  };
  return { ...shared, paymentTermDays: 15, priceListId: 'supplier-list-kept' };
}

function harness(kind: MasterDataKind) {
  let state = { [kind]: [row(kind, `${kind}-A`, `${kind}-id-A`)] } as Record<MasterDataKind, Array<Record<string, unknown>>>;
  let failCreateCode: string | null = null;
  const makeModel = (table: MasterDataKind, readState: () => typeof state) => ({
    findMany: jest.fn(async (args: { where: { companyId: string; code?: { in: string[] } }; select: Record<string, boolean> }) => {
      return readState()[table]
        .filter((entry) => entry.companyId === args.where.companyId &&
          (!args.where.code || args.where.code.in.includes(String(entry.code))))
        .map((entry) => Object.fromEntries(Object.keys(args.select).map((key) => [key, entry[key]])));
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.code === failCreateCode) throw new Error('simulated constraint failure');
      const created = {
        ...data,
        id: `${table}-id-${String(data.code)}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      };
      readState()[table].push(created);
      return created;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { id: string; companyId: string }; data: Record<string, unknown> }) => {
      const found = readState()[table].find((entry) => entry.id === where.id && entry.companyId === where.companyId);
      if (!found) return { count: 0 };
      Object.assign(found, data, { updatedAt: new Date('2026-01-01T00:00:00.000Z') });
      return { count: 1 };
    }),
  });
  const rootModels = {
    item: makeModel('items', () => state),
    customer: makeModel('customers', () => state),
    supplier: makeModel('suppliers', () => state),
  };
  const prisma = {
    ...rootModels,
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const transactionState = structuredClone(state);
      const txModels = {
        item: makeModel('items', () => transactionState),
        customer: makeModel('customers', () => transactionState),
        supplier: makeModel('suppliers', () => transactionState),
      };
      const tx = { ...txModels, auditLog: { create: jest.fn() } };
      const result = await work(tx);
      state = transactionState;
      return result;
    }),
  };
  const audit = { recordRequired: jest.fn(async () => undefined) };
  const service = new MasterDataBackupService(prisma as never, audit as never);
  return {
    service,
    prisma,
    audit,
    get state() { return state; },
    set failCreateCode(value: string | null) { failCreateCode = value; },
  };
}

describe('independent master-data backups', () => {
  it.each(['items', 'customers', 'suppliers'] as const)(
    '%s round-trips by code while preserving database identity and historical links',
    async (kind) => {
      const h = harness(kind);
      const originalId = `${kind}-id-A`;
      const archive = await h.service.create(kind, COMPANY, FULL);
      expect(archive).toMatchObject({ format: 'kayan-master-data-backup', version: 1, kind, recordCount: 1 });
      expect(archive.records[0]).not.toHaveProperty('id');
      expect(archive.records[0]).not.toHaveProperty('companyId');
      expect(archive.records[0]).not.toHaveProperty('priceListId');

      h.state[kind][0].nameEn = 'Changed after backup';
      const second = { ...archive.records[0], code: `${kind}-B` };
      archive.records.push(second);
      archive.recordCount = archive.records.length;
      const preview = await h.service.preview(kind, COMPANY, archive, FULL);
      expect(preview).toMatchObject({ createCount: 1, updateCount: 1, conflictCount: 0 });

      const restored = await h.service.restore(
        kind, COMPANY, 'restore-actor', archive, preview.previewFingerprint, FULL,
      );
      expect(restored).toMatchObject({ restored: 2, created: 1, updated: 1, preservedHistoricalRows: true });
      const existing = h.state[kind].find((entry) => entry.code === `${kind}-A`)!;
      expect(existing.id).toBe(originalId);
      expect(existing.nameEn).toBe(`${kind} ${kind}-A`);
      expect(existing.historyRelation).toBe(`history-${kind}-A`);
      expect(existing.createdBy).toBe('creator-kept');
      expect(existing.updatedBy).toBe('editor-kept');
      expect(h.state[kind]).toHaveLength(2);
      expect(h.audit.recordRequired).toHaveBeenCalledTimes(1);
    },
  );

  it('does not include purchase prices or cost fields in a backup without the price grant', async () => {
    const h = harness('items');
    const archive = await h.service.create('items', COMPANY, {
      salePrice: false,
      purchasePrice: false,
      manageSalePrice: false,
      managePurchasePrice: false,
    });
    expect(archive.records[0]).not.toHaveProperty('salePrice');
    expect(archive.records[0]).not.toHaveProperty('purchasePrice');
    expect(JSON.stringify(archive)).not.toMatch(/unitCost|averageCost|inventoryCost/i);
  });

  it('refuses a price-bearing restore without the matching write permission', async () => {
    const h = harness('items');
    const archive = await h.service.create('items', COMPANY, FULL);
    await expect(h.service.preview('items', COMPANY, archive, {
      salePrice: true,
      purchasePrice: true,
      manageSalePrice: false,
      managePurchasePrice: false,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects another company and repeated codes before touching records', async () => {
    const h = harness('customers');
    const archive = await h.service.create('customers', COMPANY, FULL);
    await expect(h.service.preview('customers', '22222222-2222-4222-8222-222222222222', archive, FULL)).rejects.toThrow(/different company/);
    archive.records.push({ ...archive.records[0] });
    archive.recordCount += 1;
    await expect(h.service.preview('customers', COMPANY, archive, FULL)).rejects.toThrow(/more than once/);
    expect(h.state.customers).toHaveLength(1);
  });

  it('rejects a stale preview and rolls back the entire restore on a write failure', async () => {
    const h = harness('suppliers');
    const archive = await h.service.create('suppliers', COMPANY, FULL);
    archive.records.push({ ...archive.records[0], code: 'SUPPLIER-B' });
    archive.recordCount += 1;
    const preview = await h.service.preview('suppliers', COMPANY, archive, FULL);
    h.state.suppliers[0].updatedAt = new Date('2026-01-02T00:00:00.000Z');
    await expect(h.service.restore('suppliers', COMPANY, 'actor', archive, preview.previewFingerprint, FULL)).rejects.toThrow(/changed after preview/);

    const fresh = await h.service.preview('suppliers', COMPANY, archive, FULL);
    h.failCreateCode = 'SUPPLIER-B';
    const before = structuredClone(h.state.suppliers);
    await expect(h.service.restore('suppliers', COMPANY, 'actor', archive, fresh.previewFingerprint, FULL)).rejects.toThrow(/simulated constraint failure/);
    expect(h.state.suppliers).toEqual(before);
    expect(h.audit.recordRequired).not.toHaveBeenCalled();
  });
});
