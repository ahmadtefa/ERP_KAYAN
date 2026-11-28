import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { asHttp, assertForeign, CurrencyError, normalizeCode, parseRate, RATE_SCALE } from './currency-rules';

export type CurrencyInput = { code?: string; nameAr?: string; nameEn?: string; symbol?: string; isActive?: boolean };
export type RateInput = { rateDate?: string; rate?: string | number; note?: string };

type CurrencyRow = { code: string; nameAr: string; nameEn: string; symbol: string | null; isActive: boolean };

function text(value: unknown, field: string, max: number): string {
  const v = String(value ?? '').trim();
  if (!v) throw new CurrencyError('CURRENCY_NAME_REQUIRED', `${field} is required`);
  if (v.length > max) throw new CurrencyError('CURRENCY_NAME_LONG', `${field} is too long`);
  return v;
}

function validDate(value: unknown): string {
  const v = String(value ?? '').trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new CurrencyError('CURRENCY_RATE_DATE_BAD', 'Rate date must be a real date like 2026-03-31');
  }
  if (d.getTime() > Date.now() + 36 * 3600 * 1000) {
    throw new CurrencyError('CURRENCY_RATE_DATE_FUTURE', 'Rate date cannot be in the future');
  }
  return v;
}

/** Currencies and hand-entered exchange rates. No live feed: a rate is always typed by a person. */
@Injectable()
export class CurrencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async baseCurrency(companyId: string): Promise<string> {
    const [row] = await this.prisma.$queryRaw<{ currency: string }[]>(Prisma.sql`
      SELECT currency FROM companies WHERE id = ${companyId}::uuid`);
    return row?.currency ?? 'EGP';
  }

  async list(companyId: string) {
    const base = await this.baseCurrency(companyId);
    const rows = await this.prisma.$queryRaw<(CurrencyRow & { latestDate: Date | null; latestRate: Prisma.Decimal | null })[]>(Prisma.sql`
      SELECT c.code, c."nameAr", c."nameEn", c.symbol, c."isActive",
             r."rateDate" AS "latestDate", r.rate AS "latestRate"
        FROM currencies c
        LEFT JOIN LATERAL (SELECT "rateDate", rate FROM exchange_rates x
                            WHERE x."companyId" = c."companyId" AND x."currencyCode" = c.code
                            ORDER BY x."rateDate" DESC LIMIT 1) r ON true
       WHERE c."companyId" = ${companyId}::uuid ORDER BY c.code`);
    return {
      baseCurrency: base,
      items: rows.map((r) => ({
        code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, symbol: r.symbol, isActive: r.isActive,
        latestRateDate: r.latestDate ? r.latestDate.toISOString().slice(0, 10) : null,
        latestRate: r.latestRate ? new Prisma.Decimal(r.latestRate).toFixed(RATE_SCALE) : null,
      })),
    };
  }

  private async mustFind(companyId: string, code: string): Promise<CurrencyRow> {
    const [row] = await this.prisma.$queryRaw<CurrencyRow[]>(Prisma.sql`
      SELECT code, "nameAr", "nameEn", symbol, "isActive" FROM currencies
       WHERE "companyId" = ${companyId}::uuid AND code = ${code}`);
    if (!row) throw new CurrencyError('CURRENCY_NOT_FOUND', 'Currency not found', { code });
    return row;
  }

  async create(companyId: string, userId: string, input: CurrencyInput) {
    try {
      const code = normalizeCode(input.code);
      assertForeign(code, await this.baseCurrency(companyId));
      const nameAr = text(input.nameAr, 'nameAr', 80);
      const nameEn = text(input.nameEn, 'nameEn', 80);
      const symbol = input.symbol ? String(input.symbol).trim().slice(0, 8) : null;
      const [dup] = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM currencies WHERE "companyId" = ${companyId}::uuid AND code = ${code}`);
      if (dup) throw new CurrencyError('CURRENCY_DUPLICATE', 'This currency already exists', { code });
      const id = randomUUID();
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO currencies (id,"companyId",code,"nameAr","nameEn",symbol,"createdBy")
        VALUES (${id}::uuid, ${companyId}::uuid, ${code}, ${nameAr}, ${nameEn}, ${symbol}, ${userId}::uuid)`);
      await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'currencies', entityId: id, after: { code } });
      return { code, nameAr, nameEn, symbol, isActive: true };
    } catch (error) {
      return asHttp(error);
    }
  }

  async update(companyId: string, userId: string, codeRaw: string, input: CurrencyInput) {
    try {
      const code = normalizeCode(codeRaw);
      const current = await this.mustFind(companyId, code);
      const nameAr = input.nameAr !== undefined ? text(input.nameAr, 'nameAr', 80) : current.nameAr;
      const nameEn = input.nameEn !== undefined ? text(input.nameEn, 'nameEn', 80) : current.nameEn;
      const symbol = input.symbol !== undefined ? (String(input.symbol).trim().slice(0, 8) || null) : current.symbol;
      const isActive = input.isActive ?? current.isActive;
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE currencies SET "nameAr" = ${nameAr}, "nameEn" = ${nameEn}, symbol = ${symbol},
               "isActive" = ${isActive}, "updatedAt" = now()
         WHERE "companyId" = ${companyId}::uuid AND code = ${code}`);
      await this.audit.record({ companyId, userId, action: 'UPDATE', entity: 'currencies', entityId: code, after: { isActive } });
      return { code, nameAr, nameEn, symbol, isActive };
    } catch (error) {
      return asHttp(error);
    }
  }

  async setRate(companyId: string, userId: string, codeRaw: string, input: RateInput) {
    try {
      const code = normalizeCode(codeRaw);
      const currency = await this.mustFind(companyId, code);
      if (!currency.isActive) throw new CurrencyError('CURRENCY_INACTIVE', 'This currency is switched off', { code });
      const rateDate = validDate(input.rateDate);
      const rate = parseRate(input.rate);
      const note = input.note ? String(input.note).trim().slice(0, 200) : null;
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO exchange_rates (id,"companyId","currencyCode","rateDate",rate,note,"createdBy")
        VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${code}, ${rateDate}::date, ${rate.toFixed(RATE_SCALE)}::numeric, ${note}, ${userId}::uuid)
        ON CONFLICT ("companyId","currencyCode","rateDate")
        DO UPDATE SET rate = EXCLUDED.rate, note = EXCLUDED.note, "createdBy" = EXCLUDED."createdBy", "createdAt" = now()`);
      await this.audit.record({ companyId, userId, action: 'RATE_SET', entity: 'exchange_rates', entityId: `${code}:${rateDate}`, after: { rate: rate.toFixed(RATE_SCALE) } });
      return { code, rateDate, rate: rate.toFixed(RATE_SCALE), note };
    } catch (error) {
      return asHttp(error);
    }
  }

  async listRates(companyId: string, codeRaw: string, limit?: string) {
    try {
      const code = normalizeCode(codeRaw);
      await this.mustFind(companyId, code);
      const n = Math.min(Math.max(Number.parseInt(String(limit ?? '60'), 10) || 60, 1), 366);
      const rows = await this.prisma.$queryRaw<{ rateDate: Date; rate: Prisma.Decimal; note: string | null }[]>(Prisma.sql`
        SELECT "rateDate", rate, note FROM exchange_rates
         WHERE "companyId" = ${companyId}::uuid AND "currencyCode" = ${code}
         ORDER BY "rateDate" DESC LIMIT ${n}`);
      return { items: rows.map((r) => ({ rateDate: r.rateDate.toISOString().slice(0, 10), rate: new Prisma.Decimal(r.rate).toFixed(RATE_SCALE), note: r.note })) };
    } catch (error) {
      return asHttp(error);
    }
  }

  /**
   * The rate in force on a date: the newest entered on or before it. If nothing was entered
   * yet there is no answer; a rate is never invented. Documents call this and keep the result.
   */
  async rateOn(companyId: string, codeRaw: string, date?: string) {
    try {
      const code = normalizeCode(codeRaw);
      assertForeign(code, await this.baseCurrency(companyId));
      await this.mustFind(companyId, code);
      const on = date ? validDate(date) : new Date().toISOString().slice(0, 10);
      const [row] = await this.prisma.$queryRaw<{ rateDate: Date; rate: Prisma.Decimal }[]>(Prisma.sql`
        SELECT "rateDate", rate FROM exchange_rates
         WHERE "companyId" = ${companyId}::uuid AND "currencyCode" = ${code} AND "rateDate" <= ${on}::date
         ORDER BY "rateDate" DESC LIMIT 1`);
      if (!row) throw new CurrencyError('FX_RATE_MISSING', 'No exchange rate has been entered for this currency on or before that date', { code, date: on });
      return { code, asOf: on, rateDate: row.rateDate.toISOString().slice(0, 10), rate: new Prisma.Decimal(row.rate).toFixed(RATE_SCALE) };
    } catch (error) {
      return asHttp(error);
    }
  }
}
