import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MasterDataBackupService, MasterDataKind, MasterDataPermissions } from './master-data-backup.service';

const RUN = process.env.KAYAN_MASTER_DATA_BACKUP_PG === '1';
const FULL: MasterDataPermissions = {
  salePrice: true,
  purchasePrice: true,
  manageSalePrice: true,
  managePurchasePrice: true,
};

(RUN ? describe : describe.skip)('independent master-data backup/restore on isolated PostgreSQL', () => {
  jest.setTimeout(90_000);
  let prisma: PrismaService;
  let service: MasterDataBackupService;
  let activeCompanyId: string | null = null;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new MasterDataBackupService(prisma, { recordRequired: jest.fn() } as never);
  });

  afterEach(async () => {
    if (!activeCompanyId) return;
    await prisma.auditLog.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.salesInvoice.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.purchaseInvoice.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.stockMovement.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.stockBalance.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.customer.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.supplier.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.item.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.priceList.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.branch.deleteMany({ where: { companyId: activeCompanyId } });
    await prisma.company.delete({ where: { id: activeCompanyId } });
    activeCompanyId = null;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it.each(['items', 'customers', 'suppliers'] as const)(
    '%s round-trips a full independent archive without changing linked rows',
    async (kind: MasterDataKind) => {
      const companyId = randomUUID();
      activeCompanyId = companyId;
      const suffix = companyId.slice(0, 8);
      await prisma.company.create({ data: {
        id: companyId,
        code: `MD-${suffix}`,
        nameEn: 'Master data test company',
        nameAr: 'شركة اختبار البيانات الأساسية',
      } });
      const branch = await prisma.branch.create({ data: {
        companyId,
        code: `BR-${suffix}`,
        nameEn: 'Master data test branch',
        nameAr: 'فرع اختبار البيانات الأساسية',
      } });

      let masterId: string;
      let relationId: string;
      let priceListId: string | null = null;
      const code = `${kind}-${suffix}`;
      if (kind === 'items') {
        const item = await prisma.item.create({ data: {
          companyId,
          code,
          nameEn: 'Original item name',
          nameAr: 'اسم الصنف الأصلي',
          unit: 'box',
          salePrice: '20.0000',
          purchasePrice: '12.0000',
          isStockTracked: true,
        } });
        masterId = item.id;
        const unit = await prisma.itemUnit.create({ data: {
          itemId: item.id,
          unit: 'carton',
          factor: '12.000000',
        } });
        relationId = unit.id;
        await prisma.stockBalance.create({ data: {
          companyId,
          branchId: branch.id,
          itemId: item.id,
          quantity: '9.0000',
          value: '90.0000',
        } });
        await prisma.stockMovement.create({ data: {
          companyId,
          branchId: branch.id,
          itemId: item.id,
          movementDate: new Date('2026-01-15T00:00:00.000Z'),
          direction: 'IN',
          quantity: '9.0000',
          unitCost: '10.0000',
          totalCost: '90.0000',
          referenceType: 'MASTER_DATA_TEST',
          referenceNumber: `MD-${suffix}`,
        } });
      } else {
        const list = await prisma.priceList.create({ data: {
          companyId,
          code: `PL-${suffix}`,
          nameEn: 'Existing price list',
          nameAr: 'قائمة أسعار موجودة',
        } });
        priceListId = list.id;
        if (kind === 'customers') {
          const party = await prisma.customer.create({ data: {
            companyId,
            code,
            nameEn: 'Original customer name',
            nameAr: 'اسم العميل الأصلي',
            phone: '01000000000',
            priceListId,
          } });
          masterId = party.id;
          relationId = list.id;
          await prisma.salesInvoice.create({ data: {
            companyId,
            branchId: branch.id,
            invoiceNumber: `SI-${suffix}`,
            invoiceDate: new Date('2026-01-15T00:00:00.000Z'),
            customerId: party.id,
          } });
        } else {
          const party = await prisma.supplier.create({ data: {
            companyId,
            code,
            nameEn: 'Original supplier name',
            nameAr: 'اسم المورد الأصلي',
            phone: '02000000000',
            priceListId,
          } });
          masterId = party.id;
          relationId = list.id;
          await prisma.purchaseInvoice.create({ data: {
            companyId,
            branchId: branch.id,
            invoiceNumber: `PI-${suffix}`,
            invoiceDate: new Date('2026-01-15T00:00:00.000Z'),
            supplierId: party.id,
          } });
        }
      }

      const archive = await service.create(kind, companyId, FULL);
      expect(archive.recordCount).toBe(1);
      expect(archive.records[0]).not.toHaveProperty('id');
      expect(archive.records[0]).not.toHaveProperty('companyId');
      archive.records.push({ ...archive.records[0], code: `${code}-new` });
      archive.recordCount += 1;

      if (kind === 'items') {
        await prisma.item.update({ where: { id: masterId }, data: { nameEn: 'Changed item name' } });
      } else if (kind === 'customers') {
        await prisma.customer.update({ where: { id: masterId }, data: { phone: 'changed' } });
      } else {
        await prisma.supplier.update({ where: { id: masterId }, data: { phone: 'changed' } });
      }

      const preview = await service.preview(kind, companyId, archive, FULL);
      expect(preview).toMatchObject({ total: 2, createCount: 1, updateCount: 1, conflictCount: 0 });
      const restored = await service.restore(
        kind, companyId, randomUUID(), archive, preview.previewFingerprint, FULL,
      );
      expect(restored).toMatchObject({ restored: 2, created: 1, updated: 1, preservedHistoricalRows: true });

      if (kind === 'items') {
        const item = await prisma.item.findUniqueOrThrow({ where: { id: masterId } });
        expect(item.nameEn).toBe('Original item name');
        const unit = await prisma.itemUnit.findUniqueOrThrow({ where: { id: relationId } });
        expect(unit.itemId).toBe(masterId);
        const movement = await prisma.stockMovement.findFirstOrThrow({ where: { companyId } });
        expect(movement.itemId).toBe(masterId);
        expect(movement.quantity.toString()).toBe('9');
        const balance = await prisma.stockBalance.findFirstOrThrow({ where: { companyId } });
        expect(balance.itemId).toBe(masterId);
        expect(balance.quantity.toString()).toBe('9');
        expect(balance.value.toString()).toBe('90');
      } else if (kind === 'customers') {
        const party = await prisma.customer.findUniqueOrThrow({ where: { id: masterId } });
        expect(party.phone).toBe('01000000000');
        expect(party.priceListId).toBe(priceListId);
        const invoice = await prisma.salesInvoice.findFirstOrThrow({ where: { companyId } });
        expect(invoice.customerId).toBe(masterId);
      } else {
        const party = await prisma.supplier.findUniqueOrThrow({ where: { id: masterId } });
        expect(party.phone).toBe('02000000000');
        expect(party.priceListId).toBe(priceListId);
        const invoice = await prisma.purchaseInvoice.findFirstOrThrow({ where: { companyId } });
        expect(invoice.supplierId).toBe(masterId);
      }
    },
  );
});
