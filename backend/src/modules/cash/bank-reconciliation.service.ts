import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * Bank reconciliation.
 *
 * The bank sends a statement. The books have their own opinion. This service
 * puts the two side by side: it records what the statement said, marks the
 * vouchers the accountant matched to it, and reports the difference - which is
 * either an item in transit, a bank charge nobody recorded, or a mistake in
 * one of the two. Silence about that difference is what makes a reconciliation
 * worthless, so it is always returned.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, cashAccountId?: string) {
    const items = await this.prisma.bankReconciliation.findMany({
      where: { companyId, ...(cashAccountId ? { cashAccountId } : {}) },
      orderBy: { statementDate: 'desc' },
      include: { cashAccount: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    return { items: items.map((row) => this.toResponse(row)), total: items.length };
  }

  async findOne(companyId: string, id: string) {
    const reconciliation = await this.prisma.bankReconciliation.findFirst({
      where: { id, companyId },
      include: {
        cashAccount: { select: { code: true, nameEn: true, nameAr: true } },
        vouchers: {
          where: { deletedAt: null },
          select: {
            id: true,
            voucherNumber: true,
            voucherDate: true,
            amount: true,
            kind: true,
            description: true,
          },
          orderBy: { voucherDate: 'asc' },
        },
      },
    });
    if (!reconciliation) throw new NotFoundException('Reconciliation not found');

    return {
      ...this.toResponse(reconciliation),
      vouchers: reconciliation.vouchers.map((voucher) => ({
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
        kind: voucher.kind.toLowerCase(),
        amount: voucher.amount.toFixed(MONEY_SCALE),
        description: voucher.description,
        reconciled: true,
      })),
    };
  }

  /** The vouchers nobody has matched to a statement yet. */
  async unmatched(companyId: string, cashAccountId: string, to?: string) {
    const date = to ? new Date(`${to.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const vouchers = await this.prisma.cashVoucher.findMany({
      where: {
        companyId,
        cashAccountId,
        deletedAt: null,
        status: 'POSTED',
        reconciliationId: null,
        voucherDate: { lte: date },
      },
      orderBy: { voucherDate: 'asc' },
      select: {
        id: true,
        voucherNumber: true,
        voucherDate: true,
        amount: true,
        kind: true,
        description: true,
        reference: true,
      },
    });

    return {
      cashAccountId,
      to: date.toISOString().slice(0, 10),
      items: vouchers.map((voucher) => ({
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
        kind: voucher.kind.toLowerCase(),
        amount: voucher.amount.toFixed(MONEY_SCALE),
        description: voucher.description,
        reference: voucher.reference,
      })),
    };
  }

  /**
   * Records a reconciliation.
   *
   * The book balance is read from the ledger at the statement date, not
   * summed from the vouchers: the ledger is the record, and a reconciliation
   * that agreed with a derived number would prove nothing.
   */
  async create(
    companyId: string,
    userId: string,
    dto: {
      cashAccountId: string;
      statementDate: string;
      periodFrom: string;
      periodTo: string;
      statementBalance: string | number;
      notes?: string;
      voucherIds?: string[];
      finalise?: boolean;
    },
  ) {
    if (typeof dto.cashAccountId !== 'string' || dto.cashAccountId.trim().length === 0) {
      throw new BadRequestException('cashAccountId is required');
    }
    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: { id: dto.cashAccountId, companyId, deletedAt: null },
      select: { id: true, accountId: true, currency: true, kind: true, code: true },
    });
    if (!cashAccount) throw new BadRequestException('The cash account does not exist');

    const statementDate = this.date(dto.statementDate, 'statementDate');
    const periodFrom = this.date(dto.periodFrom, 'periodFrom');
    const periodTo = this.date(dto.periodTo, 'periodTo');
    if (periodTo < periodFrom) {
      throw new BadRequestException('periodTo must not be before periodFrom');
    }

    let statementBalance: Prisma.Decimal;
    try {
      statementBalance = new Prisma.Decimal(String(dto.statementBalance)).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException('statementBalance is not a valid amount');
    }

    const bookRows = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND l."accountId" = ${cashAccount.accountId}::uuid
         AND e."entryDate" <= ${statementDate}::date
    `);
    const bookBalance = new Prisma.Decimal(bookRows[0]?.net ?? 0);
    const difference = bookBalance.minus(statementBalance);

    const voucherIds = dto.voucherIds ?? [];
    // Fast-fail validation before opening a transaction. This cannot prove the
    // vouchers are still unclaimed at write time, so the authoritative check is
    // repeated on the locked rows inside the transaction below.
    if (voucherIds.length > 0) {
      const vouchers = await this.prisma.cashVoucher.findMany({
        where: { id: { in: voucherIds }, companyId, deletedAt: null },
        select: { id: true, cashAccountId: true, status: true, reconciliationId: true, voucherNumber: true },
      });
      this.assertVouchersClaimable(vouchers, voucherIds, cashAccount.id);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let lockedVouchers: Array<{
        id: string;
        cashAccountId: string;
        status: string;
        reconciliationId: string | null;
        voucherNumber: string;
      }> = [];
      if (voucherIds.length > 0) {
        // Lock the target voucher rows in one stable order, so two concurrent
        // reconciliations claiming the same voucher serialise here instead of
        // overwriting each other's reconciliationId. The second caller blocks
        // until the first commits, then fails the re-validation on the lock.
        lockedVouchers = await tx.$queryRaw<typeof lockedVouchers>(Prisma.sql`
          SELECT id, "cashAccountId", status, "reconciliationId", "voucherNumber"
            FROM cash_vouchers
           WHERE "companyId" = ${companyId}::uuid
             AND "deletedAt" IS NULL
             AND id IN (${Prisma.join(voucherIds.map((id) => Prisma.sql`${id}::uuid`))})
           ORDER BY id
             FOR UPDATE
        `);
        this.assertVouchersClaimable(lockedVouchers, voucherIds, cashAccount.id);
      }

      const reconciliation = await tx.bankReconciliation.create({
        data: {
          companyId,
          cashAccountId: cashAccount.id,
          statementDate,
          periodFrom,
          periodTo,
          statementBalance,
          bookBalance,
          difference,
          status: dto.finalise === false ? 'DRAFT' : 'FINAL',
          notes: dto.notes?.trim() || null,
          createdBy: userId,
        },
      });

      if (voucherIds.length > 0) {
        // Conditional claim: only still-unclaimed rows may be updated. The row
        // lock makes the outcome deterministic; the predicate and the count
        // assertion are a second guarantee, and the database trigger is the
        // third. A mismatch rolls the whole reconciliation back.
        const claimed = await tx.cashVoucher.updateMany({
          where: { id: { in: voucherIds }, companyId, reconciliationId: null },
          data: { reconciledAt: new Date(), reconciliationId: reconciliation.id },
        });
        if (claimed.count !== lockedVouchers.length) {
          throw new BadRequestException(
            'One or more vouchers were already matched by another reconciliation',
          );
        }
      }

      return reconciliation;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'RECONCILE',
      entity: 'bank_reconciliations',
      entityId: created.id,
      after: {
        cashAccount: cashAccount.code,
        statementDate: statementDate.toISOString().slice(0, 10),
        bookBalance: bookBalance.toFixed(MONEY_SCALE),
        statementBalance: statementBalance.toFixed(MONEY_SCALE),
        difference: difference.toFixed(MONEY_SCALE),
        vouchers: voucherIds.length,
      },
    });

    return this.findOne(companyId, created.id);
  }

  /**
   * The four voucher rules, applied both before the transaction (fast fail)
   * and again on the FOR UPDATE-locked rows inside it (authoritative).
   */
  private assertVouchersClaimable(
    vouchers: Array<{
      id: string;
      cashAccountId: string;
      status: string;
      reconciliationId: string | null;
      voucherNumber: string;
    }>,
    requestedIds: string[],
    cashAccountId: string,
  ): void {
    if (vouchers.length !== requestedIds.length) {
      throw new BadRequestException('One or more vouchers do not exist in this company');
    }
    const wrongAccount = vouchers.filter((voucher) => voucher.cashAccountId !== cashAccountId);
    if (wrongAccount.length > 0) {
      throw new BadRequestException(
        `Voucher ${wrongAccount[0].voucherNumber} belongs to another cash account`,
      );
    }
    const notPosted = vouchers.filter((voucher) => voucher.status !== 'POSTED');
    if (notPosted.length > 0) {
      throw new BadRequestException(
        `Voucher ${notPosted[0].voucherNumber} is not posted, so it cannot appear on a bank statement match`,
      );
    }
    const alreadyMatched = vouchers.filter((voucher) => voucher.reconciliationId);
    if (alreadyMatched.length > 0) {
      throw new BadRequestException(
        `Voucher ${alreadyMatched[0].voucherNumber} is already matched to another reconciliation`,
      );
    }
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return parsed;
  }

  private toResponse(row: {
    id: string;
    statementDate: Date;
    periodFrom: Date;
    periodTo: Date;
    statementBalance: Prisma.Decimal;
    bookBalance: Prisma.Decimal;
    difference: Prisma.Decimal;
    status: string;
    notes: string | null;
    createdAt: Date;
    cashAccount?: { code: string; nameEn: string; nameAr: string };
  }) {
    const difference = new Prisma.Decimal(row.difference);
    return {
      id: row.id,
      cashAccount: row.cashAccount,
      statementDate: row.statementDate.toISOString().slice(0, 10),
      periodFrom: row.periodFrom.toISOString().slice(0, 10),
      periodTo: row.periodTo.toISOString().slice(0, 10),
      statementBalance: row.statementBalance.toFixed(MONEY_SCALE),
      bookBalance: row.bookBalance.toFixed(MONEY_SCALE),
      difference: difference.toFixed(MONEY_SCALE),
      // Said out loud rather than left for the reader to work out.
      isBalanced: difference.isZero(),
      status: row.status.toLowerCase(),
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
