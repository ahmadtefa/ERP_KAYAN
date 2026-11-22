import { ListTablesService } from './list-tables.service';

describe('branch-scoped list exports', () => {
  const COMPANY = 'company-1';
  const BRANCH = 'branch-1';

  it('filters sales and purchase invoice exports to the selected branch', async () => {
    const salesFind = jest.fn().mockResolvedValue([]);
    const purchaseFind = jest.fn().mockResolvedValue([]);
    const service = new ListTablesService({
      salesInvoice: { findMany: salesFind },
      purchaseInvoice: { findMany: purchaseFind },
    } as never);

    await service.invoices(COMPANY, { branchId: BRANCH }, 'sales');
    await service.invoices(COMPANY, { branchId: BRANCH }, 'purchase');

    expect(salesFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
    expect(purchaseFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
  });

  it('filters journal-entry exports to the selected branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ListTablesService({ journalEntry: { findMany } } as never);

    await service.journalEntries(COMPANY, { branchId: BRANCH });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
  });

  it('filters cash-voucher exports to the selected branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ListTablesService({ cashVoucher: { findMany } } as never);

    await service.cashVouchers(COMPANY, { branchId: BRANCH });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
  });

  it('filters stock balance exports to the selected branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ListTablesService({ stockBalance: { findMany } } as never);

    await service.stock(COMPANY, { branchId: BRANCH });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
  });

  it('filters stock cards by branch for both balances and movements', async () => {
    const balanceFind = jest.fn().mockResolvedValue([]);
    const movementFind = jest.fn().mockResolvedValue([]);
    const service = new ListTablesService({
      item: { findFirst: jest.fn().mockResolvedValue({ code: 'I-1', nameEn: 'Item', nameAr: 'صنف', unit: 'ea' }) },
      stockBalance: { findMany: balanceFind },
      stockMovement: { findMany: movementFind },
    } as never);

    await service.stockLedger(COMPANY, { itemId: 'item-1', branchId: BRANCH });

    expect(balanceFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
    expect(movementFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
  });

  it('filters cash-transfer exports to the selected branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ListTablesService({ cashTransfer: { findMany } } as never);

    await service.cashTransfers(COMPANY, { branchId: BRANCH });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY, branchId: BRANCH }) }),
    );
  });
});
