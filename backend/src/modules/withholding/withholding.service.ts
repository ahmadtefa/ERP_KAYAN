import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  directionFor,
  parseRate,
  withheldAmount,
  WithholdingDirection,
  WithholdingError,
} from './withholding-rules';

const SCALE = 4;

export type RateInput = {
  code?: string;
  nameAr?: string;
  nameEn?: string;
  direction?: string;
  ratePercent?: string | number;
  accountId?: string;
  isActive?: boolean;
};

type RateRow = {
  id: string; code: string; nameAr: string; nameEn: string; direction: WithholdingDirection;
  ratePercent: Prisma.Decimal; accountId: string; isActive: boolean;
  accountCode?: string | null; accountNameEn?: string | null; accountNameAr?: string | null;
};

const rateView = (r: RateRow) => ({
  id: r.id, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, direction: r.direction,
  ratePercent: new Prisma.Decimal(r.ratePercent).toFixed(SCALE), accountId: r.accountId, isActive: r.isActive,
  accountCode: r.accountCode ?? null, accountNameEn: r.accountNameEn ?? null, accountNameAr: r.accountNameAr ?? null,
});

function fail(field: string, message: string): never {
  throw new BadRequestException({ code: 'VALIDATION', message, field });
}

/**
 * Withholding tax set-up, the amount held on a draft voucher, and the report.
 * The posting itself is done by the cash voucher service when it posts, using the row written here.
 */
@Injectable()
export class WithholdingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async rateRows(companyId: string, extra: Prisma.Sql = Prisma.empty) {
    return this.prisma.$queryRaw<RateRow[]>(Prisma.sql`
      SELECT r.*, a.code AS "accountCode", a."nameEn" AS "accountNameEn", a."nameAr" AS "accountNameAr"
        FROM withholding_rates r JOIN accounts a ON a.id = r."accountId"
       WHERE r."companyId" = ${companyId}::uuid ${extra}
       ORDER BY r.direction, r.code`);
  }

  async listRates(companyId: string) {
    return { items: (await this.rateRows(companyId)).map(rateView) };
  }

  private text(value: unknown, field: string, max: number): string {
    const v = String(value ?? '').trim();
    if (!v) fail(field, `${field} is required`);
    if (v.length > max) fail(field, `${field} is too long`);
    return v;
  }

  private async checkAccount(companyId: string, accountId: unknown, direction: WithholdingDirection) {
    if (!accountId) fail('accountId', 'Choose the account that holds the tax');
    const [a] = await this.prisma.$queryRaw<{ type: string; isPostable: boolean; isActive: boolean; code: string }[]>(Prisma.sql`
      SELECT type::text AS type, "isPostable", "isActive", code FROM accounts
       WHERE id = ${String(accountId)}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
    if (!a) fail('accountId', 'That account does not exist');
    if (!a.isPostable || !a.isActive) fail('accountId', `Account ${a.code} cannot receive postings`);
    const wanted = direction === 'PAYABLE' ? 'LIABILITY' : 'ASSET';
    if (a.type !== wanted) {
      fail('accountId', direction === 'PAYABLE'
        ? 'Tax withheld from suppliers is owed to the tax authority: choose a liability account'
        : 'Tax withheld by customers is a claim on the tax authority: choose an asset account');
    }
    return String(accountId);
  }

  async createRate(companyId: string, userId: string, input: RateInput) {
    const direction = String(input.direction ?? '').toUpperCase();
    if (direction !== 'PAYABLE' && direction !== 'RECEIVABLE') fail('direction', 'direction must be PAYABLE or RECEIVABLE');
    let rate: Prisma.Decimal;
    try { rate = parseRate(input.ratePercent); } catch (e) { if (e instanceof WithholdingError) fail('ratePercent', e.message); throw e; }
    const code = this.text(input.code, 'code', 32);
    const nameAr = this.text(input.nameAr, 'nameAr', 160);
    const nameEn = this.text(input.nameEn, 'nameEn', 160);
    const accountId = await this.checkAccount(companyId, input.accountId, direction);
    const id = randomUUID();
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO withholding_rates (id,"companyId",code,"nameAr","nameEn",direction,"ratePercent","accountId","createdBy")
        VALUES (${id}::uuid, ${companyId}::uuid, ${code}, ${nameAr}, ${nameEn}, ${direction}, ${rate.toFixed(SCALE)}::numeric, ${accountId}::uuid, ${userId}::uuid)`);
    } catch (error) {
      if (String((error as Error).message).includes('withholding_rates_code')) {
        throw new ConflictException({ code: 'WITHHOLDING_RATE_DUPLICATE', message: 'A rate with that code already exists', field: 'code' });
      }
      throw error;
    }
    await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'withholding_rates', entityId: id, after: { code, direction, ratePercent: rate.toFixed(SCALE) } });
    return rateView((await this.rateRows(companyId, Prisma.sql`AND r.id = ${id}::uuid`))[0]);
  }

  /** A rate that already served a voucher keeps its percent and account: only names and the active flag change. */
  async updateRate(companyId: string, userId: string, id: string, input: RateInput) {
    const [current] = await this.rateRows(companyId, Prisma.sql`AND r.id = ${id}::uuid`);
    if (!current) throw new NotFoundException({ code: 'WITHHOLDING_RATE_NOT_FOUND', message: 'Withholding rate not found' });
    const [{ used }] = await this.prisma.$queryRaw<{ used: number }[]>(Prisma.sql`
      SELECT count(*)::int AS used FROM voucher_withholdings WHERE "rateId" = ${id}::uuid`);
    const nameAr = input.nameAr !== undefined ? this.text(input.nameAr, 'nameAr', 160) : current.nameAr;
    const nameEn = input.nameEn !== undefined ? this.text(input.nameEn, 'nameEn', 160) : current.nameEn;
    let rate = new Prisma.Decimal(current.ratePercent);
    let accountId = current.accountId;
    if (input.ratePercent !== undefined || input.accountId !== undefined) {
      if (used > 0) {
        throw new ConflictException({ code: 'WITHHOLDING_RATE_IN_USE', message: 'This rate was already used on vouchers. Add a new rate instead of changing it.' });
      }
      if (input.ratePercent !== undefined) {
        try { rate = parseRate(input.ratePercent); } catch (e) { if (e instanceof WithholdingError) fail('ratePercent', e.message); throw e; }
      }
      if (input.accountId !== undefined) accountId = await this.checkAccount(companyId, input.accountId, current.direction);
    }
    const isActive = input.isActive ?? current.isActive;
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE withholding_rates SET "nameAr" = ${nameAr}, "nameEn" = ${nameEn}, "ratePercent" = ${rate.toFixed(SCALE)}::numeric,
             "accountId" = ${accountId}::uuid, "isActive" = ${isActive}, "updatedAt" = now()
       WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    await this.audit.record({ companyId, userId, action: 'UPDATE', entity: 'withholding_rates', entityId: id, after: { isActive, ratePercent: rate.toFixed(SCALE) } });
    return rateView((await this.rateRows(companyId, Prisma.sql`AND r.id = ${id}::uuid`))[0]);
  }

  private async draftVoucher(companyId: string, voucherId: string) {
    const [v] = await this.prisma.$queryRaw<{
      id: string; kind: 'RECEIPT' | 'PAYMENT'; amount: Prisma.Decimal; status: string; customerId: string | null; supplierId: string | null;
    }[]>(Prisma.sql`
      SELECT id, kind::text AS kind, amount, status::text AS status, "customerId", "supplierId" FROM cash_vouchers
       WHERE id = ${voucherId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
    if (!v) throw new NotFoundException({ code: 'VOUCHER_NOT_FOUND', message: 'Voucher not found' });
    if (v.status !== 'DRAFT') {
      throw new ConflictException({ code: 'WITHHOLDING_VOUCHER_POSTED', message: 'The voucher is already posted, so its withholding can no longer change' });
    }
    return v;
  }

  /** Sets (or replaces) the withholding on a draft voucher. */
  async attach(companyId: string, userId: string, voucherId: string, rateId: string) {
    const v = await this.draftVoucher(companyId, voucherId);
    const [rate] = await this.rateRows(companyId, Prisma.sql`AND r.id = ${String(rateId)}::uuid`);
    if (!rate) fail('rateId', 'That withholding rate does not exist');
    if (!rate.isActive) fail('rateId', 'That withholding rate is not active');
    let tax: Prisma.Decimal;
    try {
      const direction = directionFor(v.kind, !!v.customerId, !!v.supplierId);
      if (direction !== rate.direction) {
        fail('rateId', direction === 'PAYABLE'
          ? 'This is a payment to a supplier: choose a rate for tax withheld from suppliers'
          : 'This is a receipt from a customer: choose a rate for tax withheld by customers');
      }
      tax = withheldAmount(v.amount, rate.ratePercent);
    } catch (e) {
      if (e instanceof WithholdingError) fail('rateId', e.message);
      throw e;
    }
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO voucher_withholdings (id,"companyId","voucherId","rateId",direction,"ratePercent",base,amount,"accountId","createdBy")
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${voucherId}::uuid, ${rate.id}::uuid, ${rate.direction},
              ${new Prisma.Decimal(rate.ratePercent).toFixed(SCALE)}::numeric, ${new Prisma.Decimal(v.amount).toFixed(SCALE)}::numeric,
              ${tax.toFixed(SCALE)}::numeric, ${rate.accountId}::uuid, ${userId}::uuid)
      ON CONFLICT ("voucherId") DO UPDATE SET "rateId" = EXCLUDED."rateId", direction = EXCLUDED.direction,
        "ratePercent" = EXCLUDED."ratePercent", base = EXCLUDED.base, amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId"`);
    await this.audit.record({ companyId, userId, action: 'WITHHOLDING_SET', entity: 'cash_vouchers', entityId: voucherId, after: { rate: rate.code, tax: tax.toFixed(SCALE) } });
    return this.forVoucher(companyId, voucherId);
  }

  async detach(companyId: string, userId: string, voucherId: string) {
    await this.draftVoucher(companyId, voucherId);
    await this.prisma.$executeRaw(Prisma.sql`DELETE FROM voucher_withholdings WHERE "voucherId" = ${voucherId}::uuid AND "companyId" = ${companyId}::uuid`);
    await this.audit.record({ companyId, userId, action: 'WITHHOLDING_CLEARED', entity: 'cash_vouchers', entityId: voucherId, after: {} });
    return this.forVoucher(companyId, voucherId);
  }

  async forVoucher(companyId: string, voucherId: string) {
    const [row] = await this.prisma.$queryRaw<{ rateId: string; code: string; direction: string; ratePercent: Prisma.Decimal; base: Prisma.Decimal; amount: Prisma.Decimal }[]>(Prisma.sql`
      SELECT w."rateId", r.code, w.direction, w."ratePercent", w.base, w.amount
        FROM voucher_withholdings w JOIN withholding_rates r ON r.id = w."rateId"
       WHERE w."voucherId" = ${voucherId}::uuid AND w."companyId" = ${companyId}::uuid`);
    if (!row) return { withholding: null };
    const base = new Prisma.Decimal(row.base);
    const amount = new Prisma.Decimal(row.amount);
    return {
      withholding: {
        rateId: row.rateId, code: row.code, direction: row.direction,
        ratePercent: new Prisma.Decimal(row.ratePercent).toFixed(SCALE),
        base: base.toFixed(SCALE), amount: amount.toFixed(SCALE), net: base.minus(amount).toFixed(SCALE),
      },
    };
  }

  /** Posted vouchers only: what was withheld in the period, per rate, and each voucher behind it. */
  async report(companyId: string, query: { from?: string; to?: string; direction?: string }) {
    const from = this.day(query.from, 'from');
    const to = this.day(query.to, 'to');
    if (from > to) fail('from', 'from must not be after to');
    const dir = query.direction ? String(query.direction).toUpperCase() : null;
    if (dir && dir !== 'PAYABLE' && dir !== 'RECEIVABLE') fail('direction', 'direction must be PAYABLE or RECEIVABLE');
    const rows = await this.prisma.$queryRaw<{
      voucherId: string; voucherNumber: string; voucherDate: Date; direction: string; code: string; ratePercent: Prisma.Decimal;
      base: Prisma.Decimal; amount: Prisma.Decimal; partyEn: string | null; partyAr: string | null;
    }[]>(Prisma.sql`
      SELECT v.id AS "voucherId", v."voucherNumber", v."voucherDate", w.direction, r.code, w."ratePercent", w.base, w.amount,
             COALESCE(cu."nameEn", su."nameEn") AS "partyEn", COALESCE(cu."nameAr", su."nameAr") AS "partyAr"
        FROM voucher_withholdings w
        JOIN cash_vouchers v ON v.id = w."voucherId"
        JOIN withholding_rates r ON r.id = w."rateId"
        LEFT JOIN customers cu ON cu.id = v."customerId"
        LEFT JOIN suppliers su ON su.id = v."supplierId"
       WHERE w."companyId" = ${companyId}::uuid AND v.status = 'POSTED' AND v."deletedAt" IS NULL
         AND v."voucherDate" BETWEEN ${from}::date AND ${to}::date
         ${dir ? Prisma.sql`AND w.direction = ${dir}` : Prisma.empty}
       ORDER BY v."voucherDate", v."voucherNumber"`);
    const items = rows.map((r) => ({
      voucherId: r.voucherId, voucherNumber: r.voucherNumber, voucherDate: r.voucherDate.toISOString().slice(0, 10),
      direction: r.direction, rateCode: r.code, ratePercent: new Prisma.Decimal(r.ratePercent).toFixed(SCALE),
      base: new Prisma.Decimal(r.base).toFixed(SCALE), amount: new Prisma.Decimal(r.amount).toFixed(SCALE),
      partyEn: r.partyEn, partyAr: r.partyAr,
    }));
    const total = (d: string) => items.filter((i) => i.direction === d).reduce((a, i) => a.plus(i.amount), new Prisma.Decimal(0)).toFixed(SCALE);
    return {
      items, rows: items,
      totals: { count: items.length, payable: total('PAYABLE'), receivable: total('RECEIVABLE') },
    };
  }

  private day(value: unknown, field: string): string {
    const v = String(value ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(field, `${field} must be a date (YYYY-MM-DD)`);
    return v;
  }
}
