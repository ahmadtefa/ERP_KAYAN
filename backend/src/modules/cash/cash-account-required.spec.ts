import { BadRequestException } from '@nestjs/common';

import { CashTransfersService } from './cash-transfers.service';
import { CashVouchersService } from './cash-vouchers.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/// Prisma reads `{ id: undefined }` as "no filter at all". A request that
/// leaves the cash account out must therefore be refused by the service, not
/// handed to the database - otherwise the first box in the company receives
/// money the user never chose.
describe('cash documents name their cash account', () => {
  function vouchers() {
    const prisma = {
      cashAccount: { findFirst: jest.fn() },
      company: { findUnique: jest.fn() },
      audit: { record: jest.fn() },
    };
    const service = new CashVouchersService(
      prisma as never,
      { next: jest.fn() } as never,
      { post: jest.fn() } as never,
      { resolve: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
    return { service, prisma };
  }

  it('refuses a receipt with no cash account instead of picking the first one', async () => {
    const { service, prisma } = vouchers();
    await expect(
      service.create(COMPANY_ID, BRANCH_ID, USER_ID, {
        kind: 'RECEIPT',
        voucherDate: '2026-10-20',
        amount: '10',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cashAccount.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a payment with a blank cash account', async () => {
    const { service } = vouchers();
    await expect(
      service.create(COMPANY_ID, BRANCH_ID, USER_ID, {
        kind: 'PAYMENT',
        voucherDate: '2026-10-20',
        amount: '10',
        cashAccountId: '   ',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a transfer that names only the destination account', async () => {
    const prisma = { cashAccount: { findFirst: jest.fn() } };
    const service = new CashTransfersService(
      prisma as never,
      { next: jest.fn() } as never,
      { post: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
    await expect(
      service.create(COMPANY_ID, BRANCH_ID, USER_ID, {
        toCashAccountId: '44444444-4444-4444-8444-444444444444',
        transferDate: '2026-10-20',
        amount: '10',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cashAccount.findFirst).not.toHaveBeenCalled();
  });
});
